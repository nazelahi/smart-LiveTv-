import crypto from 'node:crypto';
import { asc, desc, eq } from 'drizzle-orm';
import { db } from '../db/index.ts';
import {
  categories,
  channelOverrides,
  channels,
  playlists,
  playlistVersions,
} from '../db/schema.ts';
import type { EffectiveChannel, StreamFormat } from '../../packages/core-models/src/index.ts';

export async function getEffectiveChannels(playlistId?: string): Promise<EffectiveChannel[]> {
  try {
    const query = db
      .select({
        channel: channels,
        override: channelOverrides,
        playlistName: playlists.name,
      })
      .from(channels)
      .innerJoin(playlists, eq(channels.playlistId, playlists.id))
      .leftJoin(channelOverrides, eq(channels.id, channelOverrides.channelId))
      .orderBy(asc(channels.sortOrder), asc(channels.channelNumber), asc(channels.name));

    const rows = playlistId
      ? await query.where(eq(channels.playlistId, playlistId))
      : await query;

    const allCats = await db.select().from(categories);
    const catMap = new Map(allCats.map((c) => [c.id, c.name]));

    const effective = rows.map(({ channel, override, playlistName }) => {
      const effectiveCategoryId = override?.customCategoryId ?? channel.categoryId ?? null;
      const effectiveCategoryName = effectiveCategoryId
        ? catMap.get(effectiveCategoryId) ?? channel.groupTitle ?? null
        : channel.groupTitle ?? null;

      return {
        id: channel.id,
        playlistId: channel.playlistId,
        playlistName,
        tvgId: channel.tvgId,
        name: override?.customName ?? channel.name,
        rawName: channel.name,
        logoUrl: override?.customLogoUrl ?? channel.logoUrl,
        groupTitle: effectiveCategoryName || channel.groupTitle,
        categoryId: effectiveCategoryId,
        categoryName: effectiveCategoryName,
        channelNumber: override?.customChannelNumber ?? channel.channelNumber,
        streamUrl: override?.customStreamUrl ?? channel.streamUrl,
        httpHeaders:
          (override?.customHttpHeaders as Record<string, string> | null) ??
          (channel.httpHeaders as Record<string, string> | null) ??
          {},
        streamFormat: (channel.streamFormat || 'auto') as StreamFormat,
        isEnabled: override?.isEnabledOverride ?? channel.isEnabled,
        isHidden: override?.isHiddenOverride ?? channel.isHidden,
        sortOrder: override?.customSortOrder ?? channel.sortOrder,
        hasOverride: Boolean(override),
      };
    });

    return effective.sort((a, b) => a.sortOrder - b.sortOrder || a.channelNumber - b.channelNumber);
  } catch (error) {
    console.error('Database error fetching effective channels:', error);
    throw new Error('Failed to load effective channels.', { cause: error });
  }
}

export async function publishPlaylistVersion(
  playlistId: string,
  publishedBy: string,
  changelog = 'Published playlist update'
) {
  try {
    const [playlist] = await db
      .select()
      .from(playlists)
      .where(eq(playlists.id, playlistId))
      .limit(1);

    if (!playlist) {
      throw new Error('Playlist not found.');
    }

    const effectiveChannels = await getEffectiveChannels(playlistId);
    const activeChannels = effectiveChannels.filter((c) => c.isEnabled && !c.isHidden);

    const latestVersions = await db
      .select()
      .from(playlistVersions)
      .where(eq(playlistVersions.playlistId, playlistId))
      .orderBy(desc(playlistVersions.versionNumber))
      .limit(1);

    const nextVersionNumber =
      latestVersions.length > 0 ? latestVersions[0].versionNumber + 1 : 1;

    const snapshotPayload = {
      playlistId,
      playlistName: playlist.name,
      versionNumber: nextVersionNumber,
      channels: activeChannels,
    };

    const checksum = crypto
      .createHash('sha256')
      .update(JSON.stringify(snapshotPayload))
      .digest('hex')
      .slice(0, 16);

    const [createdVersion] = await db
      .insert(playlistVersions)
      .values({
        playlistId,
        versionNumber: nextVersionNumber,
        status: 'published',
        channelCount: activeChannels.length,
        checksum,
        changelog,
        snapshotJson: snapshotPayload,
        publishedBy,
      })
      .returning();

    await db
      .update(playlists)
      .set({
        activeVersionNumber: nextVersionNumber,
        updatedAt: new Date(),
      })
      .where(eq(playlists.id, playlistId));

    return createdVersion;
  } catch (error) {
    console.error('Database error publishing playlist version:', error);
    throw new Error('Failed to publish playlist version.', { cause: error });
  }
}
