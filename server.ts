import http from 'node:http';
import path from 'node:path';
import express from 'express';
import dotenv from 'dotenv';
import { WebSocketServer, WebSocket } from 'ws';
import { and, eq, gt } from 'drizzle-orm';
import { adminRouter } from './src/routes/adminRoutes.ts';
import { deviceRouter } from './src/routes/deviceRoutes.ts';
import { registerSyncBroadcaster } from './src/services/syncService.ts';
import { hashToken } from './src/lib/security.ts';
import { db } from './src/db/index.ts';
import { deviceCredentials, devices } from './src/db/schema.ts';

dotenv.config();

const PORT = Number(process.env.PORT || 3000);
const isProd = process.env.NODE_ENV === 'production';

async function startServer() {
  const app = express();
  app.set('trust proxy', 1);
  app.use(express.json({ limit: '100mb' }));

  const allowedOrigins = (process.env.CORS_ALLOWED_ORIGINS || '*')
    .split(',')
    .map((o) => o.trim())
    .filter(Boolean);

  app.use('/api', (req, res, next) => {
    const reqOrigin = req.headers.origin;
    if (allowedOrigins.includes('*')) {
      res.setHeader('Access-Control-Allow-Origin', reqOrigin || '*');
    } else if (reqOrigin && allowedOrigins.includes(reqOrigin)) {
      res.setHeader('Access-Control-Allow-Origin', reqOrigin);
    }
    res.setHeader('Vary', 'Origin');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    if (req.method === 'OPTIONS') {
      return res.sendStatus(204);
    }
    next();
  });

  app.get('/api/health', (_req, res) => {
    res.json({ status: 'ok', service: 'vanguard-iptv-platform' });
  });

  app.use('/api/admin', adminRouter);
  app.use('/api/device', deviceRouter);

  const server = http.createServer(app);

  // Real-Time WebSocket synchronization hub for Smart TV devices
  const wss = new WebSocketServer({ noServer: true });
  const connectedDevices = new Map<string, Set<WebSocket>>();

  registerSyncBroadcaster((deviceIds, payload) => {
    const serialized = JSON.stringify(payload);
    for (const devId of deviceIds) {
      const sockets = connectedDevices.get(devId);
      if (!sockets) continue;
      for (const sock of sockets) {
        if (sock.readyState === WebSocket.OPEN) {
          sock.send(serialized);
        }
      }
    }
  });

  server.on('upgrade', async (request, socket, head) => {
    const url = new URL(request.url || '/', `http://${request.headers.host || 'localhost'}`);
    if (url.pathname !== '/ws/device') {
      socket.destroy();
      return;
    }

    const token = url.searchParams.get('token')?.trim();
    if (!token || !token.startsWith('viptv_')) {
      socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
      socket.destroy();
      return;
    }

    try {
      const tokenHash = hashToken(token);
      const rows = await db
        .select({ device: devices })
        .from(deviceCredentials)
        .innerJoin(devices, eq(deviceCredentials.deviceId, devices.id))
        .where(
          and(
            eq(deviceCredentials.tokenHash, tokenHash),
            eq(deviceCredentials.isRevoked, false),
            gt(deviceCredentials.expiresAt, new Date())
          )
        )
        .limit(1);

      if (rows.length === 0 || rows[0].device.status === 'revoked') {
        socket.write('HTTP/1.1 403 Forbidden\r\n\r\n');
        socket.destroy();
        return;
      }

      const deviceId = rows[0].device.id;
      wss.handleUpgrade(request, socket, head, (ws) => {
        wss.emit('connection', ws, request, deviceId);
      });
    } catch (err) {
      console.error('WebSocket upgrade auth error:', err);
      socket.destroy();
    }
  });

  wss.on('connection', (ws: WebSocket, _req: http.IncomingMessage, deviceId: string) => {
    if (!connectedDevices.has(deviceId)) {
      connectedDevices.set(deviceId, new Set());
    }
    connectedDevices.get(deviceId)!.add(ws);

    void db
      .update(devices)
      .set({ lastOnlineAt: new Date(), status: 'active', updatedAt: new Date() })
      .where(eq(devices.id, deviceId));

    ws.send(
      JSON.stringify({
        type: 'sync:connected',
        deviceId,
        timestamp: new Date().toISOString(),
      })
    );

    ws.on('message', (raw) => {
      try {
        const msg = JSON.parse(raw.toString()) as { type?: string };
        if (msg.type === 'ping') {
          ws.send(JSON.stringify({ type: 'pong', timestamp: new Date().toISOString() }));
        }
      } catch {
        // Ignore malformed client frames
      }
    });

    ws.on('close', () => {
      const set = connectedDevices.get(deviceId);
      if (set) {
        set.delete(ws);
        if (set.size === 0) connectedDevices.delete(deviceId);
      }
    });
  });

  if (!isProd) {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.resolve(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  server.listen(PORT, '0.0.0.0', () => {
    console.log(`Vanguard IPTV Studio server listening on http://0.0.0.0:${PORT}`);
  });
}

startServer();
