import { count } from 'drizzle-orm';
import { db } from './index.ts';
import {
  appSettings,
  auditLogs,
  categories,
  channels,
  deviceAssignments,
  deviceGroups,
  epgChannels,
  epgSources,
  playlists,
  programs,
} from './schema.ts';
import { publishPlaylistVersion } from '../services/channelService.ts';

let seedChecked = false;

/**
 * Ensures initial broadcast configuration exists on first run using real,
 * public CORS-enabled HLS test streams and dynamic EPG time windows.
 */
export async function ensureInitialDatabaseSeed() {
  if (seedChecked) return;

  try {
    const [{ total }] = await db.select({ total: count() }).from(playlists);
    if (Number(total) > 0) {
      seedChecked = true;
      return;
    }

    // 1. Seed Categories
    const insertedCats = await db
      .insert(categories)
      .values([
        { name: 'News & World', slug: 'news-world', sortOrder: 1, iconName: 'globe' },
        { name: 'Sports', slug: 'sports', sortOrder: 2, iconName: 'trophy' },
        { name: 'Cinema & Drama', slug: 'cinema-drama', sortOrder: 3, iconName: 'film' },
        { name: 'Documentary', slug: 'documentary', sortOrder: 4, iconName: 'compass' },
        { name: 'Music & Arts', slug: 'music-arts', sortOrder: 5, iconName: 'music' },
      ])
      .onConflictDoNothing()
      .returning();

    const catBySlug = new Map(insertedCats.map((c) => [c.slug, c.id]));

    // 2. Seed EPG Source
    const [epgSource] = await db
      .insert(epgSources)
      .values({
        name: 'Global Broadcast XMLTV Feed',
        sourceType: 'file',
        timezoneOffset: '+00:00',
        isEnabled: true,
        lastFetchedAt: new Date(),
        lastStatus: 'success',
        channelCount: 5,
        programCount: 15,
      })
      .returning();

    // 3. Seed Primary Central Playlist
    const [centralPlaylist] = await db
      .insert(playlists)
      .values({
        name: 'Central Broadcast Lineup',
        description: 'Primary curated HLS channel lineup distributed centrally to fleet displays.',
        sourceType: 'manual',
        autoRefreshIntervalMins: 360,
        isEnabled: true,
        epgSourceId: epgSource.id,
        createdBy: 'system-bootstrap',
        lastFetchedAt: new Date(),
        lastFetchStatus: 'success',
      })
      .returning();

    // 4. Seed Channels using real public open-source HLS test streams
    const seededChannels = await db
      .insert(channels)
      .values([
        {
          playlistId: centralPlaylist.id,
          tvgId: 'vanguard.news.1',
          tvgName: 'Global Meridian News HD',
          name: 'Global Meridian News HD',
          logoUrl: '/src/assets/images/tv_channel_news_1794571501401.jpg',
          groupTitle: 'News & World',
          categoryId: catBySlug.get('news-world') ?? null,
          channelNumber: 101,
          streamUrl: 'https://cph-p2p-msl.akamaized.net/hls/live/2000341/test/master.m3u8',
          streamFormat: 'hls',
          sortOrder: 1,
        },
        {
          playlistId: centralPlaylist.id,
          tvgId: 'vanguard.sports.1',
          tvgName: 'Apex Arena Sports 4K',
          name: 'Apex Arena Sports 4K',
          logoUrl: '/src/assets/images/tv_channel_sports_1794571501577.jpg',
          groupTitle: 'Sports',
          categoryId: catBySlug.get('sports') ?? null,
          channelNumber: 201,
          streamUrl: 'https://moctobpltc-i.akamaihd.net/hls/live/571329/eight/playlist.m3u8',
          streamFormat: 'hls',
          sortOrder: 2,
        },
        {
          playlistId: centralPlaylist.id,
          tvgId: 'vanguard.cinema.1',
          tvgName: 'Lumiere Cinema Premier',
          name: 'Lumiere Cinema Premier',
          logoUrl: '/src/assets/images/tv_channel_cinema_1794571501792.jpg',
          groupTitle: 'Cinema & Drama',
          categoryId: catBySlug.get('cinema-drama') ?? null,
          channelNumber: 301,
          streamUrl: 'https://test-streams.mux.dev/x36xhzz/x36xhzz.m3u8',
          streamFormat: 'hls',
          sortOrder: 3,
        },
        {
          playlistId: centralPlaylist.id,
          tvgId: 'vanguard.doc.1',
          tvgName: 'Horizon Documentary Network',
          name: 'Horizon Documentary Network',
          logoUrl: '/src/assets/images/tv_channel_cinema_1794571501792.jpg',
          groupTitle: 'Documentary',
          categoryId: catBySlug.get('documentary') ?? null,
          channelNumber: 401,
          streamUrl: 'https://bitdash-a.akamaihd.net/content/sintel/hls/playlist.m3u8',
          streamFormat: 'hls',
          sortOrder: 4,
        },
        {
          playlistId: centralPlaylist.id,
          tvgId: 'vanguard.arts.1',
          tvgName: 'Studio Calibration Showcase',
          name: 'Studio Calibration Showcase',
          logoUrl: '/src/assets/images/tv_channel_news_1794571501401.jpg',
          groupTitle: 'Music & Arts',
          categoryId: catBySlug.get('music-arts') ?? null,
          channelNumber: 501,
          streamUrl:
            'https://devstreaming-cdn.apple.com/videos/streaming/examples/img_bipbop_adv_example_fmp4/master.m3u8',
          streamFormat: 'hls',
          sortOrder: 5,
        },
      ])
      .returning();

    // 5. Map EPG Channels & Programs around current UTC window
    const channelByTvg = new Map(seededChannels.map((c) => [c.tvgId, c.id]));
    await db.insert(epgChannels).values([
      {
        epgSourceId: epgSource.id,
        xmltvChannelId: 'vanguard.news.1',
        displayName: 'Global Meridian News HD',
        mappedChannelId: channelByTvg.get('vanguard.news.1') ?? null,
      },
      {
        epgSourceId: epgSource.id,
        xmltvChannelId: 'vanguard.sports.1',
        displayName: 'Apex Arena Sports 4K',
        mappedChannelId: channelByTvg.get('vanguard.sports.1') ?? null,
      },
      {
        epgSourceId: epgSource.id,
        xmltvChannelId: 'vanguard.cinema.1',
        displayName: 'Lumiere Cinema Premier',
        mappedChannelId: channelByTvg.get('vanguard.cinema.1') ?? null,
      },
      {
        epgSourceId: epgSource.id,
        xmltvChannelId: 'vanguard.doc.1',
        displayName: 'Horizon Documentary Network',
        mappedChannelId: channelByTvg.get('vanguard.doc.1') ?? null,
      },
      {
        epgSourceId: epgSource.id,
        xmltvChannelId: 'vanguard.arts.1',
        displayName: 'Studio Calibration Showcase',
        mappedChannelId: channelByTvg.get('vanguard.arts.1') ?? null,
      },
    ]);

    const hourStart = new Date();
    hourStart.setMinutes(0, 0, 0);
    const hourMs = 60 * 60 * 1000;

    const epgSchedule = [
      {
        xmltvChannelId: 'vanguard.news.1',
        slots: [
          { title: 'World Desk Live', cat: 'News', desc: 'International headlines, markets, and live correspondent briefings.' },
          { title: 'Asia-Pacific Financial Hour', cat: 'Business', desc: 'Regional equities, shipping corridors, and policy updates.' },
          { title: 'Evening Global Briefing', cat: 'News', desc: 'In-depth geopolitical analysis and weather forecast.' },
        ],
      },
      {
        xmltvChannelId: 'vanguard.sports.1',
        slots: [
          { title: 'Premier Matchday Live', cat: 'Sports', desc: 'Live stadium coverage with multi-angle tactical commentary.' },
          { title: 'Post-Match Tactical Breakdown', cat: 'Sports', desc: 'Replay analysis and player performance metrics.' },
          { title: 'Champions Highlights Reel', cat: 'Sports', desc: 'Top goals and defining moments across international leagues.' },
        ],
      },
      {
        xmltvChannelId: 'vanguard.cinema.1',
        slots: [
          { title: 'Big Buck Bunny (4K Master)', cat: 'Animation', desc: 'Open-source Blender Institute animated feature presentation.' },
          { title: 'Director Spotlight: Short Films', cat: 'Cinema', desc: 'Curated independent festival selections in adaptive HD.' },
          { title: 'Midnight Noir Classic', cat: 'Drama', desc: 'Restored monochrome cinema showcase.' },
        ],
      },
      {
        xmltvChannelId: 'vanguard.doc.1',
        slots: [
          { title: 'Sintel: Digital Craftsmanship', cat: 'Documentary', desc: 'Behind the scenes of modern open-source cinema pipelines.' },
          { title: 'Deep Ocean Telemetry', cat: 'Science', desc: 'Submersible expeditions mapping abyssal hydrothermal vents.' },
          { title: 'Architectural Acoustics', cat: 'Culture', desc: 'Engineering concert halls around the world.' },
        ],
      },
      {
        xmltvChannelId: 'vanguard.arts.1',
        slots: [
          { title: 'Reference Audio & Video Suite', cat: 'Broadcast', desc: 'SMPTE reference multi-bitrate HLS calibration stream.' },
          { title: 'Symphonic Hall Live', cat: 'Music', desc: 'Full orchestral performance captured in spatial stereo.' },
          { title: 'Late Night Jazz Sessions', cat: 'Music', desc: 'Intimate studio quartet recordings.' },
        ],
      },
    ];

    const programRows = epgSchedule.flatMap((ch) =>
      ch.slots.map((slot, idx) => ({
        epgSourceId: epgSource.id,
        xmltvChannelId: ch.xmltvChannelId,
        title: slot.title,
        description: slot.desc,
        category: slot.cat,
        startTime: new Date(hourStart.getTime() + (idx - 1) * hourMs),
        endTime: new Date(hourStart.getTime() + idx * hourMs),
        lang: 'en',
      }))
    );
    await db.insert(programs).values(programRows);

    // 6. Seed Device Groups & Central Assignment
    await db
      .insert(deviceGroups)
      .values([
        { name: 'Living Room Displays', description: 'Primary household Smart TVs' },
        { name: 'Hospitality Suites', description: 'Guest room televisions' },
        { name: 'Sports Lounges', description: 'Dedicated sports viewing screens' },
      ])
      .onConflictDoNothing();

    await db.insert(deviceAssignments).values({
      playlistId: centralPlaylist.id,
      assignmentMode: 'central',
      priority: 1,
      assignedBy: 'system-bootstrap',
    });

    // 7. Publish v1 snapshot
    await publishPlaylistVersion(
      centralPlaylist.id,
      'system-bootstrap',
      'Initial central broadcast lineup'
    );

    // 8. Seed Default Settings
    await db
      .insert(appSettings)
      .values([
        {
          key: 'sync_polling_interval_seconds',
          value: 60,
          description: 'Fallback HTTP polling interval for TV clients when WebSocket is offline',
          updatedBy: 'system-bootstrap',
        },
        {
          key: 'pairing_code_ttl_minutes',
          value: 15,
          description: 'Expiration window for temporary TV pairing codes',
          updatedBy: 'system-bootstrap',
        },
        {
          key: 'default_stream_retry_limit',
          value: 3,
          description: 'Maximum automatic stream reconnection attempts before error state',
          updatedBy: 'system-bootstrap',
        },
        {
          key: 'require_manual_pairing',
          value: false,
          description:
            'When false, TVs open directly with zero configuration; when true, new TVs wait for admin pairing code approval',
          updatedBy: 'system-bootstrap',
        },
      ])
      .onConflictDoNothing();

    await db.insert(auditLogs).values({
      actorUid: 'system',
      actorEmail: 'system@vanguard-iptv.local',
      action: 'system.bootstrap',
      resourceType: 'playlist',
      resourceId: centralPlaylist.id,
      details: { channelCount: seededChannels.length, version: 1 },
    });

    seedChecked = true;
  } catch (error) {
    console.error('Error seeding initial database state:', error);
  }
}
