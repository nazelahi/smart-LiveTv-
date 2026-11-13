import test from 'node:test';
import assert from 'node:assert/strict';
import { parseXmltv, parseXmltvTimestamp } from '../../packages/epg-engine/src/index.ts';

test('parseXmltvTimestamp converts explicit and fallback timezones accurately', () => {
  const utc = parseXmltvTimestamp('20261113120000 +0000');
  assert.ok(utc);
  assert.equal(utc.toISOString(), '2026-11-13T12:00:00.000Z');

  const dhaka = parseXmltvTimestamp('20261113180000 +0600');
  assert.ok(dhaka);
  assert.equal(dhaka.toISOString(), '2026-11-13T12:00:00.000Z');

  const fallback = parseXmltvTimestamp('20261113120000', '-05:00');
  assert.ok(fallback);
  assert.equal(fallback.toISOString(), '2026-11-13T17:00:00.000Z');
});

test('parseXmltv parses channels and programmes safely', () => {
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<tv>
  <channel id="news.hd">
    <display-name lang="en">World News HD</display-name>
    <icon src="https://cdn.example.com/news.png" />
  </channel>
  <programme start="20261113120000 +0000" stop="20261113130000 +0000" channel="news.hd">
    <title lang="en">Global Desk</title>
    <desc>Live international briefing.</desc>
    <category>News</category>
  </programme>
</tv>`;

  const parsed = parseXmltv(xml);
  assert.equal(parsed.channels.length, 1);
  assert.equal(parsed.channels[0].xmltvChannelId, 'news.hd');
  assert.equal(parsed.programs.length, 1);
  assert.equal(parsed.programs[0].title, 'Global Desk');
  assert.equal(parsed.programs[0].category, 'News');
});
