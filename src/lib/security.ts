import crypto from 'node:crypto';
import dns from 'node:dns/promises';
import net from 'node:net';
import zlib from 'node:zlib';
import type { Request, Response, NextFunction } from 'express';

const PRIVATE_IPV4_CIDRS = [
  { prefix: [10], mask: 8 },
  { prefix: [127], mask: 8 },
  { prefix: [0], mask: 8 },
  { prefix: [169, 254], mask: 16 },
  { prefix: [192, 168], mask: 16 },
];

export function isPrivateIp(ip: string): boolean {
  if (net.isIPv4(ip)) {
    const octets = ip.split('.').map((n) => Number.parseInt(n, 10));
    if (octets.length !== 4 || octets.some((n) => Number.isNaN(n))) return true;
    // 172.16.0.0/12
    if (octets[0] === 172 && octets[1] >= 16 && octets[1] <= 31) return true;
    // 100.64.0.0/10 (CGNAT)
    if (octets[0] === 100 && octets[1] >= 64 && octets[1] <= 127) return true;
    for (const rule of PRIVATE_IPV4_CIDRS) {
      if (rule.mask === 8 && octets[0] === rule.prefix[0]) return true;
      if (rule.mask === 16 && octets[0] === rule.prefix[0] && octets[1] === rule.prefix[1]) {
        return true;
      }
    }
    return false;
  }
  if (net.isIPv6(ip)) {
    const norm = ip.toLowerCase();
    if (
      norm === '::1' ||
      norm === '::' ||
      norm.startsWith('fe80:') ||
      norm.startsWith('fc') ||
      norm.startsWith('fd') ||
      norm.startsWith('::ffff:127.') ||
      norm.startsWith('::ffff:10.') ||
      norm.startsWith('::ffff:192.168.') ||
      norm.startsWith('::ffff:169.254.')
    ) {
      return true;
    }
    return false;
  }
  return true;
}

/**
 * Validates external URLs for server-side fetching (M3U / XMLTV imports)
 * to prevent SSRF attacks against internal networks or cloud metadata endpoints.
 */
export async function validateSafeExternalUrl(rawUrl: string): Promise<URL> {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl.trim());
  } catch {
    throw new Error('Invalid URL format.');
  }

  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    throw new Error('Only HTTP and HTTPS protocols are permitted.');
  }

  const host = parsed.hostname.toLowerCase();
  if (
    host === 'localhost' ||
    host.endsWith('.localhost') ||
    host.endsWith('.internal') ||
    host.endsWith('.local') ||
    host === 'metadata.google.internal'
  ) {
    throw new Error('Access to internal or local hostnames is blocked.');
  }

  if (net.isIP(host)) {
    if (isPrivateIp(host)) {
      throw new Error('Access to private or loopback IP addresses is blocked.');
    }
    return parsed;
  }

  try {
    const records = await dns.lookup(host, { all: true });
    if (!records.length) {
      throw new Error('Unable to resolve hostname.');
    }
    for (const rec of records) {
      if (isPrivateIp(rec.address)) {
        throw new Error('Resolved IP address belongs to a restricted private network.');
      }
    }
  } catch (err) {
    if (err instanceof Error && err.message.includes('restricted')) {
      throw err;
    }
    throw new Error('DNS validation failed for the provided URL.');
  }

  return parsed;
}

async function readResponseWithLimit(
  response: globalThis.Response,
  maxBytes: number,
  urlStr: string
): Promise<string> {
  const contentLength = Number(response.headers.get('content-length') || '0');
  if (contentLength > maxBytes) {
    const mb = Math.round((maxBytes / (1024 * 1024)) * 10) / 10;
    throw new Error(`Remote payload exceeds maximum allowed size (${mb} MB limit).`);
  }

  const reader = response.body?.getReader();
  let buffer: Buffer;

  if (!reader) {
    const ab = await response.arrayBuffer();
    if (ab.byteLength > maxBytes) {
      const mb = Math.round((maxBytes / (1024 * 1024)) * 10) / 10;
      throw new Error(`Remote payload exceeds maximum allowed size (${mb} MB limit).`);
    }
    buffer = Buffer.from(ab);
  } else {
    const chunks: Buffer[] = [];
    let totalBytes = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value) {
        totalBytes += value.byteLength;
        if (totalBytes > maxBytes) {
          await reader.cancel();
          const mb = Math.round((maxBytes / (1024 * 1024)) * 10) / 10;
          throw new Error(`Remote payload exceeds maximum allowed size (${mb} MB limit).`);
        }
        chunks.push(Buffer.from(value));
      }
    }
    buffer = Buffer.concat(chunks, totalBytes);
  }

  const contentType = (response.headers.get('content-type') || '').toLowerCase();
  const isGzipMagic = buffer.length >= 2 && buffer[0] === 0x1f && buffer[1] === 0x8b;
  if (
    isGzipMagic ||
    contentType.includes('gzip') ||
    urlStr.toLowerCase().split('?')[0].endsWith('.gz')
  ) {
    try {
      const decompressed = zlib.gunzipSync(buffer, { maxOutputLength: maxBytes * 2 });
      return decompressed.toString('utf8');
    } catch {
      // Fallback to raw UTF-8 if not valid gzip
    }
  }

  return buffer.toString('utf8');
}

export async function safeFetchExternalText(
  rawUrl: string,
  maxBytes = 100 * 1024 * 1024
): Promise<string> {
  let currentUrl = (await validateSafeExternalUrl(rawUrl)).toString();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 60000);

  try {
    for (let hop = 0; hop <= 4; hop++) {
      const response = await fetch(currentUrl, {
        method: 'GET',
        redirect: 'manual',
        signal: controller.signal,
        headers: {
          'User-Agent': 'VanguardIPTV-Importer/1.0',
          Accept: 'text/plain, application/x-mpegurl, application/xml, text/xml, */*',
        },
      });

      if (response.status >= 300 && response.status < 400) {
        const location = response.headers.get('location');
        if (!location) throw new Error('Redirect without location header.');
        const nextParsed = await validateSafeExternalUrl(
          new URL(location, currentUrl).toString()
        );
        currentUrl = nextParsed.toString();
        continue;
      }

      if (!response.ok) {
        throw new Error(`Remote server returned HTTP ${response.status}.`);
      }

      return await readResponseWithLimit(response, maxBytes, currentUrl);
    }

    throw new Error('Too many redirects while fetching remote playlist.');
  } finally {
    clearTimeout(timer);
  }
}

export function generateDeviceToken(): {
  rawToken: string;
  tokenHash: string;
  tokenPrefix: string;
} {
  const rawToken = `viptv_${crypto.randomBytes(32).toString('hex')}`;
  const tokenHash = hashToken(rawToken);
  const tokenPrefix = rawToken.slice(0, 14);
  return { rawToken, tokenHash, tokenPrefix };
}

export function hashToken(rawToken: string): string {
  return crypto.createHash('sha256').update(rawToken).digest('hex');
}

export function generatePairingCode(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const bytes = crypto.randomBytes(6);
  let code = '';
  for (let i = 0; i < 6; i++) {
    code += chars[bytes[i] % chars.length];
  }
  return `${code.slice(0, 3)}-${code.slice(3)}`;
}

// Simple sliding-window rate limiter
const rateBuckets = new Map<string, number[]>();

export function createRateLimiter(windowMs: number, maxRequests: number) {
  return (req: Request, res: Response, next: NextFunction) => {
    const key = `${req.ip || 'unknown'}:${req.baseUrl}${req.path}`;
    const now = Date.now();
    const timestamps = (rateBuckets.get(key) || []).filter((t) => now - t < windowMs);
    if (timestamps.length >= maxRequests) {
      return res.status(429).json({
        error: 'Too many requests. Please wait before retrying.',
      });
    }
    timestamps.push(now);
    rateBuckets.set(key, timestamps);
    next();
  };
}
