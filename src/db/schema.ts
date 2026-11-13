import { relations } from 'drizzle-orm';
import {
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

// 1. Admin Users
export const adminUsers = pgTable(
  'admin_users',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    uid: text('uid').notNull().unique(),
    email: text('email').notNull(),
    displayName: text('display_name'),
    role: text('role').notNull().default('admin'), // super_admin | admin | operator | viewer
    isActive: boolean('is_active').notNull().default(true),
    avatarUrl: text('avatar_url'),
    lastLoginAt: timestamp('last_login_at'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
  },
  (table) => [index('admin_users_email_idx').on(table.email)]
);

// 2. EPG Sources (defined early so playlists can reference it)
export const epgSources = pgTable('epg_sources', {
  id: uuid('id').defaultRandom().primaryKey(),
  name: text('name').notNull(),
  sourceType: text('source_type').notNull().default('url'), // url | file
  sourceUrl: text('source_url'),
  timezoneOffset: text('timezone_offset').notNull().default('+00:00'),
  isEnabled: boolean('is_enabled').notNull().default(true),
  lastFetchedAt: timestamp('last_fetched_at'),
  lastStatus: text('last_status').default('pending'), // pending | success | error
  lastError: text('last_error'),
  channelCount: integer('channel_count').notNull().default(0),
  programCount: integer('program_count').notNull().default(0),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

// 3. Playlists
export const playlists = pgTable('playlists', {
  id: uuid('id').defaultRandom().primaryKey(),
  name: text('name').notNull(),
  description: text('description'),
  sourceType: text('source_type').notNull().default('url'), // url | file | manual
  sourceUrl: text('source_url'),
  autoRefreshIntervalMins: integer('auto_refresh_interval_mins').notNull().default(360),
  isEnabled: boolean('is_enabled').notNull().default(true),
  activeVersionNumber: integer('active_version_number').notNull().default(0),
  epgSourceId: uuid('epg_source_id').references(() => epgSources.id, { onDelete: 'set null' }),
  createdBy: text('created_by'),
  lastFetchedAt: timestamp('last_fetched_at'),
  lastFetchStatus: text('last_fetch_status').default('pending'), // pending | success | error
  lastError: text('last_error'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

// 4. Playlist Versions (immutable published snapshots for versioning & rollback)
export const playlistVersions = pgTable(
  'playlist_versions',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    playlistId: uuid('playlist_id')
      .notNull()
      .references(() => playlists.id, { onDelete: 'cascade' }),
    versionNumber: integer('version_number').notNull(),
    status: text('status').notNull().default('published'), // draft | published | archived
    channelCount: integer('channel_count').notNull().default(0),
    checksum: text('checksum').notNull(),
    changelog: text('changelog'),
    snapshotJson: jsonb('snapshot_json').notNull(),
    publishedBy: text('published_by'),
    publishedAt: timestamp('published_at').defaultNow().notNull(),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex('playlist_versions_playlist_ver_idx').on(table.playlistId, table.versionNumber),
  ]
);

// 5. Categories
export const categories = pgTable('categories', {
  id: uuid('id').defaultRandom().primaryKey(),
  name: text('name').notNull().unique(),
  slug: text('slug').notNull().unique(),
  sortOrder: integer('sort_order').notNull().default(0),
  iconName: text('icon_name').default('tv'),
  isHidden: boolean('is_hidden').notNull().default(false),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

// 6. Channels (raw imported channel records)
export const channels = pgTable(
  'channels',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    playlistId: uuid('playlist_id')
      .notNull()
      .references(() => playlists.id, { onDelete: 'cascade' }),
    tvgId: text('tvg_id'),
    tvgName: text('tvg_name'),
    name: text('name').notNull(),
    logoUrl: text('logo_url'),
    groupTitle: text('group_title'),
    categoryId: uuid('category_id').references(() => categories.id, { onDelete: 'set null' }),
    channelNumber: integer('channel_number').notNull().default(0),
    streamUrl: text('stream_url').notNull(),
    httpHeaders: jsonb('http_headers').$type<Record<string, string>>().default({}),
    streamFormat: text('stream_format').notNull().default('auto'), // hls | mpegts | dash | auto
    isEnabled: boolean('is_enabled').notNull().default(true),
    isHidden: boolean('is_hidden').notNull().default(false),
    sortOrder: integer('sort_order').notNull().default(0),
    rawAttributes: jsonb('raw_attributes').$type<Record<string, string>>().default({}),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
  },
  (table) => [
    index('channels_playlist_idx').on(table.playlistId),
    index('channels_tvg_id_idx').on(table.tvgId),
  ]
);

// 7. Channel Overrides (non-destructive administrative edits preserved across re-imports)
export const channelOverrides = pgTable('channel_overrides', {
  id: uuid('id').defaultRandom().primaryKey(),
  channelId: uuid('channel_id')
    .notNull()
    .unique()
    .references(() => channels.id, { onDelete: 'cascade' }),
  customName: text('custom_name'),
  customLogoUrl: text('custom_logo_url'),
  customCategoryId: uuid('custom_category_id').references(() => categories.id, {
    onDelete: 'set null',
  }),
  customChannelNumber: integer('custom_channel_number'),
  customStreamUrl: text('custom_stream_url'),
  customHttpHeaders: jsonb('custom_http_headers').$type<Record<string, string>>(),
  isEnabledOverride: boolean('is_enabled_override'),
  isHiddenOverride: boolean('is_hidden_override'),
  customSortOrder: integer('custom_sort_order'),
  updatedBy: text('updated_by'),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

// 8. EPG Channels
export const epgChannels = pgTable(
  'epg_channels',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    epgSourceId: uuid('epg_source_id')
      .notNull()
      .references(() => epgSources.id, { onDelete: 'cascade' }),
    xmltvChannelId: text('xmltv_channel_id').notNull(),
    displayName: text('display_name').notNull(),
    iconUrl: text('icon_url'),
    mappedChannelId: uuid('mapped_channel_id').references(() => channels.id, {
      onDelete: 'set null',
    }),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex('epg_channels_source_xmltv_idx').on(table.epgSourceId, table.xmltvChannelId),
  ]
);

// 9. Programs
export const programs = pgTable(
  'programs',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    epgSourceId: uuid('epg_source_id')
      .notNull()
      .references(() => epgSources.id, { onDelete: 'cascade' }),
    xmltvChannelId: text('xmltv_channel_id').notNull(),
    title: text('title').notNull(),
    description: text('description'),
    category: text('category'),
    posterUrl: text('poster_url'),
    startTime: timestamp('start_time').notNull(),
    endTime: timestamp('end_time').notNull(),
    lang: text('lang').default('en'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => [
    index('programs_channel_time_idx').on(table.xmltvChannelId, table.startTime, table.endTime),
  ]
);

// 10. Device Groups
export const deviceGroups = pgTable('device_groups', {
  id: uuid('id').defaultRandom().primaryKey(),
  name: text('name').notNull().unique(),
  description: text('description'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

// 11. Devices
export const devices = pgTable(
  'devices',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    deviceName: text('device_name').notNull(),
    platform: text('platform').notNull().default('android_tv'), // android_tv | google_tv | samsung_tizen | lg_webos | web_tv | android_mobile
    model: text('model').default('Generic Smart TV'),
    hardwareId: text('hardware_id').notNull().unique(),
    pairingCode: text('pairing_code'),
    pairingExpiresAt: timestamp('pairing_expires_at'),
    status: text('status').notNull().default('pending'), // pending | active | offline | revoked
    appVersion: text('app_version').default('1.0.0'),
    groupId: uuid('group_id').references(() => deviceGroups.id, { onDelete: 'set null' }),
    lastOnlineAt: timestamp('last_online_at'),
    lastSyncAt: timestamp('last_sync_at'),
    lastSyncVersion: integer('last_sync_version').default(0),
    lastError: text('last_error'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
  },
  (table) => [index('devices_pairing_code_idx').on(table.pairingCode)]
);

// 12. Device Credentials (revocable hashed tokens)
export const deviceCredentials = pgTable(
  'device_credentials',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    deviceId: uuid('device_id')
      .notNull()
      .references(() => devices.id, { onDelete: 'cascade' }),
    tokenHash: text('token_hash').notNull().unique(),
    tokenPrefix: text('token_prefix').notNull(),
    isRevoked: boolean('is_revoked').notNull().default(false),
    expiresAt: timestamp('expires_at').notNull(),
    rotatedAt: timestamp('rotated_at'),
    lastUsedAt: timestamp('last_used_at'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => [index('device_credentials_device_idx').on(table.deviceId)]
);

// 13. Device Assignments (Central / Individual / Multi-playlist)
export const deviceAssignments = pgTable(
  'device_assignments',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    playlistId: uuid('playlist_id')
      .notNull()
      .references(() => playlists.id, { onDelete: 'cascade' }),
    deviceId: uuid('device_id').references(() => devices.id, { onDelete: 'cascade' }),
    deviceGroupId: uuid('device_group_id').references(() => deviceGroups.id, {
      onDelete: 'cascade',
    }),
    assignmentMode: text('assignment_mode').notNull().default('individual'), // central | individual | multi
    priority: integer('priority').notNull().default(0),
    assignedBy: text('assigned_by'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => [
    index('device_assignments_device_idx').on(table.deviceId),
    index('device_assignments_group_idx').on(table.deviceGroupId),
  ]
);

// 14. Favorites
export const favorites = pgTable(
  'favorites',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    deviceId: uuid('device_id')
      .notNull()
      .references(() => devices.id, { onDelete: 'cascade' }),
    channelId: uuid('channel_id')
      .notNull()
      .references(() => channels.id, { onDelete: 'cascade' }),
    sortOrder: integer('sort_order').notNull().default(0),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => [uniqueIndex('favorites_device_channel_idx').on(table.deviceId, table.channelId)]
);

// 15. Watch History
export const watchHistory = pgTable(
  'watch_history',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    deviceId: uuid('device_id')
      .notNull()
      .references(() => devices.id, { onDelete: 'cascade' }),
    channelId: uuid('channel_id')
      .notNull()
      .references(() => channels.id, { onDelete: 'cascade' }),
    watchedAt: timestamp('watched_at').defaultNow().notNull(),
    durationSeconds: integer('duration_seconds').notNull().default(0),
  },
  (table) => [index('watch_history_device_idx').on(table.deviceId, table.watchedAt)]
);

// 16. Sync Events
export const syncEvents = pgTable(
  'sync_events',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    deviceId: uuid('device_id').references(() => devices.id, { onDelete: 'cascade' }),
    playlistId: uuid('playlist_id').references(() => playlists.id, { onDelete: 'set null' }),
    playlistVersion: integer('playlist_version').notNull().default(0),
    eventType: text('event_type').notNull().default('publish'), // publish | manual_sync | auto_sync | rollback | revoke
    status: text('status').notNull().default('pending'), // pending | delivered | acknowledged | failed
    errorMessage: text('error_message'),
    payload: jsonb('payload').$type<Record<string, unknown>>().default({}),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    acknowledgedAt: timestamp('acknowledged_at'),
  },
  (table) => [index('sync_events_device_status_idx').on(table.deviceId, table.status)]
);

// 17. Playback Diagnostics
export const playbackDiagnostics = pgTable(
  'playback_diagnostics',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    deviceId: uuid('device_id')
      .notNull()
      .references(() => devices.id, { onDelete: 'cascade' }),
    channelId: uuid('channel_id').references(() => channels.id, { onDelete: 'set null' }),
    streamFormat: text('stream_format').notNull().default('hls'),
    status: text('status').notNull().default('ok'), // ok | buffering | error | recovered
    latencyMs: integer('latency_ms').default(0),
    bitrateKbps: integer('bitrate_kbps').default(0),
    errorCode: text('error_code'),
    errorMessage: text('error_message'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => [index('playback_diagnostics_device_idx').on(table.deviceId, table.createdAt)]
);

// 18. Audit Logs
export const auditLogs = pgTable(
  'audit_logs',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    actorUid: text('actor_uid'),
    actorEmail: text('actor_email'),
    action: text('action').notNull(),
    resourceType: text('resource_type').notNull(),
    resourceId: text('resource_id'),
    details: jsonb('details').$type<Record<string, unknown>>().default({}),
    ipAddress: text('ip_address'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => [index('audit_logs_created_idx').on(table.createdAt)]
);

// 19. App Settings
export const appSettings = pgTable('app_settings', {
  id: uuid('id').defaultRandom().primaryKey(),
  key: text('key').notNull().unique(),
  value: jsonb('value').$type<unknown>().notNull(),
  description: text('description'),
  updatedBy: text('updated_by'),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

// Drizzle Relations
export const playlistsRelations = relations(playlists, ({ one, many }) => ({
  epgSource: one(epgSources, {
    fields: [playlists.epgSourceId],
    references: [epgSources.id],
  }),
  channels: many(channels),
  versions: many(playlistVersions),
  assignments: many(deviceAssignments),
}));

export const channelsRelations = relations(channels, ({ one }) => ({
  playlist: one(playlists, {
    fields: [channels.playlistId],
    references: [playlists.id],
  }),
  category: one(categories, {
    fields: [channels.categoryId],
    references: [categories.id],
  }),
  override: one(channelOverrides, {
    fields: [channels.id],
    references: [channelOverrides.channelId],
  }),
}));

export const devicesRelations = relations(devices, ({ one, many }) => ({
  group: one(deviceGroups, {
    fields: [devices.groupId],
    references: [deviceGroups.id],
  }),
  credentials: many(deviceCredentials),
  assignments: many(deviceAssignments),
  favorites: many(favorites),
  watchHistory: many(watchHistory),
  syncEvents: many(syncEvents),
}));
