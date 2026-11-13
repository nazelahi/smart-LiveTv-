export type AdminRole = 'super_admin' | 'admin' | 'operator' | 'viewer';

export type DevicePlatform =
  | 'android_tv'
  | 'google_tv'
  | 'samsung_tizen'
  | 'lg_webos'
  | 'web_tv'
  | 'android_mobile';

export type DeviceStatus = 'pending' | 'active' | 'offline' | 'revoked';

export type StreamFormat = 'hls' | 'mpegts' | 'dash' | 'auto';

export type AssignmentMode = 'central' | 'individual' | 'multi';

export type SyncEventType = 'publish' | 'manual_sync' | 'auto_sync' | 'rollback' | 'revoke';

export type SyncEventStatus = 'pending' | 'delivered' | 'acknowledged' | 'failed';

export interface ParsedM3UChannel {
  tvgId: string | null;
  tvgName: string | null;
  name: string;
  logoUrl: string | null;
  groupTitle: string | null;
  channelNumber: number;
  streamUrl: string;
  httpHeaders: Record<string, string>;
  streamFormat: StreamFormat;
  rawAttributes: Record<string, string>;
}

export interface ParsedM3UResult {
  epgUrl: string | null;
  channels: ParsedM3UChannel[];
  warnings: string[];
}

export interface EffectiveChannel {
  id: string;
  playlistId: string;
  playlistName?: string;
  tvgId: string | null;
  name: string;
  rawName: string;
  logoUrl: string | null;
  groupTitle: string | null;
  categoryId: string | null;
  categoryName: string | null;
  channelNumber: number;
  streamUrl: string;
  httpHeaders: Record<string, string>;
  streamFormat: StreamFormat;
  isEnabled: boolean;
  isHidden: boolean;
  sortOrder: number;
  hasOverride: boolean;
}

export interface XmltvChannel {
  xmltvChannelId: string;
  displayName: string;
  iconUrl: string | null;
}

export interface XmltvProgram {
  xmltvChannelId: string;
  title: string;
  description: string | null;
  category: string | null;
  posterUrl?: string | null;
  startTime: Date;
  endTime: Date;
  lang: string;
}

export interface ParsedXmltvResult {
  channels: XmltvChannel[];
  programs: XmltvProgram[];
  warnings: string[];
}

export interface DeviceSyncConfig {
  deviceId: string;
  deviceName: string;
  platform: DevicePlatform;
  syncTimestamp: string;
  configVersion: number;
  playlists: Array<{
    id: string;
    name: string;
    versionNumber: number;
    assignmentMode: AssignmentMode;
  }>;
  channels: EffectiveChannel[];
  categories: Array<{
    id: string;
    name: string;
    slug: string;
    sortOrder: number;
  }>;
  epgPrograms: Array<{
    channelTvgId: string;
    title: string;
    description: string | null;
    category: string | null;
    posterUrl?: string | null;
    startTime: string;
    endTime: string;
  }>;
}
