import { Router } from 'express';
import { and, count, desc, eq, inArray, sql } from 'drizzle-orm';
import { db } from '../db/index.ts';
import {
  adminUsers,
  appSettings,
  auditLogs,
  categories,
  channelOverrides,
  channels,
  deviceAssignments,
  deviceCredentials,
  deviceGroups,
  devices,
  epgChannels,
  epgSources,
  playbackDiagnostics,
  playlists,
  playlistVersions,
  programs,
  syncEvents,
} from '../db/schema.ts';
import { requireAdminAuth, requireRole, type AuthRequest } from '../middleware/auth.ts';
import {
  getEffectiveChannels,
  publishPlaylistVersion,
} from '../services/channelService.ts';
import {
  dispatchPlaylistSyncEvents,
  dispatchSyncToAllActiveDevices,
  dispatchSyncToDeviceIds,
  getAssignedDeviceIdsForPlaylist,
  notifyDeviceSync,
} from '../services/syncService.ts';
import { parseM3U } from '../../packages/playlist-engine/src/index.ts';
import { parseXmltv } from '../../packages/epg-engine/src/index.ts';
import type { ParsedXmltvResult } from '../../packages/core-models/src/index.ts';
import { safeFetchExternalText } from '../lib/security.ts';
import { ensureInitialDatabaseSeed } from '../db/seed.ts';

export const adminRouter = Router();

adminRouter.use(requireAdminAuth);

async function writeAudit(
  req: AuthRequest,
  action: string,
  resourceType: string,
  resourceId?: string | null,
  details: Record<string, unknown> = {}
) {
  try {
    await db.insert(auditLogs).values({
      actorUid: req.adminUser?.uid ?? null,
      actorEmail: req.adminUser?.email ?? null,
      action,
      resourceType,
      resourceId: resourceId ?? null,
      details,
      ipAddress: req.ip || null,
    });
  } catch (err) {
    console.error('Failed to write audit log:', err);
  }
}

async function autoPublishAndSyncPlaylists(
  playlistIds: string[],
  publishedBy: string,
  changelog: string
): Promise<number> {
  const uniqueIds = Array.from(new Set(playlistIds.filter(Boolean)));
  let totalDispatched = 0;
  for (const plId of uniqueIds) {
    const version = await publishPlaylistVersion(plId, publishedBy, changelog);
    const events = await dispatchPlaylistSyncEvents(plId, version.versionNumber, 'auto_sync');
    totalDispatched += events.length;
  }
  return totalDispatched;
}

function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '') || 'uncategorized';
}

async function upsertCategoriesFromGroups(groupNames: string[]): Promise<Map<string, string>> {
  const existing = await db.select().from(categories);
  const byName = new Map(existing.map((c) => [c.name.toLowerCase(), c.id]));

  let nextOrder = existing.length + 1;
  const toInsert: Array<{ name: string; slug: string; sortOrder: number }> = [];
  const seenNew = new Set<string>();

  for (const rawName of groupNames) {
    const name = rawName.trim();
    if (!name) continue;
    const lower = name.toLowerCase();
    if (!byName.has(lower) && !seenNew.has(lower)) {
      seenNew.add(lower);
      toInsert.push({
        name,
        slug: `${slugify(name)}-${Math.random().toString(36).slice(2, 6)}`,
        sortOrder: nextOrder++,
      });
    }
  }

  if (toInsert.length > 0) {
    for (let i = 0; i < toInsert.length; i += 200) {
      const inserted = await db
        .insert(categories)
        .values(toInsert.slice(i, i + 200))
        .onConflictDoNothing()
        .returning();
      for (const c of inserted) {
        byName.set(c.name.toLowerCase(), c.id);
      }
    }
  }

  return byName;
}

// 1. Overview & Telemetry
adminRouter.get('/overview', async (req: AuthRequest, res) => {
  try {
    await ensureInitialDatabaseSeed();

    const allDevices = await db.select().from(devices);
    const fiveMinsAgo = new Date(Date.now() - 5 * 60 * 1000);
    const onlineCount = allDevices.filter(
      (d) => d.status === 'active' && d.lastOnlineAt && d.lastOnlineAt > fiveMinsAgo
    ).length;
    const offlineCount = allDevices.filter(
      (d) => d.status !== 'revoked' && d.status !== 'pending' && (!d.lastOnlineAt || d.lastOnlineAt <= fiveMinsAgo)
    ).length;

    const allPlaylists = await db.select().from(playlists);
    const [{ totalChannels }] = await db.select({ totalChannels: count() }).from(channels);
    const recentSyncs = await db
      .select()
      .from(syncEvents)
      .orderBy(desc(syncEvents.createdAt))
      .limit(10);
    const recentLogs = await db
      .select()
      .from(auditLogs)
      .orderBy(desc(auditLogs.createdAt))
      .limit(12);

    res.json({
      admin: req.adminUser,
      stats: {
        totalDevices: allDevices.length,
        onlineDevices: onlineCount,
        offlineDevices: offlineCount,
        pendingDevices: allDevices.filter((d) => d.status === 'pending').length,
        totalPlaylists: allPlaylists.length,
        activePlaylists: allPlaylists.filter((p) => p.isEnabled).length,
        totalChannels: Number(totalChannels),
        lastSyncAt: recentSyncs[0]?.createdAt ?? null,
      },
      recentSyncs,
      recentAuditLogs: recentLogs,
    });
  } catch (error) {
    console.error('Overview error:', error);
    res.status(500).json({ error: 'Failed to load dashboard overview.' });
  }
});

// 2. Playlists + M3U Import & Versioning
adminRouter.get('/playlists', async (_req, res) => {
  try {
    const rows = await db.select().from(playlists).orderBy(desc(playlists.createdAt));
    const channelCounts = await db
      .select({ playlistId: channels.playlistId, total: count() })
      .from(channels)
      .groupBy(channels.playlistId);
    const countMap = new Map(channelCounts.map((c) => [c.playlistId, Number(c.total)]));

    res.json(
      rows.map((p) => ({
        ...p,
        channelCount: countMap.get(p.id) ?? 0,
      }))
    );
  } catch (error) {
    console.error('List playlists error:', error);
    res.status(500).json({ error: 'Failed to fetch playlists.' });
  }
});

adminRouter.post('/playlists/preview', async (req: AuthRequest, res) => {
  try {
    const { sourceType, sourceUrl, m3uContent } = req.body as {
      sourceType?: string;
      sourceUrl?: string;
      m3uContent?: string;
    };

    let rawText = m3uContent || '';
    if (sourceType === 'url') {
      if (!sourceUrl) {
        return res.status(400).json({ error: 'Playlist URL is required.' });
      }
      rawText = await safeFetchExternalText(sourceUrl);
    }

    if (!rawText.trim()) {
      return res.status(400).json({ error: 'M3U content is empty.' });
    }

    const parsed = parseM3U(rawText);
    res.json({
      epgUrl: parsed.epgUrl,
      totalFound: parsed.channels.length,
      warnings: parsed.warnings.slice(0, 20),
      previewChannels: parsed.channels.slice(0, 50),
    });
  } catch (error) {
    res.status(400).json({
      error: error instanceof Error ? error.message : 'Failed to preview M3U playlist.',
    });
  }
});

adminRouter.post(
  '/playlists',
  requireRole(['super_admin', 'admin', 'operator']),
  async (req: AuthRequest, res) => {
    try {
      const { name, description, sourceType, sourceUrl, m3uContent, epgSourceId, autoRefreshIntervalMins } =
        req.body as {
          name?: string;
          description?: string;
          sourceType?: 'url' | 'file' | 'manual';
          sourceUrl?: string;
          m3uContent?: string;
          epgSourceId?: string | null;
          autoRefreshIntervalMins?: number;
        };

      if (!name?.trim()) {
        return res.status(400).json({ error: 'Playlist name is required.' });
      }

      let rawText = m3uContent || '';
      if (sourceType === 'url') {
        if (!sourceUrl?.trim()) {
          return res.status(400).json({ error: 'Source URL is required for URL playlists.' });
        }
        rawText = await safeFetchExternalText(sourceUrl);
      }

      const parsed = rawText.trim() ? parseM3U(rawText) : { epgUrl: null, channels: [], warnings: [] };

      const [playlist] = await db
        .insert(playlists)
        .values({
          name: name.trim(),
          description: description?.trim() || null,
          sourceType: sourceType || 'file',
          sourceUrl: sourceUrl?.trim() || null,
          autoRefreshIntervalMins: autoRefreshIntervalMins || 360,
          isEnabled: true,
          epgSourceId: epgSourceId || null,
          createdBy: req.adminUser?.email || 'admin',
          lastFetchedAt: new Date(),
          lastFetchStatus: 'success',
        })
        .returning();

      if (parsed.channels.length > 0) {
        const catMap = await upsertCategoriesFromGroups(
          parsed.channels.map((c) => c.groupTitle || 'Uncategorized')
        );

        const channelRows = parsed.channels.map((ch, idx) => ({
          playlistId: playlist.id,
          tvgId: ch.tvgId,
          tvgName: ch.tvgName,
          name: ch.name,
          logoUrl: ch.logoUrl,
          groupTitle: ch.groupTitle,
          categoryId: ch.groupTitle ? catMap.get(ch.groupTitle.toLowerCase()) ?? null : null,
          channelNumber: ch.channelNumber,
          streamUrl: ch.streamUrl,
          httpHeaders: ch.httpHeaders,
          streamFormat: ch.streamFormat,
          sortOrder: idx + 1,
          rawAttributes: ch.rawAttributes,
        }));

        for (let i = 0; i < channelRows.length; i += 250) {
          await db.insert(channels).values(channelRows.slice(i, i + 250));
        }
      }

      const version = await publishPlaylistVersion(
        playlist.id,
        req.adminUser?.email || 'admin',
        `Initial import (${parsed.channels.length} channels)`
      );

      // Ensure at least one central assignment exists if no central assignment is active yet
      const existingCentral = await db
        .select({ id: deviceAssignments.id })
        .from(deviceAssignments)
        .where(eq(deviceAssignments.assignmentMode, 'central'))
        .limit(1);

      if (existingCentral.length === 0) {
        await db.insert(deviceAssignments).values({
          playlistId: playlist.id,
          assignmentMode: 'central',
          priority: 1,
          assignedBy: req.adminUser?.email || 'admin',
        });
        await dispatchPlaylistSyncEvents(playlist.id, version.versionNumber, 'publish');
      }

      await writeAudit(req, 'playlist.create', 'playlist', playlist.id, {
        name: playlist.name,
        channelCount: parsed.channels.length,
      });

      res.status(201).json({
        playlist,
        version,
        importedCount: parsed.channels.length,
        warnings: parsed.warnings,
      });
    } catch (error) {
      console.error('Create playlist error:', error);
      res.status(400).json({
        error: error instanceof Error ? error.message : 'Failed to create playlist.',
      });
    }
  }
);

adminRouter.patch(
  '/playlists/:id',
  requireRole(['super_admin', 'admin', 'operator']),
  async (req: AuthRequest, res) => {
    try {
      const { id } = req.params;
      const { name, description, sourceUrl, isEnabled, epgSourceId, autoRefreshIntervalMins } =
        req.body;

      const [updated] = await db
        .update(playlists)
        .set({
          ...(name !== undefined ? { name: String(name).trim() } : {}),
          ...(description !== undefined ? { description } : {}),
          ...(sourceUrl !== undefined ? { sourceUrl } : {}),
          ...(isEnabled !== undefined ? { isEnabled: Boolean(isEnabled) } : {}),
          ...(epgSourceId !== undefined ? { epgSourceId: epgSourceId || null } : {}),
          ...(autoRefreshIntervalMins !== undefined
            ? { autoRefreshIntervalMins: Number(autoRefreshIntervalMins) }
            : {}),
          updatedAt: new Date(),
        })
        .where(eq(playlists.id, id))
        .returning();

      if (!updated) return res.status(404).json({ error: 'Playlist not found.' });

      let versionNumber = updated.activeVersionNumber;
      if (name !== undefined || versionNumber === 0) {
        const version = await publishPlaylistVersion(
          id,
          req.adminUser?.email || 'admin',
          'Auto-published playlist details update'
        );
        versionNumber = version.versionNumber;
      }

      const dispatchedEvents = await dispatchPlaylistSyncEvents(id, versionNumber, 'auto_sync');
      await writeAudit(req, 'playlist.update', 'playlist', id, {
        isEnabled: updated.isEnabled,
        dispatchedDevices: dispatchedEvents.length,
      });
      res.json({ ...updated, activeVersionNumber: versionNumber, dispatchedDevices: dispatchedEvents.length });
    } catch (error) {
      console.error('Update playlist error:', error);
      res.status(500).json({ error: 'Failed to update playlist.' });
    }
  }
);

adminRouter.post(
  '/playlists/:id/refresh',
  requireRole(['super_admin', 'admin', 'operator']),
  async (req: AuthRequest, res) => {
    try {
      const { id } = req.params;
      const [playlist] = await db.select().from(playlists).where(eq(playlists.id, id)).limit(1);
      if (!playlist) return res.status(404).json({ error: 'Playlist not found.' });
      if (!playlist.sourceUrl) {
        return res.status(400).json({ error: 'Playlist does not have a remote source URL.' });
      }

      const rawText = await safeFetchExternalText(playlist.sourceUrl);
      const parsed = parseM3U(rawText);
      const catMap = await upsertCategoriesFromGroups(
        parsed.channels.map((c) => c.groupTitle || 'Uncategorized')
      );

      // Preserve existing channel IDs & overrides where streamUrl or tvgId matches
      const existingChannels = await db
        .select()
        .from(channels)
        .where(eq(channels.playlistId, id));

      const existingByKey = new Map<string, typeof existingChannels[number]>();
      for (const ch of existingChannels) {
        const key = ch.tvgId ? `tvg:${ch.tvgId}` : `url:${ch.streamUrl}`;
        existingByKey.set(key, ch);
      }

      const retainedIds = new Set<string>();
      const newChannelRows: Array<typeof channels.$inferInsert> = [];

      for (let i = 0; i < parsed.channels.length; i++) {
        const parsedCh = parsed.channels[i];
        const key = parsedCh.tvgId ? `tvg:${parsedCh.tvgId}` : `url:${parsedCh.streamUrl}`;
        const existing = existingByKey.get(key);
        const categoryId = parsedCh.groupTitle
          ? catMap.get(parsedCh.groupTitle.toLowerCase()) ?? null
          : null;

        if (existing) {
          retainedIds.add(existing.id);
          await db
            .update(channels)
            .set({
              tvgId: parsedCh.tvgId,
              tvgName: parsedCh.tvgName,
              name: parsedCh.name,
              logoUrl: parsedCh.logoUrl,
              groupTitle: parsedCh.groupTitle,
              categoryId,
              channelNumber: parsedCh.channelNumber,
              streamUrl: parsedCh.streamUrl,
              httpHeaders: parsedCh.httpHeaders,
              streamFormat: parsedCh.streamFormat,
              sortOrder: i + 1,
              rawAttributes: parsedCh.rawAttributes,
              updatedAt: new Date(),
            })
            .where(eq(channels.id, existing.id));
        } else {
          newChannelRows.push({
            playlistId: id,
            tvgId: parsedCh.tvgId,
            tvgName: parsedCh.tvgName,
            name: parsedCh.name,
            logoUrl: parsedCh.logoUrl,
            groupTitle: parsedCh.groupTitle,
            categoryId,
            channelNumber: parsedCh.channelNumber,
            streamUrl: parsedCh.streamUrl,
            httpHeaders: parsedCh.httpHeaders,
            streamFormat: parsedCh.streamFormat,
            sortOrder: i + 1,
            rawAttributes: parsedCh.rawAttributes,
          });
        }
      }

      for (let i = 0; i < newChannelRows.length; i += 250) {
        await db.insert(channels).values(newChannelRows.slice(i, i + 250));
      }

      // Remove channels no longer present in upstream source
      const toDelete = existingChannels.filter((c) => !retainedIds.has(c.id)).map((c) => c.id);
      for (let i = 0; i < toDelete.length; i += 500) {
        await db.delete(channels).where(inArray(channels.id, toDelete.slice(i, i + 500)));
      }

      await db
        .update(playlists)
        .set({ lastFetchedAt: new Date(), lastFetchStatus: 'success', lastError: null })
        .where(eq(playlists.id, id));

      const version = await publishPlaylistVersion(
        id,
        req.adminUser?.email || 'admin',
        `Auto-published upstream refresh (${parsed.channels.length} channels)`
      );
      const dispatchedEvents = await dispatchPlaylistSyncEvents(id, version.versionNumber, 'auto_sync');

      await writeAudit(req, 'playlist.refresh', 'playlist', id, {
        channelCount: parsed.channels.length,
        removedCount: toDelete.length,
        versionNumber: version.versionNumber,
        dispatchedDevices: dispatchedEvents.length,
      });

      res.json({
        refreshedCount: parsed.channels.length,
        removedCount: toDelete.length,
        warnings: parsed.warnings,
        version,
        dispatchedDevices: dispatchedEvents.length,
      });
    } catch (error) {
      res.status(400).json({
        error: error instanceof Error ? error.message : 'Failed to refresh playlist.',
      });
    }
  }
);

adminRouter.post(
  '/playlists/:id/publish',
  requireRole(['super_admin', 'admin', 'operator']),
  async (req: AuthRequest, res) => {
    try {
      const { id } = req.params;
      const { changelog } = req.body as { changelog?: string };
      const version = await publishPlaylistVersion(
        id,
        req.adminUser?.email || 'admin',
        changelog || 'Published remote playlist configuration'
      );

      const events = await dispatchPlaylistSyncEvents(id, version.versionNumber, 'publish');
      await writeAudit(req, 'playlist.publish', 'playlist', id, {
        versionNumber: version.versionNumber,
        dispatchedDevices: events.length,
      });

      res.json({ version, dispatchedDevices: events.length });
    } catch (error) {
      console.error('Publish playlist error:', error);
      res.status(500).json({ error: 'Failed to publish playlist version.' });
    }
  }
);

adminRouter.get('/playlists/:id/versions', async (req, res) => {
  try {
    const versions = await db
      .select()
      .from(playlistVersions)
      .where(eq(playlistVersions.playlistId, req.params.id))
      .orderBy(desc(playlistVersions.versionNumber));
    res.json(versions);
  } catch (error) {
    res.status(500).json({ error: 'Failed to load playlist versions.' });
  }
});

adminRouter.post(
  '/playlists/:id/rollback',
  requireRole(['super_admin', 'admin']),
  async (req: AuthRequest, res) => {
    try {
      const { id } = req.params;
      const { versionNumber } = req.body as { versionNumber: number };
      const [targetVersion] = await db
        .select()
        .from(playlistVersions)
        .where(
          and(
            eq(playlistVersions.playlistId, id),
            eq(playlistVersions.versionNumber, Number(versionNumber))
          )
        )
        .limit(1);

      if (!targetVersion) {
        return res.status(404).json({ error: 'Target playlist version not found.' });
      }

      await db
        .update(playlists)
        .set({ activeVersionNumber: targetVersion.versionNumber, updatedAt: new Date() })
        .where(eq(playlists.id, id));

      const events = await dispatchPlaylistSyncEvents(id, targetVersion.versionNumber, 'rollback');
      await writeAudit(req, 'playlist.rollback', 'playlist', id, {
        restoredVersion: targetVersion.versionNumber,
        dispatchedDevices: events.length,
      });

      res.json({ restoredVersion: targetVersion.versionNumber, dispatchedDevices: events.length });
    } catch (error) {
      res.status(500).json({ error: 'Failed to rollback playlist version.' });
    }
  }
);

adminRouter.delete(
  '/playlists/:id',
  requireRole(['super_admin', 'admin']),
  async (req: AuthRequest, res) => {
    try {
      const affectedDeviceIds = await getAssignedDeviceIdsForPlaylist(req.params.id);
      const [deleted] = await db
        .delete(playlists)
        .where(eq(playlists.id, req.params.id))
        .returning();
      if (!deleted) return res.status(404).json({ error: 'Playlist not found.' });

      if (affectedDeviceIds.length > 0) {
        await dispatchSyncToDeviceIds(affectedDeviceIds, { eventType: 'auto_sync' });
      }

      await writeAudit(req, 'playlist.delete', 'playlist', req.params.id, {
        name: deleted.name,
        dispatchedDevices: affectedDeviceIds.length,
      });
      res.json({ deleted: true, dispatchedDevices: affectedDeviceIds.length });
    } catch (error) {
      res.status(500).json({ error: 'Failed to delete playlist.' });
    }
  }
);

// 3. Channels & Non-Destructive Overrides
adminRouter.get('/channels', async (req, res) => {
  try {
    const playlistId = req.query.playlistId ? String(req.query.playlistId) : undefined;
    const effective = await getEffectiveChannels(playlistId);
    res.json(effective);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch channels.' });
  }
});

adminRouter.post(
  '/channels',
  requireRole(['super_admin', 'admin', 'operator']),
  async (req: AuthRequest, res) => {
    try {
      const { playlistId, name, tvgId, logoUrl, categoryId, channelNumber, streamUrl, streamFormat } =
        req.body;
      if (!playlistId || !name || !streamUrl) {
        return res.status(400).json({ error: 'playlistId, name, and streamUrl are required.' });
      }
      const [created] = await db
        .insert(channels)
        .values({
          playlistId,
          name: String(name).trim(),
          tvgId: tvgId || null,
          logoUrl: logoUrl || null,
          categoryId: categoryId || null,
          channelNumber: Number(channelNumber) || 1,
          streamUrl: String(streamUrl).trim(),
          streamFormat: streamFormat || 'hls',
        })
        .returning();

      const dispatchedDevices = await autoPublishAndSyncPlaylists(
        [playlistId],
        req.adminUser?.email || 'admin',
        `Added channel: ${created.name}`
      );
      await writeAudit(req, 'channel.create', 'channel', created.id, {
        name: created.name,
        dispatchedDevices,
      });
      res.status(201).json(created);
    } catch (error) {
      res.status(500).json({ error: 'Failed to create channel.' });
    }
  }
);

adminRouter.patch(
  '/channels/:id',
  requireRole(['super_admin', 'admin', 'operator']),
  async (req: AuthRequest, res) => {
    try {
      const { id } = req.params;
      const {
        customName,
        customLogoUrl,
        customCategoryId,
        customChannelNumber,
        customStreamUrl,
        customHttpHeaders,
        isEnabledOverride,
        isHiddenOverride,
        customSortOrder,
      } = req.body;

      const [existingChannel] = await db
        .select()
        .from(channels)
        .where(eq(channels.id, id))
        .limit(1);
      if (!existingChannel) return res.status(404).json({ error: 'Channel not found.' });

      const payload = {
        channelId: id,
        ...(customName !== undefined ? { customName: customName || null } : {}),
        ...(customLogoUrl !== undefined ? { customLogoUrl: customLogoUrl || null } : {}),
        ...(customCategoryId !== undefined ? { customCategoryId: customCategoryId || null } : {}),
        ...(customChannelNumber !== undefined
          ? { customChannelNumber: customChannelNumber !== null ? Number(customChannelNumber) : null }
          : {}),
        ...(customStreamUrl !== undefined ? { customStreamUrl: customStreamUrl || null } : {}),
        ...(customHttpHeaders !== undefined ? { customHttpHeaders } : {}),
        ...(isEnabledOverride !== undefined ? { isEnabledOverride } : {}),
        ...(isHiddenOverride !== undefined ? { isHiddenOverride } : {}),
        ...(customSortOrder !== undefined
          ? { customSortOrder: customSortOrder !== null ? Number(customSortOrder) : null }
          : {}),
        updatedBy: req.adminUser?.email || 'admin',
        updatedAt: new Date(),
      };

      const [override] = await db
        .insert(channelOverrides)
        .values(payload)
        .onConflictDoUpdate({
          target: channelOverrides.channelId,
          set: payload,
        })
        .returning();

      const dispatchedDevices = await autoPublishAndSyncPlaylists(
        [existingChannel.playlistId],
        req.adminUser?.email || 'admin',
        `Updated channel: ${existingChannel.name}`
      );

      await writeAudit(req, 'channel.override', 'channel', id, {
        ...payload,
        dispatchedDevices,
      });
      res.json(override);
    } catch (error) {
      console.error('Channel override error:', error);
      res.status(500).json({ error: 'Failed to update channel override.' });
    }
  }
);

adminRouter.post(
  '/channels/bulk',
  requireRole(['super_admin', 'admin', 'operator']),
  async (req: AuthRequest, res) => {
    try {
      const { channelIds, action, categoryId } = req.body as {
        channelIds: string[];
        action: 'enable' | 'disable' | 'hide' | 'unhide' | 'set_category';
        categoryId?: string | null;
      };
      if (!Array.isArray(channelIds) || channelIds.length === 0) {
        return res.status(400).json({ error: 'No channels selected.' });
      }

      for (const chId of channelIds) {
        const patch: Record<string, unknown> = {
          channelId: chId,
          updatedBy: req.adminUser?.email || 'admin',
          updatedAt: new Date(),
        };
        if (action === 'enable') patch.isEnabledOverride = true;
        if (action === 'disable') patch.isEnabledOverride = false;
        if (action === 'hide') patch.isHiddenOverride = true;
        if (action === 'unhide') patch.isHiddenOverride = false;
        if (action === 'set_category') patch.customCategoryId = categoryId || null;

        await db
          .insert(channelOverrides)
          .values(patch as typeof channelOverrides.$inferInsert)
          .onConflictDoUpdate({
            target: channelOverrides.channelId,
            set: patch,
          });
      }

      const affectedRows = await db
        .select({ playlistId: channels.playlistId })
        .from(channels)
        .where(inArray(channels.id, channelIds));

      const dispatchedDevices = await autoPublishAndSyncPlaylists(
        affectedRows.map((r) => r.playlistId),
        req.adminUser?.email || 'admin',
        `Bulk channel update (${action}, ${channelIds.length} channels)`
      );

      await writeAudit(req, 'channel.bulk_edit', 'channel', null, {
        count: channelIds.length,
        action,
        dispatchedDevices,
      });

      res.json({ updatedCount: channelIds.length, dispatchedDevices });
    } catch (error) {
      res.status(500).json({ error: 'Failed to execute bulk channel update.' });
    }
  }
);

adminRouter.delete(
  '/channels/:id/override',
  requireRole(['super_admin', 'admin', 'operator']),
  async (req: AuthRequest, res) => {
    try {
      const [existingChannel] = await db
        .select()
        .from(channels)
        .where(eq(channels.id, req.params.id))
        .limit(1);

      await db.delete(channelOverrides).where(eq(channelOverrides.channelId, req.params.id));

      let dispatchedDevices = 0;
      if (existingChannel) {
        dispatchedDevices = await autoPublishAndSyncPlaylists(
          [existingChannel.playlistId],
          req.adminUser?.email || 'admin',
          `Reset override for ${existingChannel.name}`
        );
      }

      await writeAudit(req, 'channel.reset_override', 'channel', req.params.id, { dispatchedDevices });
      res.json({ reset: true, dispatchedDevices });
    } catch (error) {
      res.status(500).json({ error: 'Failed to reset channel override.' });
    }
  }
);

// 4. Categories
adminRouter.get('/categories', async (_req, res) => {
  try {
    const rows = await db.select().from(categories).orderBy(categories.sortOrder, categories.name);
    res.json(rows);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch categories.' });
  }
});

adminRouter.post(
  '/categories',
  requireRole(['super_admin', 'admin', 'operator']),
  async (req: AuthRequest, res) => {
    try {
      const { name, sortOrder, isHidden } = req.body;
      if (!name?.trim()) return res.status(400).json({ error: 'Category name is required.' });
      const [created] = await db
        .insert(categories)
        .values({
          name: String(name).trim(),
          slug: slugify(String(name)),
          sortOrder: Number(sortOrder) || 0,
          isHidden: Boolean(isHidden),
        })
        .returning();
      await writeAudit(req, 'category.create', 'category', created.id, { name: created.name });
      res.status(201).json(created);
    } catch (error) {
      res.status(400).json({ error: 'Category already exists or invalid.' });
    }
  }
);

adminRouter.patch(
  '/categories/:id',
  requireRole(['super_admin', 'admin', 'operator']),
  async (req: AuthRequest, res) => {
    try {
      const { name, sortOrder, isHidden } = req.body;
      const [updated] = await db
        .update(categories)
        .set({
          ...(name !== undefined ? { name: String(name).trim(), slug: slugify(String(name)) } : {}),
          ...(sortOrder !== undefined ? { sortOrder: Number(sortOrder) } : {}),
          ...(isHidden !== undefined ? { isHidden: Boolean(isHidden) } : {}),
          updatedAt: new Date(),
        })
        .where(eq(categories.id, req.params.id))
        .returning();

      if (name !== undefined) {
        const affectedRows = await db
          .select({ playlistId: channels.playlistId })
          .from(channels)
          .where(eq(channels.categoryId, req.params.id));
        if (affectedRows.length > 0) {
          await autoPublishAndSyncPlaylists(
            affectedRows.map((r) => r.playlistId),
            req.adminUser?.email || 'admin',
            `Renamed category to ${updated.name}`
          );
        }
      }
      await dispatchSyncToAllActiveDevices('auto_sync');
      res.json(updated);
    } catch (error) {
      res.status(500).json({ error: 'Failed to update category.' });
    }
  }
);

adminRouter.delete(
  '/categories/:id',
  requireRole(['super_admin', 'admin']),
  async (req: AuthRequest, res) => {
    try {
      await db.delete(categories).where(eq(categories.id, req.params.id));
      await dispatchSyncToAllActiveDevices('auto_sync');
      res.json({ deleted: true });
    } catch (error) {
      res.status(500).json({ error: 'Failed to delete category.' });
    }
  }
);

// 5. EPG Management (XMLTV)
adminRouter.get('/epg/sources', async (_req, res) => {
  try {
    const sources = await db.select().from(epgSources).orderBy(desc(epgSources.createdAt));
    res.json(sources);
  } catch (error) {
    res.status(500).json({ error: 'Failed to load EPG sources.' });
  }
});

async function ingestXmltvIntoSource(
  sourceId: string,
  xmlContent: string,
  timezoneOffset: string
) {
  const parsed = parseXmltv(xmlContent, timezoneOffset);
  await db.delete(epgChannels).where(eq(epgChannels.epgSourceId, sourceId));
  await db.delete(programs).where(eq(programs.epgSourceId, sourceId));

  const existingChannels = await db.select().from(channels);
  const channelByTvgId = new Map(
    existingChannels.filter((c) => c.tvgId).map((c) => [c.tvgId!.toLowerCase(), c.id])
  );

  if (parsed.channels.length > 0) {
    await db.insert(epgChannels).values(
      parsed.channels.map((ec) => ({
        epgSourceId: sourceId,
        xmltvChannelId: ec.xmltvChannelId,
        displayName: ec.displayName,
        iconUrl: ec.iconUrl,
        mappedChannelId: channelByTvgId.get(ec.xmltvChannelId.toLowerCase()) ?? null,
      }))
    );
  }

  if (parsed.programs.length > 0) {
    // Batch insert programs in chunks of 250
    for (let i = 0; i < parsed.programs.length; i += 250) {
      const slice = parsed.programs.slice(i, i + 250);
      await db.insert(programs).values(
        slice.map((p) => ({
          epgSourceId: sourceId,
          xmltvChannelId: p.xmltvChannelId,
          title: p.title,
          description: p.description,
          category: p.category,
          posterUrl: p.posterUrl ?? null,
          startTime: p.startTime,
          endTime: p.endTime,
          lang: p.lang,
        }))
      );
    }
  }

  await db
    .update(epgSources)
    .set({
      lastFetchedAt: new Date(),
      lastStatus: 'success',
      lastError: null,
      channelCount: parsed.channels.length,
      programCount: parsed.programs.length,
      updatedAt: new Date(),
    })
    .where(eq(epgSources.id, sourceId));

  return parsed;
}

adminRouter.post(
  '/epg/sources',
  requireRole(['super_admin', 'admin', 'operator']),
  async (req: AuthRequest, res) => {
    try {
      const { name, sourceType, sourceUrl, xmlContent, timezoneOffset } = req.body as {
        name?: string;
        sourceType?: 'url' | 'file';
        sourceUrl?: string;
        xmlContent?: string;
        timezoneOffset?: string;
      };

      if (!name?.trim()) return res.status(400).json({ error: 'EPG source name is required.' });

      let rawXml = xmlContent || '';
      if (sourceType === 'url') {
        if (!sourceUrl?.trim()) return res.status(400).json({ error: 'EPG URL is required.' });
        rawXml = await safeFetchExternalText(sourceUrl);
      }

      const [source] = await db
        .insert(epgSources)
        .values({
          name: name.trim(),
          sourceType: sourceType || 'file',
          sourceUrl: sourceUrl?.trim() || null,
          timezoneOffset: timezoneOffset || '+00:00',
        })
        .returning();

      let ingested: ParsedXmltvResult = { channels: [], programs: [], warnings: [] };
      if (rawXml.trim()) {
        ingested = await ingestXmltvIntoSource(source.id, rawXml, source.timezoneOffset);
        await dispatchSyncToAllActiveDevices('auto_sync');
      }

      await writeAudit(req, 'epg.create', 'epg_source', source.id, {
        name: source.name,
        channels: ingested.channels.length,
        programs: ingested.programs.length,
      });

      res.status(201).json({ source, ingested });
    } catch (error) {
      res.status(400).json({
        error: error instanceof Error ? error.message : 'Failed to create EPG source.',
      });
    }
  }
);

adminRouter.post(
  '/epg/sources/:id/refresh',
  requireRole(['super_admin', 'admin', 'operator']),
  async (req: AuthRequest, res) => {
    try {
      const [source] = await db
        .select()
        .from(epgSources)
        .where(eq(epgSources.id, req.params.id))
        .limit(1);
      if (!source) return res.status(404).json({ error: 'EPG source not found.' });
      if (!source.sourceUrl) {
        return res.status(400).json({ error: 'Source has no remote URL configured.' });
      }
      const rawXml = await safeFetchExternalText(source.sourceUrl);
      const ingested = await ingestXmltvIntoSource(source.id, rawXml, source.timezoneOffset);
      const synced = await dispatchSyncToAllActiveDevices('auto_sync');
      await writeAudit(req, 'epg.refresh', 'epg_source', source.id, {
        programs: ingested.programs.length,
        dispatchedDevices: synced.length,
      });
      res.json({
        channels: ingested.channels.length,
        programs: ingested.programs.length,
        dispatchedDevices: synced.length,
      });
    } catch (error) {
      res.status(400).json({
        error: error instanceof Error ? error.message : 'Failed to refresh EPG source.',
      });
    }
  }
);

adminRouter.delete(
  '/epg/sources/:id',
  requireRole(['super_admin', 'admin']),
  async (req: AuthRequest, res) => {
    try {
      await db.delete(epgSources).where(eq(epgSources.id, req.params.id));
      await dispatchSyncToAllActiveDevices('auto_sync');
      res.json({ deleted: true });
    } catch (error) {
      res.status(500).json({ error: 'Failed to delete EPG source.' });
    }
  }
);

adminRouter.get('/epg/channels', async (_req, res) => {
  try {
    const rows = await db.select().from(epgChannels).orderBy(epgChannels.displayName);
    res.json(rows);
  } catch (error) {
    res.status(500).json({ error: 'Failed to load EPG channels.' });
  }
});

adminRouter.post(
  '/epg/map',
  requireRole(['super_admin', 'admin', 'operator']),
  async (req: AuthRequest, res) => {
    try {
      const { epgChannelId, channelId } = req.body as {
        epgChannelId: string;
        channelId: string | null;
      };
      const [epgCh] = await db
        .update(epgChannels)
        .set({ mappedChannelId: channelId || null })
        .where(eq(epgChannels.id, epgChannelId))
        .returning();

      if (!epgCh) return res.status(404).json({ error: 'EPG channel not found.' });

      if (channelId) {
        const [mappedCh] = await db
          .update(channels)
          .set({ tvgId: epgCh.xmltvChannelId, updatedAt: new Date() })
          .where(eq(channels.id, channelId))
          .returning();
        if (mappedCh) {
          await autoPublishAndSyncPlaylists(
            [mappedCh.playlistId],
            req.adminUser?.email || 'admin',
            `Mapped EPG (${epgCh.xmltvChannelId}) to ${mappedCh.name}`
          );
        }
      }

      await writeAudit(req, 'epg.map_channel', 'epg_channel', epgChannelId, { channelId });
      res.json(epgCh);
    } catch (error) {
      res.status(500).json({ error: 'Failed to map EPG channel.' });
    }
  }
);

adminRouter.get('/epg/programs', async (_req, res) => {
  try {
    const rows = await db.select().from(programs).orderBy(programs.startTime).limit(200);
    res.json(rows);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch EPG programs.' });
  }
});

// 6. Device Management & Pairing
adminRouter.get('/devices', async (_req, res) => {
  try {
    const allDevices = await db.select().from(devices).orderBy(desc(devices.createdAt));
    const allGroups = await db.select().from(deviceGroups);
    const groupMap = new Map(allGroups.map((g) => [g.id, g.name]));
    const assignments = await db.select().from(deviceAssignments);
    const allPlaylists = await db.select().from(playlists);
    const playlistMap = new Map(allPlaylists.map((p) => [p.id, p.name]));

    res.json(
      allDevices.map((d) => {
        const deviceAssignmentsList = assignments.filter(
          (a) =>
            a.deviceId === d.id ||
            (d.groupId && a.deviceGroupId === d.groupId) ||
            (a.assignmentMode === 'central' && !a.deviceId && !a.deviceGroupId)
        );
        return {
          ...d,
          groupName: d.groupId ? groupMap.get(d.groupId) ?? null : null,
          assignedPlaylists: Array.from(
            new Map(
              deviceAssignmentsList.map((a) => [
                a.playlistId,
                {
                  assignmentId: a.id,
                  playlistId: a.playlistId,
                  playlistName: playlistMap.get(a.playlistId) || 'Playlist',
                  mode: a.assignmentMode,
                },
              ])
            ).values()
          ),
        };
      })
    );
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch devices.' });
  }
});

adminRouter.post(
  '/devices/pair',
  requireRole(['super_admin', 'admin', 'operator']),
  async (req: AuthRequest, res) => {
    try {
      const { pairingCode, deviceName, groupId, playlistIds } = req.body as {
        pairingCode?: string;
        deviceName?: string;
        groupId?: string | null;
        playlistIds?: string[];
      };

      if (!pairingCode?.trim()) {
        return res.status(400).json({ error: 'Pairing code is required.' });
      }

      const normalizedCode = pairingCode.trim().toUpperCase();
      const [device] = await db
        .select()
        .from(devices)
        .where(eq(devices.pairingCode, normalizedCode))
        .limit(1);

      if (!device) {
        return res.status(404).json({ error: 'Invalid or expired pairing code.' });
      }

      if (device.pairingExpiresAt && device.pairingExpiresAt < new Date()) {
        return res.status(410).json({ error: 'Pairing code has expired. Generate a new code on the TV.' });
      }

      const [approved] = await db
        .update(devices)
        .set({
          deviceName: deviceName?.trim() || device.deviceName,
          groupId: groupId || null,
          status: 'active',
          lastOnlineAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(devices.id, device.id))
        .returning();

      if (Array.isArray(playlistIds) && playlistIds.length > 0) {
        for (const plId of playlistIds) {
          await db.insert(deviceAssignments).values({
            playlistId: plId,
            deviceId: device.id,
            assignmentMode: playlistIds.length > 1 ? 'multi' : 'individual',
            assignedBy: req.adminUser?.email || 'admin',
          });
        }
      } else {
        // Ensure quick-approved or newly paired TVs receive enabled playlists if no central/group assignment covers them
        const existingAssignments = await db.select().from(deviceAssignments);
        const alreadyCovered = existingAssignments.some(
          (a) =>
            a.deviceId === device.id ||
            (approved.groupId && a.deviceGroupId === approved.groupId) ||
            (a.assignmentMode === 'central' && !a.deviceId && !a.deviceGroupId)
        );
        if (!alreadyCovered) {
          const enabledPlaylists = await db
            .select()
            .from(playlists)
            .where(eq(playlists.isEnabled, true));
          for (const pl of enabledPlaylists) {
            await db.insert(deviceAssignments).values({
              playlistId: pl.id,
              deviceId: device.id,
              assignmentMode: enabledPlaylists.length > 1 ? 'multi' : 'individual',
              assignedBy: req.adminUser?.email || 'admin',
            });
          }
        }
      }

      await writeAudit(req, 'device.pair_approve', 'device', device.id, {
        deviceName: approved.deviceName,
        platform: approved.platform,
      });

      res.json(approved);
    } catch (error) {
      console.error('Device pairing approval error:', error);
      res.status(500).json({ error: 'Failed to approve device pairing.' });
    }
  }
);

adminRouter.patch(
  '/devices/:id',
  requireRole(['super_admin', 'admin', 'operator']),
  async (req: AuthRequest, res) => {
    try {
      const { deviceName, groupId, status } = req.body;
      const [updated] = await db
        .update(devices)
        .set({
          ...(deviceName !== undefined ? { deviceName: String(deviceName).trim() } : {}),
          ...(groupId !== undefined ? { groupId: groupId || null } : {}),
          ...(status !== undefined ? { status } : {}),
          updatedAt: new Date(),
        })
        .where(eq(devices.id, req.params.id))
        .returning();

      if (!updated) return res.status(404).json({ error: 'Device not found.' });
      await notifyDeviceSync(updated.id, updated.status === 'revoked' ? 'revoke' : 'auto_sync');
      await writeAudit(req, 'device.update', 'device', req.params.id, { deviceName, groupId, status });
      res.json(updated);
    } catch (error) {
      res.status(500).json({ error: 'Failed to update device.' });
    }
  }
);

adminRouter.post(
  '/devices/:id/revoke',
  requireRole(['super_admin', 'admin']),
  async (req: AuthRequest, res) => {
    try {
      const { id } = req.params;
      await db
        .update(deviceCredentials)
        .set({ isRevoked: true })
        .where(eq(deviceCredentials.deviceId, id));

      const [updated] = await db
        .update(devices)
        .set({ status: 'revoked', updatedAt: new Date() })
        .where(eq(devices.id, id))
        .returning();

      if (!updated) return res.status(404).json({ error: 'Device not found.' });

      await notifyDeviceSync(id, 'revoke');
      await writeAudit(req, 'device.revoke', 'device', id, { deviceName: updated.deviceName });
      res.json(updated);
    } catch (error) {
      res.status(500).json({ error: 'Failed to revoke device.' });
    }
  }
);

adminRouter.post(
  '/devices/:id/sync',
  requireRole(['super_admin', 'admin', 'operator']),
  async (req: AuthRequest, res) => {
    try {
      const event = await notifyDeviceSync(req.params.id, 'manual_sync');
      await writeAudit(req, 'device.manual_sync', 'device', req.params.id);
      res.json(event);
    } catch (error) {
      res.status(500).json({ error: 'Failed to trigger device synchronization.' });
    }
  }
);

// 7. Device Groups & Playlist Assignments
adminRouter.get('/device-groups', async (_req, res) => {
  try {
    const groups = await db.select().from(deviceGroups).orderBy(deviceGroups.name);
    res.json(groups);
  } catch (error) {
    res.status(500).json({ error: 'Failed to load device groups.' });
  }
});

adminRouter.post(
  '/device-groups',
  requireRole(['super_admin', 'admin', 'operator']),
  async (req: AuthRequest, res) => {
    try {
      const { name, description } = req.body;
      if (!name?.trim()) return res.status(400).json({ error: 'Group name is required.' });
      const [created] = await db
        .insert(deviceGroups)
        .values({ name: String(name).trim(), description: description?.trim() || null })
        .returning();
      await writeAudit(req, 'device_group.create', 'device_group', created.id, { name });
      res.status(201).json(created);
    } catch (error) {
      res.status(400).json({ error: 'Group already exists or invalid.' });
    }
  }
);

adminRouter.delete(
  '/device-groups/:id',
  requireRole(['super_admin', 'admin']),
  async (req: AuthRequest, res) => {
    try {
      await db.delete(deviceGroups).where(eq(deviceGroups.id, req.params.id));
      res.json({ deleted: true });
    } catch (error) {
      res.status(500).json({ error: 'Failed to delete device group.' });
    }
  }
);

adminRouter.get('/assignments', async (_req, res) => {
  try {
    const rows = await db
      .select()
      .from(deviceAssignments)
      .orderBy(desc(deviceAssignments.createdAt));
    res.json(rows);
  } catch (error) {
    res.status(500).json({ error: 'Failed to load playlist assignments.' });
  }
});

adminRouter.post(
  '/assignments',
  requireRole(['super_admin', 'admin', 'operator']),
  async (req: AuthRequest, res) => {
    try {
      const { playlistId, deviceId, deviceGroupId, assignmentMode, priority } = req.body;
      if (!playlistId) return res.status(400).json({ error: 'playlistId is required.' });

      const [created] = await db
        .insert(deviceAssignments)
        .values({
          playlistId,
          deviceId: deviceId || null,
          deviceGroupId: deviceGroupId || null,
          assignmentMode: assignmentMode || (deviceId ? 'individual' : 'central'),
          priority: Number(priority) || 0,
          assignedBy: req.adminUser?.email || 'admin',
        })
        .returning();

      const [pl] = await db.select().from(playlists).where(eq(playlists.id, playlistId)).limit(1);
      if (pl) {
        await dispatchPlaylistSyncEvents(pl.id, pl.activeVersionNumber, 'manual_sync');
      }

      await writeAudit(req, 'assignment.create', 'device_assignment', created.id, {
        playlistId,
        deviceId,
        deviceGroupId,
        assignmentMode,
      });

      res.status(201).json(created);
    } catch (error) {
      res.status(500).json({ error: 'Failed to create playlist assignment.' });
    }
  }
);

adminRouter.delete(
  '/assignments/:id',
  requireRole(['super_admin', 'admin', 'operator']),
  async (req: AuthRequest, res) => {
    try {
      const [deleted] = await db
        .delete(deviceAssignments)
        .where(eq(deviceAssignments.id, req.params.id))
        .returning();

      if (deleted) {
        if (deleted.deviceId) {
          await notifyDeviceSync(deleted.deviceId, 'auto_sync');
        } else if (deleted.deviceGroupId) {
          const groupDevices = await db
            .select({ id: devices.id })
            .from(devices)
            .where(eq(devices.groupId, deleted.deviceGroupId));
          await dispatchSyncToDeviceIds(
            groupDevices.map((d) => d.id),
            { eventType: 'auto_sync' }
          );
        } else {
          await dispatchSyncToAllActiveDevices('auto_sync');
        }
      }

      await writeAudit(req, 'assignment.delete', 'device_assignment', req.params.id);
      res.json({ deleted: true });
    } catch (error) {
      res.status(500).json({ error: 'Failed to remove assignment.' });
    }
  }
);

// 8. Synchronization, Diagnostics, Admin Users, Audit Logs, Settings
adminRouter.get('/sync-events', async (_req, res) => {
  try {
    const rows = await db
      .select()
      .from(syncEvents)
      .orderBy(desc(syncEvents.createdAt))
      .limit(100);
    res.json(rows);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch sync events.' });
  }
});

adminRouter.get('/diagnostics', async (_req, res) => {
  try {
    const rows = await db
      .select()
      .from(playbackDiagnostics)
      .orderBy(desc(playbackDiagnostics.createdAt))
      .limit(100);
    res.json(rows);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch playback diagnostics.' });
  }
});

adminRouter.get('/users', async (_req, res) => {
  try {
    const rows = await db.select().from(adminUsers).orderBy(desc(adminUsers.createdAt));
    res.json(rows);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch admin users.' });
  }
});

adminRouter.post(
  '/users',
  requireRole(['super_admin']),
  async (req: AuthRequest, res) => {
    try {
      const { email, displayName, role } = req.body as {
        email?: string;
        displayName?: string;
        role?: string;
      };
      if (!email?.trim()) return res.status(400).json({ error: 'Email is required.' });
      const normalized = email.trim().toLowerCase();
      const [created] = await db
        .insert(adminUsers)
        .values({
          uid: `invited:${normalized}`,
          email: normalized,
          displayName: displayName?.trim() || normalized.split('@')[0],
          role: role || 'operator',
          isActive: true,
        })
        .returning();

      await writeAudit(req, 'admin_user.invite', 'admin_user', created.id, { email: normalized, role });
      res.status(201).json(created);
    } catch (error) {
      res.status(400).json({ error: 'Administrator already exists.' });
    }
  }
);

adminRouter.patch(
  '/users/:id',
  requireRole(['super_admin']),
  async (req: AuthRequest, res) => {
    try {
      const { role, isActive } = req.body;
      const [updated] = await db
        .update(adminUsers)
        .set({
          ...(role !== undefined ? { role } : {}),
          ...(isActive !== undefined ? { isActive: Boolean(isActive) } : {}),
          updatedAt: new Date(),
        })
        .where(eq(adminUsers.id, req.params.id))
        .returning();
      await writeAudit(req, 'admin_user.update', 'admin_user', req.params.id, { role, isActive });
      res.json(updated);
    } catch (error) {
      res.status(500).json({ error: 'Failed to update admin user.' });
    }
  }
);

adminRouter.get('/audit-logs', async (_req, res) => {
  try {
    const rows = await db.select().from(auditLogs).orderBy(desc(auditLogs.createdAt)).limit(150);
    res.json(rows);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch audit logs.' });
  }
});

adminRouter.get('/settings', async (_req, res) => {
  try {
    await db
      .insert(appSettings)
      .values({
        key: 'require_manual_pairing',
        value: false,
        description:
          'When false, TVs open directly with zero configuration; when true, new TVs wait for admin pairing code approval',
        updatedBy: 'system',
      })
      .onConflictDoNothing();
    const rows = await db.select().from(appSettings).orderBy(appSettings.key);
    res.json(rows);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch settings.' });
  }
});

adminRouter.put(
  '/settings',
  requireRole(['super_admin', 'admin']),
  async (req: AuthRequest, res) => {
    try {
      const { key, value, description } = req.body as {
        key: string;
        value: unknown;
        description?: string;
      };
      if (!key) return res.status(400).json({ error: 'Setting key is required.' });

      const [saved] = await db
        .insert(appSettings)
        .values({
          key,
          value,
          description: description || null,
          updatedBy: req.adminUser?.email || 'admin',
          updatedAt: new Date(),
        })
        .onConflictDoUpdate({
          target: appSettings.key,
          set: {
            value,
            updatedBy: req.adminUser?.email || 'admin',
            updatedAt: new Date(),
          },
        })
        .returning();

      await writeAudit(req, 'settings.update', 'app_settings', saved.id, { key, value });
      res.json(saved);
    } catch (error) {
      res.status(500).json({ error: 'Failed to update setting.' });
    }
  }
);
