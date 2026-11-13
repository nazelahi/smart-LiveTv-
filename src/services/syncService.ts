import { and, eq, gte, inArray, lte, ne, or } from 'drizzle-orm';
import { db } from '../db/index.ts';
import {
  categories,
  deviceAssignments,
  devices,
  playlists,
  playlistVersions,
  programs,
  syncEvents,
} from '../db/schema.ts';
import { getEffectiveChannels } from './channelService.ts';
import type {
  AssignmentMode,
  DevicePlatform,
  DeviceSyncConfig,
  EffectiveChannel,
} from '../../packages/core-models/src/index.ts';

type BroadcastFn = (deviceIds: string[], payload: Record<string, unknown>) => void;
export type SyncEventType = 'publish' | 'manual_sync' | 'auto_sync' | 'rollback' | 'revoke';

let wsBroadcaster: BroadcastFn | null = null;

export function registerSyncBroadcaster(fn: BroadcastFn) {
  wsBroadcaster = fn;
}

export async function getAssignedDeviceIdsForPlaylist(playlistId: string): Promise<string[]> {
  try {
    const assignments = await db
      .select()
      .from(deviceAssignments)
      .where(eq(deviceAssignments.playlistId, playlistId));

    if (assignments.length === 0) return [];

    const directDeviceIds = assignments
      .map((a) => a.deviceId)
      .filter((id): id is string => Boolean(id));

    const groupIds = assignments
      .map((a) => a.deviceGroupId)
      .filter((id): id is string => Boolean(id));

    const hasCentral = assignments.some((a) => a.assignmentMode === 'central' && !a.deviceId && !a.deviceGroupId);

    if (hasCentral) {
      const allActiveDevices = await db
        .select({ id: devices.id })
        .from(devices)
        .where(ne(devices.status, 'revoked'));
      return allActiveDevices.map((d) => d.id);
    }

    const deviceIdSet = new Set<string>(directDeviceIds);
    if (groupIds.length > 0) {
      const groupDevices = await db
        .select({ id: devices.id })
        .from(devices)
        .where(and(inArray(devices.groupId, groupIds), ne(devices.status, 'revoked')));
      for (const gd of groupDevices) {
        deviceIdSet.add(gd.id);
      }
    }

    return Array.from(deviceIdSet);
  } catch (error) {
    console.error('Error resolving assigned devices for playlist:', error);
    throw new Error('Failed to resolve assigned devices.', { cause: error });
  }
}

export async function dispatchSyncToDeviceIds(
  deviceIds: string[],
  options: {
    playlistId?: string;
    versionNumber?: number;
    eventType?: Exclude<SyncEventType, 'revoke'>;
  } = {}
) {
  try {
    const uniqueDeviceIds = Array.from(new Set(deviceIds.filter(Boolean)));
    if (uniqueDeviceIds.length === 0) return [];

    const { playlistId, versionNumber = 0, eventType = 'auto_sync' } = options;

    const inserted = await db
      .insert(syncEvents)
      .values(
        uniqueDeviceIds.map((deviceId) => ({
          deviceId,
          ...(playlistId ? { playlistId } : {}),
          playlistVersion: versionNumber,
          eventType,
          status: 'pending',
          payload: {
            ...(playlistId ? { playlistId } : {}),
            versionNumber,
            eventType,
          },
        }))
      )
      .returning();

    if (wsBroadcaster) {
      wsBroadcaster(uniqueDeviceIds, {
        type: 'sync:update_available',
        ...(playlistId ? { playlistId } : {}),
        versionNumber,
        eventType,
        timestamp: new Date().toISOString(),
      });
    }

    return inserted;
  } catch (error) {
    console.error('Error dispatching sync events to devices:', error);
    throw new Error('Failed to dispatch synchronization events.', { cause: error });
  }
}

export async function dispatchSyncToAllActiveDevices(
  eventType: Exclude<SyncEventType, 'revoke'> = 'auto_sync'
) {
  try {
    const activeDevices = await db
      .select({ id: devices.id })
      .from(devices)
      .where(ne(devices.status, 'revoked'));
    return await dispatchSyncToDeviceIds(
      activeDevices.map((d) => d.id),
      { eventType }
    );
  } catch (error) {
    console.error('Error broadcasting sync to all active devices:', error);
    throw new Error('Failed to broadcast synchronization events.', { cause: error });
  }
}

export async function dispatchPlaylistSyncEvents(
  playlistId: string,
  versionNumber: number,
  eventType: Exclude<SyncEventType, 'revoke'> = 'publish'
) {
  try {
    const targetDeviceIds = await getAssignedDeviceIdsForPlaylist(playlistId);
    return await dispatchSyncToDeviceIds(targetDeviceIds, {
      playlistId,
      versionNumber,
      eventType,
    });
  } catch (error) {
    console.error('Error dispatching sync events:', error);
    throw new Error('Failed to dispatch synchronization events.', { cause: error });
  }
}

export async function notifyDeviceSync(
  deviceId: string,
  eventType: 'manual_sync' | 'auto_sync' | 'revoke' = 'manual_sync'
) {
  try {
    const [event] = await db
      .insert(syncEvents)
      .values({
        deviceId,
        eventType,
        status: 'pending',
        payload: { eventType, timestamp: new Date().toISOString() },
      })
      .returning();

    if (wsBroadcaster) {
      wsBroadcaster([deviceId], {
        type: eventType === 'revoke' ? 'device:revoked' : 'sync:update_available',
        deviceId,
        eventId: event.id,
        eventType,
        timestamp: new Date().toISOString(),
      });
    }

    return event;
  } catch (error) {
    console.error('Error notifying device sync:', error);
    throw new Error('Failed to notify device.', { cause: error });
  }
}

export async function buildDeviceSyncConfig(deviceId: string): Promise<DeviceSyncConfig> {
  try {
    const [device] = await db
      .select()
      .from(devices)
      .where(eq(devices.id, deviceId))
      .limit(1);

    if (!device) {
      throw new Error('Device not found.');
    }

    if (device.status === 'revoked') {
      throw new Error('Device is revoked.');
    }

    // Resolve assignments: individual, device group, or central
    const conditions = [
      eq(deviceAssignments.deviceId, deviceId),
      and(
        eq(deviceAssignments.assignmentMode, 'central'),
      ),
    ];
    if (device.groupId) {
      conditions.push(eq(deviceAssignments.deviceGroupId, device.groupId));
    }

    const assignments = await db
      .select()
      .from(deviceAssignments)
      .where(or(...conditions));

    const uniquePlaylistMap = new Map<string, { mode: AssignmentMode; priority: number }>();
    for (const a of assignments) {
      if (a.assignmentMode === 'central' && !a.deviceId && !a.deviceGroupId) {
        uniquePlaylistMap.set(a.playlistId, { mode: 'central', priority: a.priority });
      } else if (a.deviceId === deviceId || (device.groupId && a.deviceGroupId === device.groupId)) {
        uniquePlaylistMap.set(a.playlistId, {
          mode: (a.assignmentMode || 'individual') as AssignmentMode,
          priority: a.priority,
        });
      }
    }

    const assignedPlaylistIds = Array.from(uniquePlaylistMap.keys());
    const playlistSummaries: DeviceSyncConfig['playlists'] = [];
    const mergedChannels: EffectiveChannel[] = [];
    let maxVersion = 0;

    if (assignedPlaylistIds.length > 0) {
      const assignedPlaylists = await db
        .select()
        .from(playlists)
        .where(
          and(inArray(playlists.id, assignedPlaylistIds), eq(playlists.isEnabled, true))
        );

      for (const pl of assignedPlaylists) {
        const assignmentMeta = uniquePlaylistMap.get(pl.id)!;
        maxVersion += pl.activeVersionNumber || 1;
        playlistSummaries.push({
          id: pl.id,
          name: pl.name,
          versionNumber: pl.activeVersionNumber,
          assignmentMode: assignmentMeta.mode,
        });

        // Prefer published snapshot if available so drafts never leak to TVs
        if (pl.activeVersionNumber > 0) {
          const [ver] = await db
            .select()
            .from(playlistVersions)
            .where(
              and(
                eq(playlistVersions.playlistId, pl.id),
                eq(playlistVersions.versionNumber, pl.activeVersionNumber)
              )
            )
            .limit(1);

          if (ver && ver.snapshotJson && typeof ver.snapshotJson === 'object') {
            const snap = ver.snapshotJson as { channels?: EffectiveChannel[] };
            if (Array.isArray(snap.channels)) {
              mergedChannels.push(...snap.channels);
              continue;
            }
          }
        }

        const effective = await getEffectiveChannels(pl.id);
        mergedChannels.push(...effective.filter((c) => c.isEnabled && !c.isHidden));
      }
    }

    const allCategories = await db.select().from(categories);
    const visibleCategories = allCategories
      .filter((c) => !c.isHidden)
      .sort((a, b) => a.sortOrder - b.sortOrder)
      .map((c) => ({
        id: c.id,
        name: c.name,
        slug: c.slug,
        sortOrder: c.sortOrder,
      }));

    // Fetch current + next 12h EPG programs for channels with tvgId
    const tvgIds = Array.from(
      new Set(mergedChannels.map((c) => c.tvgId).filter((v): v is string => Boolean(v)))
    );

    const now = new Date();
    const windowStart = new Date(now.getTime() - 2 * 60 * 60 * 1000);
    const windowEnd = new Date(now.getTime() + 12 * 60 * 60 * 1000);

    let epgProgramRows: DeviceSyncConfig['epgPrograms'] = [];
    if (tvgIds.length > 0) {
      const progs = await db
        .select()
        .from(programs)
        .where(
          and(
            inArray(programs.xmltvChannelId, tvgIds),
            gte(programs.endTime, windowStart),
            lte(programs.startTime, windowEnd)
          )
        );
      epgProgramRows = progs.map((p) => ({
        channelTvgId: p.xmltvChannelId,
        title: p.title,
        description: p.description,
        category: p.category,
        posterUrl: p.posterUrl ?? null,
        startTime: p.startTime.toISOString(),
        endTime: p.endTime.toISOString(),
      }));
    }

    return {
      deviceId: device.id,
      deviceName: device.deviceName,
      platform: device.platform as DevicePlatform,
      syncTimestamp: now.toISOString(),
      configVersion: maxVersion,
      playlists: playlistSummaries,
      channels: mergedChannels,
      categories: visibleCategories,
      epgPrograms: epgProgramRows,
    };
  } catch (error) {
    console.error('Error building device sync config:', error);
    throw new Error('Failed to build device synchronization configuration.', { cause: error });
  }
}
