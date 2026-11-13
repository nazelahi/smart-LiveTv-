import type {
  ParsedM3UChannel,
  ParsedM3UResult,
  StreamFormat,
} from '../../core-models/src/index.ts';

const CONTROL_CHAR_REGEX = /[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g;

function sanitizeText(input: string | undefined | null, maxLen = 256): string {
  if (!input) return '';
  return input
    .replace(CONTROL_CHAR_REGEX, '')
    .replace(/[<>]/g, '')
    .trim()
    .slice(0, maxLen);
}

export function detectStreamFormat(url: string): StreamFormat {
  const lower = url.split('?')[0].toLowerCase();
  if (lower.endsWith('.m3u8') || lower.includes('.m3u8/')) return 'hls';
  if (lower.endsWith('.ts') || lower.includes('/ts/')) return 'mpegts';
  if (lower.endsWith('.mpd')) return 'dash';
  return 'auto';
}

export function isValidStreamUrl(rawUrl: string): boolean {
  try {
    const parsed = new URL(rawUrl.trim());
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

function parseAttributes(attrString: string): Record<string, string> {
  const attrs: Record<string, string> = {};
  // Matches key="value" or key='value' or key=value
  const regex = /([a-zA-Z0-9_-]+)=(?:"([^"]*)"|'([^']*)'|([^\s,]*))/g;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(attrString)) !== null) {
    const key = match[1].toLowerCase();
    const val = match[2] ?? match[3] ?? match[4] ?? '';
    attrs[key] = sanitizeText(val, 512);
  }
  return attrs;
}

function parseUrlAndHeaders(line: string): {
  streamUrl: string;
  headers: Record<string, string>;
} {
  const pipeIndex = line.indexOf('|');
  if (pipeIndex === -1) {
    return { streamUrl: line.trim(), headers: {} };
  }
  const streamUrl = line.slice(0, pipeIndex).trim();
  const headerPart = line.slice(pipeIndex + 1).trim();
  const headers: Record<string, string> = {};
  for (const segment of headerPart.split('&')) {
    const eqIdx = segment.indexOf('=');
    if (eqIdx > 0) {
      const k = sanitizeText(decodeURIComponent(segment.slice(0, eqIdx)), 64);
      const v = sanitizeText(decodeURIComponent(segment.slice(eqIdx + 1)), 512);
      if (k && v) {
        headers[k] = v;
      }
    }
  }
  return { streamUrl, headers };
}

/**
 * Parses extended M3U / M3U8 playlists safely.
 * Supports tvg-id, tvg-name, tvg-logo, group-title, tvg-chno,
 * #EXTVLCOPT HTTP headers, #EXTGRP, and pipe-separated URL headers.
 */
export function parseM3U(content: string): ParsedM3UResult {
  const cleaned = content.replace(/^\uFEFF/, '');
  const lines = cleaned.split(/\r?\n/);
  const warnings: string[] = [];
  const channels: ParsedM3UChannel[] = [];

  let epgUrl: string | null = null;
  let pendingAttrs: Record<string, string> | null = null;
  let pendingName = '';
  let pendingHeaders: Record<string, string> = {};
  let pendingGroup: string | null = null;
  let autoChannelNum = 1;

  const firstNonEmpty = lines.find((l) => l.trim().length > 0)?.trim() ?? '';
  if (!firstNonEmpty.startsWith('#EXTM3U')) {
    warnings.push('Missing #EXTM3U header; attempting best-effort parse.');
  } else {
    const headerAttrs = parseAttributes(firstNonEmpty.slice(7));
    const urlTvg = headerAttrs['url-tvg'] || headerAttrs['x-tvg-url'];
    if (urlTvg && isValidStreamUrl(urlTvg)) {
      epgUrl = urlTvg;
    }
  }

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;

    if (line.startsWith('#EXTM3U')) {
      continue;
    }

    if (line.startsWith('#EXTINF:')) {
      const commaIdx = line.indexOf(',');
      const metaPart = commaIdx >= 0 ? line.slice(8, commaIdx) : line.slice(8);
      const displayName = commaIdx >= 0 ? line.slice(commaIdx + 1) : '';
      pendingAttrs = parseAttributes(metaPart);
      pendingName = sanitizeText(displayName, 180);
      continue;
    }

    if (line.startsWith('#EXTGRP:')) {
      pendingGroup = sanitizeText(line.slice(8), 120);
      continue;
    }

    if (line.startsWith('#EXTVLCOPT:')) {
      const opt = line.slice(11).trim();
      const lower = opt.toLowerCase();
      if (lower.startsWith('http-user-agent=')) {
        pendingHeaders['User-Agent'] = sanitizeText(opt.slice(16), 512);
      } else if (lower.startsWith('http-referrer=') || lower.startsWith('http-referer=')) {
        const idx = opt.indexOf('=');
        pendingHeaders['Referer'] = sanitizeText(opt.slice(idx + 1), 512);
      } else if (lower.startsWith('http-origin=')) {
        pendingHeaders['Origin'] = sanitizeText(opt.slice(12), 512);
      }
      continue;
    }

    if (line.startsWith('#')) {
      continue;
    }

    // Stream URL line
    const { streamUrl, headers: urlHeaders } = parseUrlAndHeaders(line);
    if (!isValidStreamUrl(streamUrl)) {
      warnings.push(`Line ${i + 1}: Skipped invalid or unsupported stream URL.`);
      pendingAttrs = null;
      pendingName = '';
      pendingHeaders = {};
      pendingGroup = null;
      continue;
    }

    const attrs = pendingAttrs ?? {};
    const tvgId = attrs['tvg-id'] || attrs['channel-id'] || null;
    const tvgName = attrs['tvg-name'] || null;
    const name = pendingName || tvgName || `Channel ${autoChannelNum}`;
    const rawLogo = attrs['tvg-logo'] || attrs['logo'] || '';
    const logoUrl = rawLogo && isValidStreamUrl(rawLogo) ? rawLogo : null;
    const groupTitle = attrs['group-title'] || pendingGroup || 'Uncategorized';

    const rawNum =
      attrs['tvg-chno'] || attrs['channel-number'] || attrs['chno'] || '';
    const parsedNum = Number.parseInt(rawNum, 10);
    const channelNumber =
      Number.isFinite(parsedNum) && parsedNum > 0 ? parsedNum : autoChannelNum;

    autoChannelNum = Math.max(autoChannelNum + 1, channelNumber + 1);

    channels.push({
      tvgId,
      tvgName,
      name,
      logoUrl,
      groupTitle,
      channelNumber,
      streamUrl,
      httpHeaders: { ...pendingHeaders, ...urlHeaders },
      streamFormat: detectStreamFormat(streamUrl),
      rawAttributes: attrs,
    });

    pendingAttrs = null;
    pendingName = '';
    pendingHeaders = {};
    pendingGroup = null;
  }

  return { epgUrl, channels, warnings };
}

export function serializeM3U(
  channels: Array<{
    tvgId?: string | null;
    tvgName?: string | null;
    name: string;
    logoUrl?: string | null;
    groupTitle?: string | null;
    channelNumber?: number;
    streamUrl: string;
  }>
): string {
  const out = ['#EXTM3U'];
  for (const ch of channels) {
    const attrs: string[] = [];
    if (ch.tvgId) attrs.push(`tvg-id="${ch.tvgId}"`);
    if (ch.tvgName) attrs.push(`tvg-name="${ch.tvgName}"`);
    if (ch.logoUrl) attrs.push(`tvg-logo="${ch.logoUrl}"`);
    if (ch.channelNumber) attrs.push(`tvg-chno="${ch.channelNumber}"`);
    if (ch.groupTitle) attrs.push(`group-title="${ch.groupTitle}"`);
    out.push(`#EXTINF:-1 ${attrs.join(' ')},${ch.name}`);
    out.push(ch.streamUrl);
  }
  return out.join('\n');
}
