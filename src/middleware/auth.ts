import type { Request, Response, NextFunction } from 'express';
import type { DecodedIdToken } from 'firebase-admin/auth';
import { and, count, eq, gt } from 'drizzle-orm';
import { adminAuth } from '../lib/firebase-admin.ts';
import { db } from '../db/index.ts';
import { adminUsers, deviceCredentials, devices } from '../db/schema.ts';
import { hashToken } from '../lib/security.ts';

export interface AdminUserRecord {
  id: string;
  uid: string;
  email: string;
  displayName: string | null;
  role: string;
  isActive: boolean;
}

export interface AuthRequest extends Request {
  user?: DecodedIdToken;
  adminUser?: AdminUserRecord;
}

export interface DeviceAuthRequest extends Request {
  device?: {
    id: string;
    deviceName: string;
    platform: string;
    model: string | null;
    hardwareId: string;
    status: string;
    groupId: string | null;
    lastSyncVersion: number | null;
  };
}

export async function getOrCreateAdminUser(
  uid: string,
  email: string,
  displayName?: string | null,
  avatarUrl?: string | null
): Promise<AdminUserRecord> {
  const existingByUid = await db
    .select()
    .from(adminUsers)
    .where(eq(adminUsers.uid, uid))
    .limit(1);

  if (existingByUid.length > 0) {
    const updated = await db
      .update(adminUsers)
      .set({
        email,
        displayName: displayName || existingByUid[0].displayName,
        avatarUrl: avatarUrl || existingByUid[0].avatarUrl,
        lastLoginAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(adminUsers.uid, uid))
      .returning();
    return updated[0];
  }

  // Check if invited by email before first login
  const invitedByEmail = await db
    .select()
    .from(adminUsers)
    .where(eq(adminUsers.email, email.toLowerCase()))
    .limit(1);

  if (invitedByEmail.length > 0) {
    const claimed = await db
      .update(adminUsers)
      .set({
        uid,
        displayName: displayName || invitedByEmail[0].displayName,
        avatarUrl: avatarUrl || invitedByEmail[0].avatarUrl,
        lastLoginAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(adminUsers.id, invitedByEmail[0].id))
      .returning();
    return claimed[0];
  }

  // First admin user becomes super_admin
  const [{ total }] = await db.select({ total: count() }).from(adminUsers);
  const role = Number(total) === 0 ? 'super_admin' : 'admin';

  const inserted = await db
    .insert(adminUsers)
    .values({
      uid,
      email: email.toLowerCase(),
      displayName: displayName || email.split('@')[0],
      avatarUrl: avatarUrl || null,
      role,
      isActive: true,
      lastLoginAt: new Date(),
    })
    .onConflictDoUpdate({
      target: adminUsers.uid,
      set: {
        email: email.toLowerCase(),
        lastLoginAt: new Date(),
        updatedAt: new Date(),
      },
    })
    .returning();

  return inserted[0];
}

export const requireAdminAuth = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
) => {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Unauthorized: Missing authentication token.' });
  }

  const token = authHeader.split('Bearer ')[1];
  try {
    const decodedToken = await adminAuth.verifyIdToken(token);
    req.user = decodedToken;

    const adminUser = await getOrCreateAdminUser(
      decodedToken.uid,
      decodedToken.email || `${decodedToken.uid}@unknown.local`,
      decodedToken.name || null,
      decodedToken.picture || null
    );

    if (!adminUser.isActive) {
      return res.status(403).json({ error: 'Forbidden: Administrator account is disabled.' });
    }

    req.adminUser = adminUser;
    next();
  } catch (error) {
    console.error('Error verifying Firebase ID token:', error);
    return res.status(401).json({ error: 'Unauthorized: Invalid or expired session token.' });
  }
};

export const requireRole = (allowedRoles: string[]) => {
  return (req: AuthRequest, res: Response, next: NextFunction) => {
    if (!req.adminUser) {
      return res.status(401).json({ error: 'Unauthorized.' });
    }
    if (!allowedRoles.includes(req.adminUser.role)) {
      return res.status(403).json({ error: 'Forbidden: Insufficient administrative role.' });
    }
    next();
  };
};

export const requireDeviceAuth = async (
  req: DeviceAuthRequest,
  res: Response,
  next: NextFunction
) => {
  const authHeader = req.headers.authorization;
  const queryToken = typeof req.query.token === 'string' ? req.query.token : '';
  const rawToken =
    authHeader && authHeader.startsWith('Bearer ')
      ? authHeader.split('Bearer ')[1].trim()
      : queryToken.trim();

  if (!rawToken) {
    return res.status(401).json({ error: 'Missing device credential token.' });
  }

  if (!rawToken.startsWith('viptv_')) {
    return res.status(401).json({ error: 'Malformed device credential.' });
  }

  try {
    const tokenHash = hashToken(rawToken);
    const now = new Date();

    const rows = await db
      .select({
        credential: deviceCredentials,
        device: devices,
      })
      .from(deviceCredentials)
      .innerJoin(devices, eq(deviceCredentials.deviceId, devices.id))
      .where(
        and(
          eq(deviceCredentials.tokenHash, tokenHash),
          eq(deviceCredentials.isRevoked, false),
          gt(deviceCredentials.expiresAt, now)
        )
      )
      .limit(1);

    if (rows.length === 0) {
      return res.status(401).json({ error: 'Device credential is invalid, expired, or revoked.' });
    }

    const { credential, device } = rows[0];
    if (device.status === 'revoked') {
      return res.status(403).json({ error: 'Device access has been revoked by administrator.' });
    }

    // Update last seen timestamps asynchronously without blocking response
    void db
      .update(deviceCredentials)
      .set({ lastUsedAt: now })
      .where(eq(deviceCredentials.id, credential.id));

    void db
      .update(devices)
      .set({ lastOnlineAt: now, status: 'active', updatedAt: now })
      .where(eq(devices.id, device.id));

    req.device = {
      id: device.id,
      deviceName: device.deviceName,
      platform: device.platform,
      model: device.model,
      hardwareId: device.hardwareId,
      status: device.status,
      groupId: device.groupId,
      lastSyncVersion: device.lastSyncVersion,
    };

    next();
  } catch (error) {
    console.error('Device authentication query error:', error);
    return res.status(500).json({ error: 'Device authentication verification failed.' });
  }
};
