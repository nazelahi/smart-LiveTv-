import type { DeviceSyncConfig } from '../../packages/core-models/src/index';

const DB_NAME = 'vanguard_tv_cache';
const DB_VERSION = 1;
const STORE_KV = 'kv_store';

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_KV)) {
        db.createObjectStore(STORE_KV);
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function kvGet<T>(key: string): Promise<T | null> {
  try {
    const db = await openDb();
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_KV, 'readonly');
      const store = tx.objectStore(STORE_KV);
      const req = store.get(key);
      req.onsuccess = () => resolve((req.result as T) ?? null);
      req.onerror = () => reject(req.error);
    });
  } catch {
    return null;
  }
}

async function kvSet<T>(key: string, value: T): Promise<void> {
  try {
    const db = await openDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_KV, 'readwrite');
      const store = tx.objectStore(STORE_KV);
      const req = store.put(value, key);
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });
  } catch {
    // Graceful degradation if IndexedDB is restricted
  }
}

async function kvDelete(key: string): Promise<void> {
  try {
    const db = await openDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_KV, 'readwrite');
      const store = tx.objectStore(STORE_KV);
      const req = store.delete(key);
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });
  } catch {
    // Ignore
  }
}

export interface TvDeviceIdentity {
  hardwareId: string;
  deviceId: string | null;
  deviceToken: string | null;
  deviceName: string;
}

export interface TvPreferences {
  aspectRatio: 'contain' | 'cover' | '16:9' | '4:3';
  lastPlayedChannelId: string | null;
}

export const tvStorage = {
  async getOrCreateHardwareId(): Promise<string> {
    const existing = await kvGet<string>('hardware_id');
    if (existing) return existing;
    const generated = `TV-${crypto.randomUUID().slice(0, 8).toUpperCase()}`;
    await kvSet('hardware_id', generated);
    return generated;
  },

  async getDeviceIdentity(): Promise<TvDeviceIdentity | null> {
    return kvGet<TvDeviceIdentity>('device_identity');
  },

  async saveDeviceIdentity(identity: TvDeviceIdentity): Promise<void> {
    await kvSet('device_identity', identity);
  },

  async clearDeviceIdentity(): Promise<void> {
    await kvDelete('device_identity');
    await kvDelete('cached_sync_config');
  },

  async getCachedConfig(): Promise<DeviceSyncConfig | null> {
    return kvGet<DeviceSyncConfig>('cached_sync_config');
  },

  async saveCachedConfig(config: DeviceSyncConfig): Promise<void> {
    await kvSet('cached_sync_config', config);
  },

  async getLocalFavorites(): Promise<string[]> {
    return (await kvGet<string[]>('local_favorites')) ?? [];
  },

  async saveLocalFavorites(ids: string[]): Promise<void> {
    await kvSet('local_favorites', ids);
  },

  async getLocalHistory(): Promise<Array<{ channelId: string; watchedAt: string }>> {
    return (await kvGet<Array<{ channelId: string; watchedAt: string }>>('local_history')) ?? [];
  },

  async pushLocalHistory(channelId: string): Promise<void> {
    const current = await this.getLocalHistory();
    const filtered = current.filter((h) => h.channelId !== channelId);
    filtered.unshift({ channelId, watchedAt: new Date().toISOString() });
    await kvSet('local_history', filtered.slice(0, 25));
  },

  async getPreferences(): Promise<TvPreferences> {
    return (
      (await kvGet<TvPreferences>('tv_preferences')) ?? {
        aspectRatio: 'contain',
        lastPlayedChannelId: null,
      }
    );
  },

  async savePreferences(prefs: TvPreferences): Promise<void> {
    await kvSet('tv_preferences', prefs);
  },
};
