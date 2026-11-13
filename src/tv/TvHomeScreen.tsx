import React, { useMemo, useState } from 'react';
import { Bookmark, Calendar, ChevronRight, Clock, Play, RefreshCw, Tv } from 'lucide-react';
import type { DeviceSyncConfig, EffectiveChannel } from '../../packages/core-models/src/index';
import { Button } from '../components/ui/Primitives';

type EpgProgramItem = DeviceSyncConfig['epgPrograms'][number];

const POSTER_BY_GENRE = {
  cinema: '/src/assets/images/poster_cinema_premiere_1794575063171.jpg',
  sports: '/src/assets/images/poster_live_sports_1794575064077.jpg',
  news: '/src/assets/images/poster_world_news_1794575064802.jpg',
  doc: '/src/assets/images/poster_nature_doc_1794575064102.jpg',
  music: '/src/assets/images/poster_music_live_1794575065527.jpg',
} as const;

const POSTER_ROTATION = [
  POSTER_BY_GENRE.cinema,
  POSTER_BY_GENRE.sports,
  POSTER_BY_GENRE.news,
  POSTER_BY_GENRE.doc,
  POSTER_BY_GENRE.music,
];

const HERO_BACKDROP = '/src/assets/images/tv_hero_cinema_1794571500873.jpg';
const DEFAULT_CHANNEL_LOGO = '/src/assets/images/tv_channel_cinema_1794571501792.jpg';

function resolveFallbackPoster(
  program: Pick<EpgProgramItem, 'title' | 'category'> | null | undefined,
  channel: EffectiveChannel
): string {
  const haystack = `${program?.category ?? ''} ${program?.title ?? ''} ${channel.categoryName ?? ''} ${channel.groupTitle ?? ''} ${channel.name}`.toLowerCase();

  if (/(sport|football|soccer|cricket|ipl|espn|tennis|nba|ufc|f1|star sports|t sports|sony ten)/.test(haystack)) {
    return POSTER_BY_GENRE.sports;
  }
  if (/(news|cnn|bbc|al jazeera|somoy|ekattor|jamuna|channel 24|dbc|bloomberg|cnbc|sky news)/.test(haystack)) {
    return POSTER_BY_GENRE.news;
  }
  if (/(doc|nature|discovery|nat geo|national geographic|animal|science|history|tlc|travel)/.test(haystack)) {
    return POSTER_BY_GENRE.doc;
  }
  if (/(music|mtv|concert|gaan|entertainment|drama|comedy|series|bangla|zee|star plus|sony|colors)/.test(haystack)) {
    return POSTER_BY_GENRE.music;
  }
  if (/(movie|cinema|film|hbo|action|thriller|hollywood|bollywood|cineplex)/.test(haystack)) {
    return POSTER_BY_GENRE.cinema;
  }

  return POSTER_ROTATION[Math.abs(channel.channelNumber || 0) % POSTER_ROTATION.length];
}

function resolveProgramPoster(
  program: Pick<EpgProgramItem, 'title' | 'category' | 'posterUrl'> | null | undefined,
  channel: EffectiveChannel
): { primary: string; fallback: string } {
  const fallback = resolveFallbackPoster(program, channel);
  const primary = program?.posterUrl || fallback;
  return { primary, fallback };
}

function formatTimeRange(startIso: string, endIso: string): string {
  const fmt = (iso: string) =>
    new Date(iso).toLocaleTimeString([], {
      hour: '2-digit',
      minute: '2-digit',
    });
  return `${fmt(startIso)} – ${fmt(endIso)}`;
}

function computeProgressPct(startIso: string, endIso: string): number {
  const now = Date.now();
  const start = new Date(startIso).getTime();
  const end = new Date(endIso).getTime();
  if (end <= start) return 0;
  return Math.min(100, Math.max(0, Math.round(((now - start) / (end - start)) * 100)));
}

const PosterArtwork: React.FC<{
  src: string;
  fallbackSrc: string;
  alt: string;
  className?: string;
}> = ({ src, fallbackSrc, alt, className = '' }) => {
  const [failedPrimary, setFailedPrimary] = useState(false);
  const [failedFallback, setFailedFallback] = useState(false);

  if (failedPrimary && failedFallback) {
    return (
      <div
        className={`bg-gradient-to-br from-[#1b090d] via-[#0c0c12] to-[#050507] flex items-center justify-center ${className}`}
        aria-label={alt}
      >
        <Tv className="w-8 h-8 text-red-500/60" />
      </div>
    );
  }

  return (
    <img
      src={failedPrimary ? fallbackSrc : src}
      alt={alt}
      loading="lazy"
      referrerPolicy="no-referrer"
      onError={() => {
        if (!failedPrimary && src !== fallbackSrc) {
          setFailedPrimary(true);
        } else {
          setFailedFallback(true);
        }
      }}
      className={className}
    />
  );
};

interface TvHomeScreenProps {
  config: DeviceSyncConfig | null;
  channels: EffectiveChannel[];
  activeChannel: EffectiveChannel | null;
  favorites: string[];
  historyIds: string[];
  epgByChannelTvgId: Map<string, EpgProgramItem[]>;
  getProgramPair: (tvgId: string | null) => {
    current: EpgProgramItem | null;
    next: EpgProgramItem | null;
  };
  onWatchChannel: (channel: EffectiveChannel, openFullscreen?: boolean) => void;
  onToggleFavorite: (channelId: string) => void;
  onOpenFullGuide: () => void;
  onOpenLiveTv: () => void;
  onRefreshConfig?: () => void;
}

export const TvHomeScreen: React.FC<TvHomeScreenProps> = ({
  config,
  channels,
  activeChannel,
  favorites,
  historyIds,
  epgByChannelTvgId,
  getProgramPair,
  onWatchChannel,
  onToggleFavorite,
  onOpenFullGuide,
  onOpenLiveTv,
  onRefreshConfig,
}) => {
  const [selectedGenre, setSelectedGenre] = useState<string>('ALL');
  const [spotlightChannelId, setSpotlightChannelId] = useState<string | null>(null);
  const [guideFilterMode, setGuideFilterMode] = useState<'all' | 'with_epg'>('all');
  const [guideVisibleCount, setGuideVisibleCount] = useState(12);

  const hasAnyEpg = (config?.epgPrograms?.length ?? 0) > 0;

  // Prioritize channels with live EPG programs first so poster guide showcases rich schedule cards
  const prioritizedChannels = useMemo(() => {
    const filtered = channels.filter((ch) => {
      if (selectedGenre === 'ALL') return true;
      return (ch.categoryName || ch.groupTitle || 'Uncategorized') === selectedGenre;
    });

    return [...filtered].sort((a, b) => {
      const aHasEpg = Boolean(a.tvgId && epgByChannelTvgId.has(a.tvgId));
      const bHasEpg = Boolean(b.tvgId && epgByChannelTvgId.has(b.tvgId));
      if (aHasEpg !== bHasEpg) return aHasEpg ? -1 : 1;
      return a.channelNumber - b.channelNumber;
    });
  }, [channels, selectedGenre, epgByChannelTvgId]);

  const spotlightChannel = useMemo(() => {
    if (spotlightChannelId) {
      const found = channels.find((c) => c.id === spotlightChannelId);
      if (found) return found;
    }
    return activeChannel || prioritizedChannels[0] || channels[0] || null;
  }, [spotlightChannelId, channels, activeChannel, prioritizedChannels]);

  const spotlightPair = getProgramPair(spotlightChannel?.tvgId ?? null);
  const spotlightPoster = spotlightChannel
    ? resolveProgramPoster(spotlightPair.current || spotlightPair.next, spotlightChannel)
    : { primary: POSTER_BY_GENRE.cinema, fallback: POSTER_BY_GENRE.cinema };

  const spotlightSchedule = useMemo(() => {
    if (!spotlightChannel?.tvgId) return [];
    const list = epgByChannelTvgId.get(spotlightChannel.tvgId) ?? [];
    const now = Date.now();
    const upcoming = list.filter((p) => new Date(p.endTime).getTime() > now);
    return (upcoming.length > 0 ? upcoming : list).slice(0, 3);
  }, [spotlightChannel, epgByChannelTvgId]);

  const guideChannels = useMemo(() => {
    const base =
      guideFilterMode === 'with_epg'
        ? prioritizedChannels.filter((ch) => Boolean(ch.tvgId && epgByChannelTvgId.has(ch.tvgId)))
        : prioritizedChannels;
    return base.slice(0, guideVisibleCount);
  }, [prioritizedChannels, guideFilterMode, epgByChannelTvgId, guideVisibleCount]);

  const totalGuideMatching = useMemo(() => {
    if (guideFilterMode === 'with_epg') {
      return prioritizedChannels.filter((ch) => Boolean(ch.tvgId && epgByChannelTvgId.has(ch.tvgId))).length;
    }
    return prioritizedChannels.length;
  }, [prioritizedChannels, guideFilterMode, epgByChannelTvgId]);

  const recentChannels = useMemo(() => {
    return historyIds
      .map((id) => channels.find((c) => c.id === id))
      .filter((c): c is EffectiveChannel => Boolean(c))
      .slice(0, 6);
  }, [historyIds, channels]);

  const topCategories = useMemo(() => {
    return (config?.categories ?? []).slice(0, 8);
  }, [config]);

  if (channels.length === 0) {
    return (
      <div className="p-10 rounded-2xl bg-[#0a0a0f] border border-red-950/60 text-center space-y-4">
        <Tv className="w-10 h-10 text-red-500 mx-auto" />
        <h1 className="text-xl font-bold text-white">Preparing Your Broadcast Lineup</h1>
        <p className="text-sm text-neutral-400 max-w-md mx-auto">
          Channels and TV Guide programs are synchronizing from your central lineup.
        </p>
        {onRefreshConfig && (
          <Button size="sm" onClick={onRefreshConfig}>
            <RefreshCw className="w-3.5 h-3.5" />
            Sync Lineup
          </Button>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-8 pb-6">
      {/* 1. Featured Hero Spotlight with 3:4 Program Poster */}
      {spotlightChannel && (
        <section className="relative rounded-2xl overflow-hidden border border-red-950/70 bg-[#09090d]">
          <img
            src={HERO_BACKDROP}
            alt="Featured Broadcast Backdrop"
            className="absolute inset-0 w-full h-full object-cover opacity-40"
          />
          <div className="absolute inset-0 bg-gradient-to-r from-[#050507] via-[#050507]/90 to-[#050507]/60" />
          <div className="absolute inset-0 bg-gradient-to-t from-[#050507] via-transparent to-[#050507]/40" />

          <div className="relative z-10 p-6 sm:p-8 lg:p-10 flex flex-col lg:flex-row lg:items-center justify-between gap-8">
            {/* Left Typographic Broadcast Hierarchy */}
            <div className="flex-1 min-w-0 max-w-2xl space-y-4">
              <div className="flex flex-wrap items-center gap-2 text-xs text-neutral-300">
                <span className="font-semibold text-red-500">Featured Broadcast</span>
                <span aria-hidden="true">·</span>
                <span className="font-mono tabular-nums text-neutral-200">
                  CH {spotlightChannel.channelNumber}
                </span>
                <span aria-hidden="true">·</span>
                <span>{spotlightChannel.categoryName || spotlightChannel.groupTitle || 'Live TV'}</span>
                {spotlightPair.current && (
                  <>
                    <span aria-hidden="true">·</span>
                    <span className="font-mono tabular-nums text-neutral-300">
                      {formatTimeRange(spotlightPair.current.startTime, spotlightPair.current.endTime)}
                    </span>
                  </>
                )}
              </div>

              <h1 className="font-display text-3xl sm:text-4xl lg:text-[2.6rem] font-bold tracking-tight text-white leading-[1.1] text-balance">
                {spotlightPair.current?.title || spotlightChannel.name}
              </h1>

              <p className="text-sm sm:text-[15px] text-neutral-300 leading-relaxed line-clamp-2 max-w-xl">
                {spotlightPair.current?.description ||
                  `Live stream on ${spotlightChannel.name}${
                    spotlightChannel.categoryName ? ` · ${spotlightChannel.categoryName}` : ''
                  }. Select Watch Live to begin playback immediately.`}
              </p>

              {/* Live Program Progress + Up Next */}
              {spotlightPair.current && (
                <div className="max-w-md space-y-1.5 pt-1">
                  <div className="flex items-center justify-between text-xs text-neutral-400 tabular-nums">
                    <span className="text-red-400 font-medium">Airing Now</span>
                    <span>
                      {computeProgressPct(spotlightPair.current.startTime, spotlightPair.current.endTime)}% elapsed
                    </span>
                  </div>
                  <progress
                    value={computeProgressPct(spotlightPair.current.startTime, spotlightPair.current.endTime)}
                    max={100}
                    className="block w-full h-1.5 rounded-full overflow-hidden [&::-webkit-progress-bar]:bg-neutral-800 [&::-webkit-progress-value]:bg-red-600 [&::-moz-progress-bar]:bg-red-600"
                  />
                  {spotlightPair.next && (
                    <div className="text-xs text-neutral-400 pt-0.5 truncate">
                      Up Next: <span className="text-neutral-200 font-medium">{spotlightPair.next.title}</span>{' '}
                      <span className="font-mono tabular-nums text-neutral-500">
                        ({new Date(spotlightPair.next.startTime).toLocaleTimeString([], {
                          hour: '2-digit',
                          minute: '2-digit',
                        })})
                      </span>
                    </div>
                  )}
                </div>
              )}

              {/* Primary CTA & Station Controls */}
              <div className="flex flex-wrap items-center gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => onWatchChannel(spotlightChannel, true)}
                  className="tv-focusable inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-red-600 hover:bg-red-500 text-white text-sm font-semibold whitespace-nowrap shrink-0 cursor-pointer transition-colors"
                >
                  <Play className="w-4 h-4 fill-current" />
                  Watch Live
                </button>

                <button
                  type="button"
                  onClick={onOpenLiveTv}
                  className="tv-focusable inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-[#13131b] hover:bg-[#1a1a25] border border-neutral-800 text-neutral-200 text-sm font-medium whitespace-nowrap shrink-0 cursor-pointer transition-colors"
                >
                  <Tv className="w-4 h-4 text-red-500" />
                  Live Player
                </button>

                <button
                  type="button"
                  onClick={onOpenFullGuide}
                  className="tv-focusable inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-[#13131b] hover:bg-[#1a1a25] border border-neutral-800 text-neutral-200 text-sm font-medium whitespace-nowrap shrink-0 cursor-pointer transition-colors"
                >
                  <Calendar className="w-4 h-4 text-red-500" />
                  Full Guide
                </button>

                <button
                  type="button"
                  onClick={() => onToggleFavorite(spotlightChannel.id)}
                  aria-label="Toggle Favorite"
                  className={`tv-focusable inline-flex items-center gap-1.5 px-3.5 py-2.5 rounded-xl border text-sm font-medium whitespace-nowrap shrink-0 cursor-pointer transition-colors ${
                    favorites.includes(spotlightChannel.id)
                      ? 'bg-red-950/40 border-red-600/70 text-red-400'
                      : 'bg-[#13131b] border-neutral-800 text-neutral-300 hover:border-red-800/70'
                  }`}
                >
                  <Bookmark
                    className={`w-4 h-4 ${
                      favorites.includes(spotlightChannel.id) ? 'fill-red-500 text-red-500' : ''
                    }`}
                  />
                  {favorites.includes(spotlightChannel.id) ? 'Saved' : 'Save'}
                </button>
              </div>
            </div>

            {/* Right Featured 3:4 Program Poster + Station Mini-Schedule */}
            <div className="flex items-stretch gap-4 shrink-0">
              <button
                type="button"
                onClick={() => onWatchChannel(spotlightChannel, false)}
                className="tv-focusable group relative w-40 sm:w-44 lg:w-48 aspect-[3/4] rounded-xl overflow-hidden border border-red-900/50 bg-[#0d0d14] shadow-2xl shrink-0 cursor-pointer text-left"
              >
                <PosterArtwork
                  src={spotlightPoster.primary}
                  fallbackSrc={spotlightPoster.fallback}
                  alt={spotlightPair.current?.title || spotlightChannel.name}
                  className="w-full h-full object-cover transition-transform duration-300 group-hover:scale-105"
                />
                <div className="absolute inset-0 bg-gradient-to-t from-[#050507] via-[#050507]/30 to-transparent" />
                <div className="absolute top-2.5 left-2.5 right-2.5 flex items-center justify-between gap-2">
                  <img
                    src={spotlightChannel.logoUrl || DEFAULT_CHANNEL_LOGO}
                    alt={spotlightChannel.name}
                    referrerPolicy="no-referrer"
                    className="w-8 h-8 rounded-lg object-cover bg-black/85 border border-white/15"
                  />
                  <span className="text-[11px] font-mono font-semibold text-white bg-black/75 px-2 py-0.5 rounded tabular-nums">
                    CH {spotlightChannel.channelNumber}
                  </span>
                </div>
                <div className="absolute bottom-3 left-3 right-3">
                  <div className="text-[11px] font-medium text-red-400 truncate">
                    {spotlightChannel.name}
                  </div>
                  <div className="text-xs font-semibold text-white line-clamp-2 mt-0.5">
                    {spotlightPair.current?.title || 'Live Broadcast'}
                  </div>
                </div>
              </button>

              {/* Compact Next-On Timeline Beside Spotlight Poster (Desktop XL) */}
              {spotlightSchedule.length > 0 && (
                <div className="hidden xl:flex flex-col justify-between w-60 bg-[#0b0b11]/90 border border-neutral-800/80 rounded-xl p-3.5">
                  <div className="flex items-center justify-between text-xs text-neutral-400 pb-2 border-b border-neutral-800/80">
                    <span className="font-semibold text-white">Channel Schedule</span>
                    <Clock className="w-3.5 h-3.5 text-red-500" />
                  </div>
                  <div className="flex-1 flex flex-col justify-center gap-2.5 py-2">
                    {spotlightSchedule.map((prog, idx) => (
                      <div key={`${prog.title}-${idx}`} className="space-y-0.5">
                        <div className="text-[11px] font-mono text-red-400 tabular-nums">
                          {formatTimeRange(prog.startTime, prog.endTime)}
                        </div>
                        <div className="text-xs font-semibold text-neutral-100 truncate">
                          {prog.title}
                        </div>
                      </div>
                    ))}
                  </div>
                  <button
                    type="button"
                    onClick={onOpenFullGuide}
                    className="text-xs font-medium text-red-400 hover:text-red-300 flex items-center justify-between pt-2 border-t border-neutral-800/80 cursor-pointer"
                  >
                    <span>See Full EPG</span>
                    <ChevronRight className="w-3.5 h-3.5" />
                  </button>
                </div>
              )}
            </div>
          </div>
        </section>
      )}

      {/* 2. On Now & Tonight — Program Poster Showcase */}
      <section className="space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <h2 className="font-display text-xl font-bold tracking-tight text-white">
              On Now &amp; Program Posters
            </h2>
            <p className="text-xs text-neutral-400 mt-0.5">
              Select any program poster to tune in directly or preview in the spotlight above
            </p>
          </div>

          {/* Interactive Category Filter Segmented Controls */}
          <div className="flex items-center gap-1.5 overflow-x-auto pb-1">
            <button
              type="button"
              onClick={() => {
                setSelectedGenre('ALL');
                setGuideVisibleCount(12);
              }}
              className={`tv-focusable px-3 py-1.5 rounded-lg text-xs font-medium whitespace-nowrap shrink-0 cursor-pointer transition-colors ${
                selectedGenre === 'ALL'
                  ? 'bg-red-600 text-white'
                  : 'bg-[#0e0e15] border border-neutral-800 text-neutral-300 hover:border-red-800/70'
              }`}
            >
              All Channels
            </button>
            {topCategories.map((cat) => (
              <button
                key={cat.id}
                type="button"
                onClick={() => {
                  setSelectedGenre(cat.name);
                  setGuideVisibleCount(12);
                }}
                className={`tv-focusable px-3 py-1.5 rounded-lg text-xs font-medium whitespace-nowrap shrink-0 cursor-pointer transition-colors ${
                  selectedGenre === cat.name
                    ? 'bg-red-600 text-white'
                    : 'bg-[#0e0e15] border border-neutral-800 text-neutral-300 hover:border-red-800/70'
                }`}
              >
                {cat.name}
              </button>
            ))}
          </div>
        </div>

        {/* 3:4 Program Poster Grid */}
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-4">
          {prioritizedChannels.slice(0, 18).map((ch) => {
            const pair = getProgramPair(ch.tvgId);
            const activeProg = pair.current || pair.next;
            const poster = resolveProgramPoster(activeProg, ch);
            const isSelected = spotlightChannel?.id === ch.id;
            const isLiveProg = Boolean(pair.current);
            const pct = pair.current
              ? computeProgressPct(pair.current.startTime, pair.current.endTime)
              : 0;

            return (
              <button
                key={ch.id}
                type="button"
                onFocus={() => setSpotlightChannelId(ch.id)}
                onMouseEnter={() => setSpotlightChannelId(ch.id)}
                onClick={() => onWatchChannel(ch, false)}
                className={`tv-focusable group relative rounded-xl overflow-hidden bg-[#0a0a0f] border text-left transition-all cursor-pointer flex flex-col ${
                  isSelected
                    ? 'border-red-500 shadow-[0_0_24px_rgba(220,38,38,0.22)]'
                    : 'border-neutral-800/80 hover:border-red-700/80'
                }`}
              >
                {/* 3:4 Vertical Program Poster Image */}
                <div className="relative aspect-[3/4] w-full overflow-hidden bg-[#08080c]">
                  <PosterArtwork
                    src={poster.primary}
                    fallbackSrc={poster.fallback}
                    alt={activeProg?.title || ch.name}
                    className="w-full h-full object-cover transition-transform duration-300 group-hover:scale-105"
                  />
                  <div className="absolute inset-0 bg-gradient-to-t from-[#050507] via-[#050507]/35 to-transparent" />

                  {/* Channel Logo & Number Overlay */}
                  <div className="absolute top-2.5 left-2.5 right-2.5 flex items-center justify-between gap-2">
                    <img
                      src={ch.logoUrl || DEFAULT_CHANNEL_LOGO}
                      alt={ch.name}
                      loading="lazy"
                      referrerPolicy="no-referrer"
                      className="w-7 h-7 rounded-md object-cover bg-black/85 border border-white/15 shrink-0"
                    />
                    <span className="text-[11px] font-mono font-semibold text-white bg-black/75 px-1.5 py-0.5 rounded tabular-nums">
                      CH {ch.channelNumber}
                    </span>
                  </div>

                  {/* Poster Footer Info */}
                  <div className="absolute bottom-2.5 left-2.5 right-2.5 space-y-1">
                    <div className="text-[11px] font-mono tabular-nums text-red-400 truncate">
                      {activeProg
                        ? formatTimeRange(activeProg.startTime, activeProg.endTime)
                        : ch.categoryName || ch.groupTitle || 'Live Stream'}
                    </div>
                    <div className="text-sm font-semibold text-white leading-snug line-clamp-2">
                      {activeProg?.title || ch.name}
                    </div>
                    <div className="text-xs text-neutral-300 truncate">
                      {activeProg ? ch.name : 'Continuous Broadcast'}
                    </div>
                    {isLiveProg && (
                      <progress
                        value={pct}
                        max={100}
                        className="mt-1 block w-full h-1 rounded-full overflow-hidden [&::-webkit-progress-bar]:bg-white/20 [&::-webkit-progress-value]:bg-red-500 [&::-moz-progress-bar]:bg-red-500"
                      />
                    )}
                  </div>
                </div>

                {/* Next Program Quiet Footer */}
                {pair.next && (
                  <div className="px-2.5 py-2 border-t border-neutral-800/80 bg-[#0b0b11] text-[11px] text-neutral-400 truncate">
                    Next: <span className="text-neutral-200">{pair.next.title}</span>
                  </div>
                )}
              </button>
            );
          })}
        </div>
      </section>

      {/* 3. Interactive EPG Broadcast Guide (With Program Poster Thumbnails) */}
      <section className="space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <h2 className="font-display text-xl font-bold tracking-tight text-white">
              EPG Broadcast Guide
            </h2>
            <p className="text-xs text-neutral-400 mt-0.5">
              Channel schedule and upcoming programs synced to your lineup
            </p>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            {hasAnyEpg && (
              <div className="flex items-center gap-1 p-1 rounded-lg bg-[#0d0d13] border border-neutral-800">
                <button
                  type="button"
                  onClick={() => setGuideFilterMode('all')}
                  className={`tv-focusable px-2.5 py-1 rounded-md text-xs font-medium cursor-pointer transition-colors ${
                    guideFilterMode === 'all'
                      ? 'bg-red-600 text-white'
                      : 'text-neutral-400 hover:text-white'
                  }`}
                >
                  All Channels
                </button>
                <button
                  type="button"
                  onClick={() => setGuideFilterMode('with_epg')}
                  className={`tv-focusable px-2.5 py-1 rounded-md text-xs font-medium cursor-pointer transition-colors ${
                    guideFilterMode === 'with_epg'
                      ? 'bg-red-600 text-white'
                      : 'text-neutral-400 hover:text-white'
                  }`}
                >
                  With EPG
                </button>
              </div>
            )}

            <button
              type="button"
              onClick={onOpenFullGuide}
              className="tv-focusable px-3 py-1.5 rounded-lg bg-[#0e0e15] border border-red-900/50 hover:border-red-600 text-xs font-medium text-red-400 cursor-pointer whitespace-nowrap"
            >
              Open Full Guide
            </button>
          </div>
        </div>

        {!hasAnyEpg && (
          <div className="px-4 py-3 rounded-xl bg-[#0a0a0f] border border-neutral-800/80 text-xs text-neutral-400">
            No XMLTV schedule programs are attached to this playlist yet. Showing live broadcast channels with genre artwork — click any slot to watch immediately.
          </div>
        )}

        <div className="space-y-3">
          {guideChannels.map((ch) => {
            const list = ch.tvgId ? epgByChannelTvgId.get(ch.tvgId) ?? [] : [];
            const now = Date.now();
            const upcoming = list.filter((p) => new Date(p.endTime).getTime() > now);
            const slots = (upcoming.length > 0 ? upcoming : list).slice(0, 3);
            const fallbackPoster = resolveProgramPoster(null, ch);

            return (
              <div
                key={ch.id}
                className="rounded-xl bg-[#0a0a0f] border border-neutral-800/85 p-3 flex flex-col lg:flex-row lg:items-center gap-3"
              >
                {/* Channel Identity Column */}
                <button
                  type="button"
                  onClick={() => onWatchChannel(ch, false)}
                  className="tv-focusable w-full lg:w-56 shrink-0 flex items-center gap-3 p-2 rounded-lg bg-[#0f0f16] hover:bg-[#161621] border border-neutral-800/70 text-left cursor-pointer transition-colors"
                >
                  <img
                    src={ch.logoUrl || DEFAULT_CHANNEL_LOGO}
                    alt={ch.name}
                    loading="lazy"
                    referrerPolicy="no-referrer"
                    className="w-10 h-10 rounded-lg object-cover bg-black border border-neutral-800 shrink-0"
                  />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5 text-[11px] font-mono tabular-nums text-red-400">
                      <span>CH {ch.channelNumber}</span>
                      <span aria-hidden="true">·</span>
                      <span className="text-neutral-400 truncate">
                        {ch.categoryName || ch.groupTitle || 'Live'}
                      </span>
                    </div>
                    <div className="text-sm font-semibold text-white truncate mt-0.5">
                      {ch.name}
                    </div>
                  </div>
                </button>

                {/* Program Poster Slots */}
                <div className="flex-1 grid grid-cols-1 md:grid-cols-3 gap-2.5">
                  {slots.length > 0 ? (
                    slots.map((prog, idx) => {
                      const startMs = new Date(prog.startTime).getTime();
                      const endMs = new Date(prog.endTime).getTime();
                      const isLiveNow = startMs <= now && endMs > now;
                      const pct = isLiveNow ? computeProgressPct(prog.startTime, prog.endTime) : 0;
                      const slotPoster = resolveProgramPoster(prog, ch);

                      return (
                        <button
                          key={`${prog.title}-${prog.startTime}-${idx}`}
                          type="button"
                          onClick={() => onWatchChannel(ch, false)}
                          className={`tv-focusable flex items-center gap-3 p-2.5 rounded-lg border text-left transition-colors cursor-pointer ${
                            isLiveNow
                              ? 'bg-red-950/20 border-red-600/70 hover:bg-red-950/30'
                              : 'bg-[#0f0f16] border-neutral-800/80 hover:border-red-700/70'
                          }`}
                        >
                          <div className="w-11 h-16 rounded-md overflow-hidden shrink-0 border border-white/10 bg-[#050507]">
                            <PosterArtwork
                              src={slotPoster.primary}
                              fallbackSrc={slotPoster.fallback}
                              alt={prog.title}
                              className="w-full h-full object-cover"
                            />
                          </div>
                          <div className="min-w-0 flex-1 space-y-1">
                            <div className="flex items-center justify-between gap-2 text-[11px] font-mono tabular-nums">
                              <span className={isLiveNow ? 'text-red-400 font-semibold' : 'text-neutral-400'}>
                                {formatTimeRange(prog.startTime, prog.endTime)}
                              </span>
                              {isLiveNow && (
                                <span className="font-sans text-[10px] font-semibold text-red-400">
                                  On Now
                                </span>
                              )}
                            </div>
                            <div className="text-xs font-semibold text-white truncate">
                              {prog.title}
                            </div>
                            <div className="text-[11px] text-neutral-400 truncate">
                              {prog.category || prog.description || ch.name}
                            </div>
                            {isLiveNow && (
                              <progress
                                value={pct}
                                max={100}
                                className="block w-full h-1 rounded-full overflow-hidden [&::-webkit-progress-bar]:bg-neutral-800 [&::-webkit-progress-value]:bg-red-500 [&::-moz-progress-bar]:bg-red-500"
                              />
                            )}
                          </div>
                        </button>
                      );
                    })
                  ) : (
                    <button
                      type="button"
                      onClick={() => onWatchChannel(ch, false)}
                      className="tv-focusable md:col-span-3 flex items-center justify-between gap-4 p-2.5 rounded-lg bg-[#0f0f16] border border-neutral-800/80 hover:border-red-700/70 text-left cursor-pointer transition-colors"
                    >
                      <div className="flex items-center gap-3 min-w-0">
                        <div className="w-11 h-16 rounded-md overflow-hidden shrink-0 border border-white/10 bg-[#050507]">
                          <PosterArtwork
                            src={fallbackPoster.primary}
                            fallbackSrc={fallbackPoster.fallback}
                            alt={ch.name}
                            className="w-full h-full object-cover"
                          />
                        </div>
                        <div className="min-w-0">
                          <div className="text-[11px] font-mono text-red-400">Live Broadcast</div>
                          <div className="text-xs font-semibold text-white truncate mt-0.5">
                            {ch.name}
                          </div>
                          <div className="text-[11px] text-neutral-400 truncate">
                            {ch.categoryName || ch.groupTitle || 'Continuous Stream'}
                          </div>
                        </div>
                      </div>
                      <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-red-600/15 border border-red-600/40 text-xs font-medium text-red-400 whitespace-nowrap shrink-0">
                        <Play className="w-3 h-3 fill-current" />
                        Watch
                      </span>
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>

        {totalGuideMatching > guideVisibleCount && (
          <div className="pt-1">
            <button
              type="button"
              onClick={() => setGuideVisibleCount((n) => n + 12)}
              className="tv-focusable px-4 py-2 rounded-xl bg-[#0c0c12] border border-red-900/60 hover:border-red-600 text-xs font-semibold text-red-400 cursor-pointer tabular-nums"
            >
              Show More Channels ({totalGuideMatching - guideVisibleCount} remaining)
            </button>
          </div>
        )}
      </section>

      {/* 4. Recently Watched Quick Shelf */}
      {recentChannels.length > 0 && (
        <section className="space-y-3">
          <h2 className="font-display text-lg font-bold tracking-tight text-white">
            Recently Watched
          </h2>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
            {recentChannels.map((ch) => {
              const pair = getProgramPair(ch.tvgId);
              const poster = resolveProgramPoster(pair.current, ch);
              return (
                <button
                  key={ch.id}
                  type="button"
                  onClick={() => onWatchChannel(ch, false)}
                  className="tv-focusable flex items-center gap-2.5 p-2.5 rounded-xl bg-[#0a0a0f] border border-neutral-800/80 hover:border-red-600/70 text-left cursor-pointer transition-colors"
                >
                  <div className="w-10 h-14 rounded-md overflow-hidden shrink-0 border border-white/10">
                    <PosterArtwork
                      src={poster.primary}
                      fallbackSrc={poster.fallback}
                      alt={ch.name}
                      className="w-full h-full object-cover"
                    />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="text-[11px] font-mono text-red-400 tabular-nums">
                      CH {ch.channelNumber}
                    </div>
                    <div className="text-xs font-semibold text-white truncate mt-0.5">
                      {ch.name}
                    </div>
                    <div className="text-[11px] text-neutral-400 truncate">
                      {pair.current ? pair.current.title : 'Live TV'}
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
        </section>
      )}
    </div>
  );
};
