import { Router } from 'express';
import { Readable } from 'node:stream';
import { and, desc, eq } from 'drizzle-orm';
import { db } from '../db/index.ts';
import {
  appSettings,
  channelOverrides,
  channels,
  deviceAssignments,
  deviceCredentials,
  devices,
  favorites,
  playbackDiagnostics,
  playlists,
  syncEvents,
  watchHistory,
} from '../db/schema.ts';
import { requireDeviceAuth, type DeviceAuthRequest } from '../middleware/auth.ts';
import { buildDeviceSyncConfig } from '../services/syncService.ts';
import {
  createRateLimiter,
  generateDeviceToken,
  generatePairingCode,
  validateSafeExternalUrl,
} from '../lib/security.ts';
import { ensureInitialDatabaseSeed } from '../db/seed.ts';

export const deviceRouter = Router();

const pairingRateLimit = createRateLimiter(60 * 1000, 30);

// 0. Zero-touch direct TV bootstrap (no manual pairing needed unless admin enables require_manual_pairing)
deviceRouter.post('/bootstrap', pairingRateLimit, async (req, res) => {
  try {
    await ensureInitialDatabaseSeed();
    const { hardwareId, platform, model, appVersion, deviceName } = req.body as {
      hardwareId?: string;
      platform?: string;
      model?: string;
      appVersion?: string;
      deviceName?: string;
    };

    if (!hardwareId?.trim()) {
      return res.status(400).json({ error: 'hardwareId is required.' });
    }

    const hwId = hardwareId.trim();
    const [manualPairingSetting] = await db
      .select()
      .from(appSettings)
      .where(eq(appSettings.key, 'require_manual_pairing'))
      .limit(1);

    const requireManualPairing = manualPairingSetting?.value === true;

    const existing = await db
      .select()
      .from(devices)
      .where(eq(devices.hardwareId, hwId))
      .limit(1);

    if (existing.length > 0 && existing[0].status === 'revoked') {
      return res.status(403).json({
        status: 'revoked',
        error: 'This TV access has been disabled by an administrator.',
      });
    }

    // If administrator explicitly enabled manual pairing lock, return pairing code
    if (requireManualPairing && (existing.length === 0 || existing[0].status !== 'active')) {
      const pairingCode = generatePairingCode();
      const pairingExpiresAt = new Date(Date.now() + 15 * 60 * 1000);
      if (existing.length > 0) {
        await db
          .update(devices)
          .set({ pairingCode, pairingExpiresAt, updatedAt: new Date() })
          .where(eq(devices.id, existing[0].id));
      } else {
        await db.insert(devices).values({
          hardwareId: hwId,
          deviceName: deviceName?.trim() || `Smart TV (${hwId.slice(-4)})`,
          platform: platform || 'web_tv',
          model: model || 'Smart TV Client',
          appVersion: appVersion || '1.0.0',
          pairingCode,
          pairingExpiresAt,
          status: 'pending',
        });
      }
      return res.json({
        status: 'pending',
        pairingCode,
        expiresAt: pairingExpiresAt.toISOString(),
      });
    }

    // Zero-touch instant activation
    let device = existing[0];
    const now = new Date();
    if (device) {
      const [updated] = await db
        .update(devices)
        .set({
          status: 'active',
          pairingCode: null,
          pairingExpiresAt: null,
          platform: platform || device.platform,
          model: model || device.model,
          appVersion: appVersion || device.appVersion,
          lastOnlineAt: now,
          updatedAt: now,
        })
        .where(eq(devices.id, device.id))
        .returning();
      device = updated;
    } else {
      const [created] = await db
        .insert(devices)
        .values({
          hardwareId: hwId,
          deviceName: deviceName?.trim() || `Smart TV (${hwId.slice(-4)})`,
          platform: platform || 'web_tv',
          model: model || 'Smart TV Client',
          appVersion: appVersion || '1.0.0',
          status: 'active',
          lastOnlineAt: now,
        })
        .returning();
      device = created;
    }

    // Ensure at least central playlists are assigned so zero manual config is needed
    const centralAssignments = await db
      .select({ id: deviceAssignments.id })
      .from(deviceAssignments)
      .where(eq(deviceAssignments.assignmentMode, 'central'))
      .limit(1);

    const directAssignments = await db
      .select({ id: deviceAssignments.id })
      .from(deviceAssignments)
      .where(eq(deviceAssignments.deviceId, device.id))
      .limit(1);

    if (centralAssignments.length === 0 && directAssignments.length === 0) {
      const enabledPlaylists = await db
        .select({ id: playlists.id })
        .from(playlists)
        .where(eq(playlists.isEnabled, true));
      if (enabledPlaylists.length > 0) {
        await db.insert(deviceAssignments).values(
          enabledPlaylists.map((pl, idx) => ({
            playlistId: pl.id,
            assignmentMode: 'central' as const,
            priority: idx + 1,
            assignedBy: 'zero-touch-bootstrap',
          }))
        );
      }
    }

    const { rawToken, tokenHash, tokenPrefix } = generateDeviceToken();
    const expiresAt = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000);

    await db.insert(deviceCredentials).values({
      deviceId: device.id,
      tokenHash,
      tokenPrefix,
      isRevoked: false,
      expiresAt,
    });

    res.json({
      status: 'active',
      deviceId: device.id,
      deviceName: device.deviceName,
      deviceToken: rawToken,
      expiresAt: expiresAt.toISOString(),
    });
  } catch (error) {
    console.error('Device bootstrap error:', error);
    res.status(500).json({ error: 'Failed to connect TV to broadcast service.' });
  }
});

// 1. TV generates or retrieves a temporary pairing code
deviceRouter.post('/pairing/request', pairingRateLimit, async (req, res) => {
  try {
    await ensureInitialDatabaseSeed();
    const { hardwareId, platform, model, appVersion, deviceName } = req.body as {
      hardwareId?: string;
      platform?: string;
      model?: string;
      appVersion?: string;
      deviceName?: string;
    };

    if (!hardwareId?.trim()) {
      return res.status(400).json({ error: 'hardwareId is required.' });
    }

    const pairingCode = generatePairingCode();
    const pairingExpiresAt = new Date(Date.now() + 15 * 60 * 1000);

    const existing = await db
      .select()
      .from(devices)
      .where(eq(devices.hardwareId, hardwareId.trim()))
      .limit(1);

    let device;
    if (existing.length > 0) {
      if (existing[0].status === 'revoked') {
        return res.status(403).json({
          error: 'This device hardware ID has been revoked by an administrator.',
        });
      }
      const [updated] = await db
        .update(devices)
        .set({
          pairingCode,
          pairingExpiresAt,
          platform: platform || existing[0].platform,
          model: model || existing[0].model,
          appVersion: appVersion || existing[0].appVersion,
          updatedAt: new Date(),
        })
        .where(eq(devices.id, existing[0].id))
        .returning();
      device = updated;
    } else {
      const [created] = await db
        .insert(devices)
        .values({
          hardwareId: hardwareId.trim(),
          deviceName: deviceName?.trim() || `${platform || 'Smart TV'} (${hardwareId.slice(-4)})`,
          platform: platform || 'web_tv',
          model: model || 'Smart TV Client',
          appVersion: appVersion || '1.0.0',
          pairingCode,
          pairingExpiresAt,
          status: 'pending',
        })
        .returning();
      device = created;
    }

    res.json({
      deviceId: device.id,
      pairingCode,
      expiresAt: pairingExpiresAt.toISOString(),
      status: device.status,
    });
  } catch (error) {
    console.error('Pairing request error:', error);
    res.status(500).json({ error: 'Failed to generate pairing code.' });
  }
});

// 2. TV polls to check if administrator approved the pairing code; receives revocable token once
deviceRouter.post('/pairing/poll', pairingRateLimit, async (req, res) => {
  try {
    const { hardwareId, pairingCode } = req.body as {
      hardwareId?: string;
      pairingCode?: string;
    };

    if (!hardwareId?.trim() || !pairingCode?.trim()) {
      return res.status(400).json({ error: 'hardwareId and pairingCode are required.' });
    }

    const [device] = await db
      .select()
      .from(devices)
      .where(
        and(
          eq(devices.hardwareId, hardwareId.trim()),
          eq(devices.pairingCode, pairingCode.trim().toUpperCase())
        )
      )
      .limit(1);

    if (!device) {
      return res.status(404).json({ error: 'Pairing session not found.' });
    }

    if (device.status === 'revoked') {
      return res.status(403).json({ status: 'revoked', error: 'Device has been revoked.' });
    }

    if (device.status !== 'active') {
      return res.json({ status: device.status });
    }

    // Issue fresh revocable device token and clear pairing code
    const { rawToken, tokenHash, tokenPrefix } = generateDeviceToken();
    const expiresAt = new Date(Date.now() + 90 * 24 * 60 * 60 * 1000); // 90 days

    await db.insert(deviceCredentials).values({
      deviceId: device.id,
      tokenHash,
      tokenPrefix,
      isRevoked: false,
      expiresAt,
    });

    await db
      .update(devices)
      .set({
        pairingCode: null,
        pairingExpiresAt: null,
        lastOnlineAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(devices.id, device.id));

    res.json({
      status: 'active',
      deviceId: device.id,
      deviceName: device.deviceName,
      deviceToken: rawToken,
      expiresAt: expiresAt.toISOString(),
    });
  } catch (error) {
    console.error('Pairing poll error:', error);
    res.status(500).json({ error: 'Failed to verify pairing status.' });
  }
});

// 3. Authenticated TV Configuration Sync
deviceRouter.get('/config', requireDeviceAuth, async (req: DeviceAuthRequest, res) => {
  try {
    const config = await buildDeviceSyncConfig(req.device!.id);
    res.json(config);
  } catch (error) {
    console.error('Device config fetch error:', error);
    res.status(500).json({ error: 'Failed to retrieve TV configuration.' });
  }
});

deviceRouter.post('/sync/ack', requireDeviceAuth, async (req: DeviceAuthRequest, res) => {
  try {
    const { configVersion, status, errorMessage } = req.body as {
      configVersion?: number;
      status?: 'acknowledged' | 'failed';
      errorMessage?: string;
    };

    const now = new Date();
    await db
      .update(devices)
      .set({
        lastSyncAt: now,
        lastSyncVersion: Number(configVersion) || 0,
        lastError: status === 'failed' ? errorMessage || 'Sync failed' : null,
        updatedAt: now,
      })
      .where(eq(devices.id, req.device!.id));

    await db
      .update(syncEvents)
      .set({
        status: status || 'acknowledged',
        errorMessage: errorMessage || null,
        acknowledgedAt: now,
      })
      .where(
        and(eq(syncEvents.deviceId, req.device!.id), eq(syncEvents.status, 'pending'))
      );

    res.json({ acknowledged: true, timestamp: now.toISOString() });
  } catch (error) {
    res.status(500).json({ error: 'Failed to acknowledge sync.' });
  }
});

// 4. Favorites & Watch History
deviceRouter.get('/favorites', requireDeviceAuth, async (req: DeviceAuthRequest, res) => {
  try {
    const rows = await db
      .select()
      .from(favorites)
      .where(eq(favorites.deviceId, req.device!.id));
    res.json(rows);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch favorites.' });
  }
});

deviceRouter.post('/favorites/toggle', requireDeviceAuth, async (req: DeviceAuthRequest, res) => {
  try {
    const { channelId } = req.body as { channelId: string };
    if (!channelId) return res.status(400).json({ error: 'channelId is required.' });

    const existing = await db
      .select()
      .from(favorites)
      .where(
        and(eq(favorites.deviceId, req.device!.id), eq(favorites.channelId, channelId))
      )
      .limit(1);

    if (existing.length > 0) {
      await db.delete(favorites).where(eq(favorites.id, existing[0].id));
      return res.json({ isFavorite: false });
    }

    await db.insert(favorites).values({
      deviceId: req.device!.id,
      channelId,
    });
    res.json({ isFavorite: true });
  } catch (error) {
    res.status(500).json({ error: 'Failed to toggle favorite.' });
  }
});

deviceRouter.get('/history', requireDeviceAuth, async (req: DeviceAuthRequest, res) => {
  try {
    const rows = await db
      .select()
      .from(watchHistory)
      .where(eq(watchHistory.deviceId, req.device!.id))
      .orderBy(desc(watchHistory.watchedAt))
      .limit(30);
    res.json(rows);
  } catch (error) {
    res.status(500).json({ error: 'Failed to load watch history.' });
  }
});

deviceRouter.post('/history', requireDeviceAuth, async (req: DeviceAuthRequest, res) => {
  try {
    const { channelId, durationSeconds } = req.body as {
      channelId: string;
      durationSeconds?: number;
    };
    if (!channelId) return res.status(400).json({ error: 'channelId is required.' });

    const [entry] = await db
      .insert(watchHistory)
      .values({
        deviceId: req.device!.id,
        channelId,
        durationSeconds: Number(durationSeconds) || 0,
      })
      .returning();
    res.status(201).json(entry);
  } catch (error) {
    res.status(500).json({ error: 'Failed to record watch history.' });
  }
});

// 5. Playback Diagnostics Reporting
deviceRouter.post('/diagnostics', requireDeviceAuth, async (req: DeviceAuthRequest, res) => {
  try {
    const { channelId, streamFormat, status, latencyMs, bitrateKbps, errorCode, errorMessage } =
      req.body;

    const [row] = await db
      .insert(playbackDiagnostics)
      .values({
        deviceId: req.device!.id,
        channelId: channelId || null,
        streamFormat: streamFormat || 'hls',
        status: status || 'ok',
        latencyMs: Number(latencyMs) || 0,
        bitrateKbps: Number(bitrateKbps) || 0,
        errorCode: errorCode || null,
        errorMessage: errorMessage || null,
      })
      .returning();

    res.status(201).json(row);
  } catch (error) {
    res.status(500).json({ error: 'Failed to record playback diagnostic.' });
  }
});

function buildProxyUri(targetUrl: string, token: string, channelId: string): string {
  const params = new URLSearchParams({
    url: targetUrl,
    token,
  });
  if (channelId) params.set('channelId', channelId);
  return `/api/device/stream?${params.toString()}`;
}

function rewriteHlsManifest(
  manifestText: string,
  baseUrl: string,
  token: string,
  channelId: string
): string {
  return manifestText
    .split(/\r?\n/)
    .map((line) => {
      const trimmed = line.trim();
      if (!trimmed) return line;
      if (trimmed.startsWith('#')) {
        return line.replace(/URI="([^"]+)"/gi, (_m, rawUri: string) => {
          try {
            const abs = new URL(rawUri, baseUrl).toString();
            return `URI="${buildProxyUri(abs, token, channelId)}"`;
          } catch {
            return `URI="${rawUri}"`;
          }
        });
      }
      try {
        const abs = new URL(trimmed, baseUrl).toString();
        return buildProxyUri(abs, token, channelId);
      } catch {
        return line;
      }
    })
    .join('\n');
}

// 6. SSRF-Validated HLS & Media Stream Proxy (solves HTTP mixed-content, CORS & custom headers in browser TV player)
deviceRouter.get('/stream', requireDeviceAuth, async (req: DeviceAuthRequest, res) => {
  const rawUrl = typeof req.query.url === 'string' ? req.query.url : '';
  const channelId = typeof req.query.channelId === 'string' ? req.query.channelId : '';
  const rawToken =
    typeof req.query.token === 'string'
      ? req.query.token
      : req.headers.authorization?.replace(/^Bearer\s+/i, '') || '';

  if (!rawUrl.trim()) {
    return res.status(400).json({ error: 'Stream url query parameter is required.' });
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 20000);
  req.on('close', () => controller.abort());

  try {
    let currentUrl = (await validateSafeExternalUrl(rawUrl)).toString();
    const forwardHeaders: Record<string, string> = {
      'User-Agent': 'VanguardIPTV-Player/1.0',
      Accept: '*/*',
    };

    if (channelId) {
      try {
        const [chRow] = await db
          .select({
            chHeaders: channels.httpHeaders,
            ovHeaders: channelOverrides.customHttpHeaders,
          })
          .from(channels)
          .leftJoin(channelOverrides, eq(channels.id, channelOverrides.channelId))
          .where(eq(channels.id, channelId))
          .limit(1);
        const hdrs =
          (chRow?.ovHeaders as Record<string, string> | null) ||
          (chRow?.chHeaders as Record<string, string> | null) ||
          {};
        for (const [k, v] of Object.entries(hdrs)) {
          const lower = k.toLowerCase();
          if (
            (lower === 'user-agent' || lower === 'referer' || lower === 'origin') &&
            typeof v === 'string' &&
            v.trim()
          ) {
            forwardHeaders[k] = v.trim();
          }
        }
      } catch {
        // Ignore non-UUID channelId lookups
      }
    }

    let upstream: globalThis.Response | null = null;
    for (let hop = 0; hop <= 4; hop++) {
      const resp = await fetch(currentUrl, {
        method: 'GET',
        redirect: 'manual',
        signal: controller.signal,
        headers: forwardHeaders,
      });

      if (resp.status >= 300 && resp.status < 400) {
        const loc = resp.headers.get('location');
        if (!loc) throw new Error('Upstream redirect without location.');
        currentUrl = (await validateSafeExternalUrl(new URL(loc, currentUrl).toString())).toString();
        continue;
      }

      upstream = resp;
      break;
    }

    if (!upstream) {
      return res.status(502).json({ error: 'Too many redirects from stream origin.' });
    }

    if (!upstream.ok) {
      return res.status(upstream.status).json({
        error: `Stream origin returned HTTP ${upstream.status}.`,
      });
    }

    const contentType = (upstream.headers.get('content-type') || '').toLowerCase();
    const looksLikeHls =
      contentType.includes('mpegurl') ||
      contentType.includes('x-mpegurl') ||
      currentUrl.toLowerCase().split('?')[0].endsWith('.m3u8');

    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Cache-Control', 'no-store');

    if (looksLikeHls) {
      const text = await upstream.text();
      if (text.length > 10 * 1024 * 1024) {
        return res.status(413).json({ error: 'Manifest too large.' });
      }
      const rewritten = text.includes('#EXTM3U')
        ? rewriteHlsManifest(text, currentUrl, rawToken, channelId)
        : text;
      res.setHeader('Content-Type', 'application/vnd.apple.mpegurl; charset=utf-8');
      return res.send(rewritten);
    }

    if (contentType) {
      res.setHeader('Content-Type', contentType);
    }

    if (upstream.body) {
      const nodeStream = Readable.fromWeb(upstream.body as Parameters<typeof Readable.fromWeb>[0]);
      nodeStream.on('error', () => {
        if (!res.headersSent) res.status(502).end();
        else res.end();
      });
      nodeStream.pipe(res);
    } else {
      const buf = Buffer.from(await upstream.arrayBuffer());
      res.send(buf);
    }
  } catch (error) {
    if (!res.headersSent) {
      res.status(502).json({
        error: error instanceof Error ? error.message : 'Stream proxy request failed.',
      });
    }
  } finally {
    clearTimeout(timer);
  }
});
