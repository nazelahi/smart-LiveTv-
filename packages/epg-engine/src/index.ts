import { XMLParser } from 'fast-xml-parser';
import type {
  ParsedXmltvResult,
  XmltvChannel,
  XmltvProgram,
} from '../../core-models/src/index.ts';

function sanitizeXmlText(val: unknown, maxLen = 1000): string {
  if (val === null || val === undefined) return '';
  const str =
    typeof val === 'object' && val !== null && '#text' in (val as Record<string, unknown>)
      ? String((val as Record<string, unknown>)['#text'])
      : String(val);
  return str.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '').trim().slice(0, maxLen);
}

/**
 * Parses XMLTV timestamp strings such as:
 * "20261113140000 +0000" or "20261113140000 -0500" or "20261113140000"
 */
export function parseXmltvTimestamp(raw: string, fallbackOffset = '+00:00'): Date | null {
  if (!raw) return null;
  const match = raw
    .trim()
    .match(/^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})(?:\s*([+-]\d{4}|Z))?/);
  if (!match) return null;

  const [, y, m, d, hh, mm, ss, tz] = match;
  let isoTz = fallbackOffset;
  if (tz === 'Z') {
    isoTz = '+00:00';
  } else if (tz && /^[+-]\d{4}$/.test(tz)) {
    isoTz = `${tz.slice(0, 3)}:${tz.slice(3)}`;
  }

  const iso = `${y}-${m}-${d}T${hh}:${mm}:${ss}${isoTz}`;
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? null : date;
}

export function parseXmltv(xmlContent: string, defaultTimezoneOffset = '+00:00'): ParsedXmltvResult {
  const warnings: string[] = [];
  const parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: '@_',
    isArray: (name) =>
      name === 'channel' || name === 'programme' || name === 'display-name' || name === 'category',
  });

  let parsed: Record<string, any>;
  try {
    parsed = parser.parse(xmlContent);
  } catch (err) {
    return {
      channels: [],
      programs: [],
      warnings: [`Invalid XMLTV document: ${err instanceof Error ? err.message : 'parse error'}`],
    };
  }

  const tvRoot = parsed?.tv;
  if (!tvRoot) {
    return {
      channels: [],
      programs: [],
      warnings: ['Missing <tv> root element in XMLTV payload.'],
    };
  }

  const channels: XmltvChannel[] = [];
  const rawChannels = Array.isArray(tvRoot.channel) ? tvRoot.channel : [];
  for (const ch of rawChannels) {
    const id = sanitizeXmlText(ch['@_id'], 180);
    if (!id) continue;
    const displayNames = Array.isArray(ch['display-name'])
      ? ch['display-name']
      : ch['display-name']
        ? [ch['display-name']]
        : [];
    const displayName = sanitizeXmlText(displayNames[0], 180) || id;
    const iconSrc = ch.icon?.['@_src'] ? sanitizeXmlText(ch.icon['@_src'], 512) : null;
    channels.push({
      xmltvChannelId: id,
      displayName,
      iconUrl: iconSrc && (iconSrc.startsWith('http://') || iconSrc.startsWith('https://')) ? iconSrc : null,
    });
  }

  const programs: XmltvProgram[] = [];
  const rawProgrammes = Array.isArray(tvRoot.programme) ? tvRoot.programme : [];
  for (const prog of rawProgrammes) {
    const channelId = sanitizeXmlText(prog['@_channel'], 180);
    const start = parseXmltvTimestamp(String(prog['@_start'] ?? ''), defaultTimezoneOffset);
    const stop = parseXmltvTimestamp(String(prog['@_stop'] ?? ''), defaultTimezoneOffset);
    if (!channelId || !start || !stop || stop <= start) {
      warnings.push(`Skipped invalid programme entry for channel "${channelId || 'unknown'}".`);
      continue;
    }

    const titleNode = Array.isArray(prog.title) ? prog.title[0] : prog.title;
    const descNode = Array.isArray(prog.desc) ? prog.desc[0] : prog.desc;
    const catNode = Array.isArray(prog.category) ? prog.category[0] : prog.category;
    const iconNode = Array.isArray(prog.icon) ? prog.icon[0] : prog.icon;
    const rawPoster = iconNode?.['@_src'] ? sanitizeXmlText(iconNode['@_src'], 512) : null;
    const posterUrl =
      rawPoster && (rawPoster.startsWith('http://') || rawPoster.startsWith('https://'))
        ? rawPoster
        : null;
    const lang =
      (typeof titleNode === 'object' && titleNode?.['@_lang']) ||
      'en';

    const title = sanitizeXmlText(titleNode, 240);
    if (!title) continue;

    programs.push({
      xmltvChannelId: channelId,
      title,
      description: sanitizeXmlText(descNode, 1500) || null,
      category: sanitizeXmlText(catNode, 120) || null,
      posterUrl,
      startTime: start,
      endTime: stop,
      lang: sanitizeXmlText(lang, 16) || 'en',
    });
  }

  return { channels, programs, warnings };
}
