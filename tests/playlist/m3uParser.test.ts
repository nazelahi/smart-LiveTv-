import test from 'node:test';
import assert from 'node:assert/strict';
import { parseM3U, serializeM3U } from '../../packages/playlist-engine/src/index.ts';

test('parseM3U parses extended attributes, headers, and channel numbers', () => {
  const sample = `\uFEFF#EXTM3U url-tvg="https://epg.example.com/guide.xml"
#EXTINF:-1 tvg-id="bbc.world" tvg-name="BBC World" tvg-logo="https://cdn.example.com/bbc.png" tvg-chno="101" group-title="News",BBC World News HD
#EXTVLCOPT:http-user-agent=CustomTV/2.0
#EXTVLCOPT:http-referrer=https://origin.example.com
https://live.example.com/news/master.m3u8

#EXTINF:-1 tvg-id="sports.1" group-title="Sports",Arena Sports
https://live.example.com/sports/stream.ts|Referer=https://sports.example.com
`;

  const result = parseM3U(sample);
  assert.equal(result.epgUrl, 'https://epg.example.com/guide.xml');
  assert.equal(result.channels.length, 2);

  const ch1 = result.channels[0];
  assert.equal(ch1.tvgId, 'bbc.world');
  assert.equal(ch1.name, 'BBC World News HD');
  assert.equal(ch1.channelNumber, 101);
  assert.equal(ch1.groupTitle, 'News');
  assert.equal(ch1.streamFormat, 'hls');
  assert.equal(ch1.httpHeaders['User-Agent'], 'CustomTV/2.0');
  assert.equal(ch1.httpHeaders['Referer'], 'https://origin.example.com');

  const ch2 = result.channels[1];
  assert.equal(ch2.channelNumber, 102);
  assert.equal(ch2.streamFormat, 'mpegts');
  assert.equal(ch2.streamUrl, 'https://live.example.com/sports/stream.ts');
  assert.equal(ch2.httpHeaders['Referer'], 'https://sports.example.com');
});

test('parseM3U rejects unsafe non-http stream schemes', () => {
  const malicious = `#EXTM3U
#EXTINF:-1,Bad Stream
javascript:alert(1)
#EXTINF:-1,Local File
file:///etc/passwd
#EXTINF:-1,Good Stream
https://cdn.example.com/ok.m3u8
`;
  const result = parseM3U(malicious);
  assert.equal(result.channels.length, 1);
  assert.equal(result.channels[0].name, 'Good Stream');
  assert.equal(result.warnings.length, 2);
});

test('serializeM3U round-trips channels cleanly', () => {
  const m3u = serializeM3U([
    {
      tvgId: 'ch.1',
      name: 'Channel One',
      channelNumber: 1,
      groupTitle: 'General',
      streamUrl: 'https://example.com/1.m3u8',
    },
  ]);
  const parsed = parseM3U(m3u);
  assert.equal(parsed.channels.length, 1);
  assert.equal(parsed.channels[0].tvgId, 'ch.1');
  assert.equal(parsed.channels[0].channelNumber, 1);
});
