import React, { useEffect, useRef, useState } from 'react';
import Hls from 'hls.js';
import {
  AlertTriangle,
  ChevronDown,
  ChevronUp,
  Maximize2,
  Pause,
  Play,
  RefreshCw,
  Star,
  Subtitles,
  Volume2,
  VolumeX,
  X,
} from 'lucide-react';
import type { EffectiveChannel } from '../../packages/core-models/src/index';
import { apiUrl } from '../lib/apiConfig';

interface ProgramSlot {
  channelTvgId: string;
  title: string;
  description: string | null;
  startTime: string;
  endTime: string;
}

interface TvVideoPlayerProps {
  channel: EffectiveChannel;
  deviceToken?: string;
  isFullscreen: boolean;
  contained?: boolean;
  fillContainer?: boolean;
  playPauseSignal?: number;
  isFavorite: boolean;
  showOverlay: boolean;
  currentProgram: ProgramSlot | null;
  nextProgram: ProgramSlot | null;
  aspectRatio: 'contain' | 'cover' | '16:9' | '4:3';
  onAspectRatioChange: (ratio: 'contain' | 'cover' | '16:9' | '4:3') => void;
  onToggleFavorite: () => void;
  onChannelStep: (delta: number) => void;
  onCloseFullscreen: () => void;
  onToggleOverlay: () => void;
  onDiagnostic: (payload: {
    channelId: string;
    streamFormat: string;
    status: 'ok' | 'buffering' | 'error' | 'recovered';
    latencyMs?: number;
    bitrateKbps?: number;
    errorCode?: string;
    errorMessage?: string;
  }) => void;
}

export const TvVideoPlayer: React.FC<TvVideoPlayerProps> = ({
  channel,
  deviceToken,
  isFullscreen,
  contained = false,
  fillContainer = false,
  playPauseSignal = 0,
  isFavorite,
  showOverlay,
  currentProgram,
  nextProgram,
  aspectRatio,
  onAspectRatioChange,
  onToggleFavorite,
  onChannelStep,
  onCloseFullscreen,
  onToggleOverlay,
  onDiagnostic,
}) => {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const hlsRef = useRef<Hls | null>(null);
  const retryCountRef = useRef(0);
  const [playbackState, setPlaybackState] = useState<'loading' | 'playing' | 'paused' | 'error'>(
    'loading'
  );
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [audioTracks, setAudioTracks] = useState<Array<{ id: number; name: string }>>([]);
  const [currentAudio, setCurrentAudio] = useState<number>(-1);
  const [subtitleTracks, setSubtitleTracks] = useState<Array<{ id: number; name: string }>>([]);
  const [currentSubtitle, setCurrentSubtitle] = useState<number>(-1);
  const [reloadNonce, setReloadNonce] = useState(0);
  const [forceProxy, setForceProxy] = useState(false);
  const [isMuted, setIsMuted] = useState(false);
  const [isAudioOnly, setIsAudioOnly] = useState(false);

  useEffect(() => {
    setForceProxy(false);
    setIsAudioOnly(false);
  }, [channel.id, channel.streamUrl]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    let cancelled = false;
    let resolved = false;
    const startMs = performance.now();
    retryCountRef.current = 0;
    setPlaybackState('loading');
    setErrorMessage(null);
    setAudioTracks([]);
    setSubtitleTracks([]);
    setIsAudioOnly(false);

    const attemptAutoPlay = async () => {
      try {
        await video.play();
        if (!cancelled) {
          setIsMuted(video.muted);
          setPlaybackState('playing');
        }
      } catch {
        // Browser autoplay policy blocks unmuted autoplay: fall back to muted autoplay so video displays immediately
        try {
          video.muted = true;
          await video.play();
          if (!cancelled) {
            setIsMuted(true);
            setPlaybackState('playing');
          }
        } catch {
          if (!cancelled) {
            setPlaybackState('paused');
          }
        }
      }
    };

    const onVideoLoadedData = () => {
      if (cancelled) return;
      if (video.videoWidth > 0) {
        setIsAudioOnly(false);
      }
    };
    video.addEventListener('loadeddata', onVideoLoadedData);
    video.addEventListener('resize', onVideoLoadedData);

    // Timeout detector for unresponsive streams
    const timeoutId = window.setTimeout(() => {
      if (!cancelled && !resolved) {
        setErrorMessage('Stream timeout: source did not respond within 15 seconds.');
        setPlaybackState('error');
        onDiagnostic({
          channelId: channel.id,
          streamFormat: channel.streamFormat,
          status: 'error',
          errorCode: 'STREAM_TIMEOUT',
          errorMessage: '15s startup timeout exceeded',
        });
      }
    }, 15000);

    if (hlsRef.current) {
      hlsRef.current.destroy();
      hlsRef.current = null;
    }

    const rawUrl = channel.streamUrl;
    const needsProxy =
      Boolean(deviceToken) &&
      (forceProxy ||
        (window.location.protocol === 'https:' && rawUrl.trim().toLowerCase().startsWith('http://')) ||
        Object.keys(channel.httpHeaders || {}).length > 0);

    const effectiveUrl = needsProxy
      ? apiUrl(
          `/api/device/stream?${new URLSearchParams({
            url: rawUrl,
            token: deviceToken!,
            channelId: channel.id,
          }).toString()}`
        )
      : rawUrl;

    const isHls =
      channel.streamFormat === 'hls' ||
      rawUrl.toLowerCase().includes('.m3u8') ||
      channel.streamFormat === 'auto';

    if (isHls && Hls.isSupported()) {
      const hls = new Hls({
        enableWorker: true,
        lowLatencyMode: false,
        backBufferLength: 30,
        manifestLoadingMaxRetry: 2,
        fragLoadingMaxRetry: 3,
        fragLoadingTimeOut: 20000,
      });
      hlsRef.current = hls;

      hls.loadSource(effectiveUrl);
      hls.attachMedia(video);

      hls.on(Hls.Events.MANIFEST_PARSED, (_evt, data) => {
        if (cancelled) return;
        resolved = true;
        window.clearTimeout(timeoutId);
        const latencyMs = Math.round(performance.now() - startMs);
        const topBitrate = data.levels?.[0]?.bitrate
          ? Math.round(data.levels[0].bitrate / 1000)
          : 0;

        const hasAnyVideo =
          data.levels.length === 0 ||
          data.levels.some((lvl) => {
            const vc = (lvl.videoCodec || '').trim();
            const codecs = (lvl.codecs || '').toLowerCase();
            return (
              Boolean(vc) ||
              (lvl.width ?? 0) > 0 ||
              /avc1|hvc1|hev1|vp0?9|av01|mp4v/.test(codecs)
            );
          });
        if (!hasAnyVideo) {
          setIsAudioOnly(true);
        }

        setAudioTracks(
          hls.audioTracks.map((t, idx) => ({ id: idx, name: t.name || t.lang || `Audio ${idx + 1}` }))
        );
        setCurrentAudio(hls.audioTrack);
        setSubtitleTracks(
          hls.subtitleTracks.map((t, idx) => ({
            id: idx,
            name: t.name || t.lang || `Subtitle ${idx + 1}`,
          }))
        );
        setCurrentSubtitle(hls.subtitleTrack);

        void attemptAutoPlay();
        onDiagnostic({
          channelId: channel.id,
          streamFormat: 'hls',
          status: 'ok',
          latencyMs,
          bitrateKbps: topBitrate,
        });
      });

      hls.on(Hls.Events.ERROR, (_evt, data) => {
        if (cancelled || !data.fatal) return;

        // If direct browser playback failed due to CORS/network error, automatically switch to server proxy once
        if (!needsProxy && deviceToken && data.type === Hls.ErrorTypes.NETWORK_ERROR) {
          resolved = true;
          window.clearTimeout(timeoutId);
          setForceProxy(true);
          return;
        }

        if (retryCountRef.current < 2) {
          retryCountRef.current += 1;
          if (data.type === Hls.ErrorTypes.NETWORK_ERROR) {
            hls.startLoad();
            return;
          }
          if (data.type === Hls.ErrorTypes.MEDIA_ERROR) {
            hls.recoverMediaError();
            return;
          }
        }
        resolved = true;
        window.clearTimeout(timeoutId);
        const msg = `Playback error (${data.details}).`;
        setErrorMessage(msg);
        setPlaybackState('error');
        onDiagnostic({
          channelId: channel.id,
          streamFormat: channel.streamFormat,
          status: 'error',
          errorCode: data.details,
          errorMessage: msg,
        });
      });
    } else if (video.canPlayType('application/vnd.apple.mpegurl') || !isHls) {
      video.src = effectiveUrl;
      video.onloadedmetadata = () => {
        if (cancelled) return;
        resolved = true;
        window.clearTimeout(timeoutId);
        void attemptAutoPlay();
      };
      video.onerror = () => {
        if (cancelled) return;
        if (!needsProxy && deviceToken) {
          resolved = true;
          window.clearTimeout(timeoutId);
          setForceProxy(true);
          return;
        }
        resolved = true;
        window.clearTimeout(timeoutId);
        setErrorMessage(
          channel.streamFormat === 'mpegts'
            ? 'Direct MPEG-TS (.ts) requires native ExoPlayer (Android TV) or AVPlay (Samsung Tizen).'
            : 'Unable to play stream in browser media element.'
        );
        setPlaybackState('error');
      };
    }

    return () => {
      cancelled = true;
      window.clearTimeout(timeoutId);
      video.removeEventListener('loadeddata', onVideoLoadedData);
      video.removeEventListener('resize', onVideoLoadedData);
      if (hlsRef.current) {
        hlsRef.current.destroy();
        hlsRef.current = null;
      }
    };
  }, [channel.id, channel.streamUrl, reloadNonce, forceProxy, deviceToken]);

  const togglePlayPause = () => {
    const video = videoRef.current;
    if (!video) return;
    if (video.paused) {
      void video.play().then(() => {
        setPlaybackState('playing');
      }).catch(() => {
        video.muted = true;
        setIsMuted(true);
        void video.play().then(() => setPlaybackState('playing'));
      });
    } else {
      video.pause();
      setPlaybackState('paused');
    }
  };

  const toggleMute = () => {
    const video = videoRef.current;
    if (!video) return;
    video.muted = !video.muted;
    setIsMuted(video.muted);
    if (!video.muted && video.paused) {
      void video.play().then(() => setPlaybackState('playing'));
    }
  };

  useEffect(() => {
    if (playPauseSignal > 0) {
      togglePlayPause();
    }
  }, [playPauseSignal]);

  const cycleAspectRatio = () => {
    const order: Array<'contain' | 'cover' | '16:9' | '4:3'> = ['contain', 'cover', '16:9', '4:3'];
    const next = order[(order.indexOf(aspectRatio) + 1) % order.length];
    onAspectRatioChange(next);
  };

  const videoFitClass =
    aspectRatio === 'cover'
      ? 'w-full h-full object-cover'
      : aspectRatio === '16:9'
        ? 'w-[min(100cqw,calc(100cqh*16/9))] h-[min(100cqh,calc(100cqw*9/16))] object-fill'
        : aspectRatio === '4:3'
          ? 'w-[min(100cqw,calc(100cqh*4/3))] h-[min(100cqh,calc(100cqw*3/4))] object-fill'
          : 'w-full h-full object-contain';

  const aspectLabel =
    aspectRatio === 'contain' ? 'Fit' : aspectRatio === 'cover' ? 'Fill' : aspectRatio;

  return (
    <div
      className={
        isFullscreen
          ? `${contained ? 'absolute' : 'fixed'} inset-0 z-50 bg-black flex flex-col justify-center`
          : fillContainer
            ? 'relative w-full h-full bg-black rounded-xl overflow-hidden border border-red-900/50'
            : 'relative w-full aspect-video bg-black rounded-xl overflow-hidden border border-red-900/50'
      }
      onClick={onToggleOverlay}
    >
      <div className="absolute inset-0 [container-type:size] flex items-center justify-center bg-black overflow-hidden">
        <video
          ref={videoRef}
          className={videoFitClass}
          playsInline
          controls={false}
        />
      </div>

      {playbackState === 'loading' && (
        <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/65 pointer-events-none">
          <RefreshCw className="w-8 h-8 text-red-500 animate-spin mb-3" />
          <p className="text-sm font-medium text-neutral-100">
            Tuning {channel.channelNumber} · {channel.name}
          </p>
        </div>
      )}

      {playbackState === 'playing' && isAudioOnly && (
        <div className="absolute inset-0 flex flex-col items-center justify-center bg-[#070709] pointer-events-none pb-14">
          <div className="w-14 h-14 rounded-full bg-red-600/15 border border-red-500/40 flex items-center justify-center mb-3">
            <Volume2 className="w-7 h-7 text-red-500" />
          </div>
          <p className="text-sm font-semibold text-white">{channel.name}</p>
          <p className="text-xs text-neutral-400 mt-1">
            Audio-only broadcast stream (upstream playlist provides audio track only)
          </p>
        </div>
      )}

      {playbackState === 'paused' && (
        <div
          className="absolute inset-0 flex items-center justify-center bg-black/50 cursor-pointer"
          onClick={(e) => {
            e.stopPropagation();
            togglePlayPause();
          }}
        >
          <button
            type="button"
            className="px-5 py-2.5 rounded-xl bg-red-600 hover:bg-red-500 text-white font-semibold text-sm flex items-center gap-2 shadow-xl cursor-pointer"
          >
            <Play className="w-4 h-4 fill-current" />
            <span>Play Stream</span>
          </button>
        </div>
      )}

      {playbackState === 'error' && (
        <div
          className="absolute inset-0 flex flex-col items-center justify-center bg-[#09090c]/95 p-5 text-center"
          onClick={(e) => e.stopPropagation()}
        >
          <AlertTriangle className="w-9 h-9 text-red-500 mb-2.5" />
          <h4 className="text-base font-semibold text-white">Stream Unavailable</h4>
          <p className="text-xs text-neutral-300 max-w-md mt-1">{errorMessage}</p>
          <div className="flex flex-wrap items-center justify-center gap-2.5 mt-4">
            <button
              type="button"
              onClick={() => setReloadNonce((n) => n + 1)}
              className="px-4 py-2 rounded-lg bg-red-600 text-white font-semibold text-xs hover:bg-red-500 cursor-pointer"
            >
              Retry Connection
            </button>
            {deviceToken && !forceProxy && (
              <button
                type="button"
                onClick={() => setForceProxy(true)}
                className="px-4 py-2 rounded-lg bg-neutral-900 border border-red-900/50 text-red-400 text-xs hover:bg-neutral-800 cursor-pointer"
              >
                Try Server Proxy
              </button>
            )}
            <button
              type="button"
              onClick={() => onChannelStep(1)}
              className="px-4 py-2 rounded-lg bg-neutral-900 border border-neutral-800 text-neutral-200 text-xs hover:bg-neutral-800 cursor-pointer"
            >
              Next Channel
            </button>
          </div>
        </div>
      )}

      {(showOverlay || !isFullscreen) && (
        <div
          className={`absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/95 via-black/70 to-transparent ${
            isFullscreen ? 'p-6 pt-16' : 'px-4 py-3 pt-10'
          }`}
          onClick={(e) => e.stopPropagation()}
        >
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2.5 text-xs text-neutral-300 mb-0.5">
                <span className="font-mono tabular-nums text-red-500 font-semibold">
                  CH {channel.channelNumber}
                </span>
                <span>·</span>
                <span className="truncate">{channel.categoryName || channel.groupTitle || 'Live'}</span>
                <span>·</span>
                <span className="uppercase font-mono">{channel.streamFormat}</span>
              </div>
              <h3 className={`${isFullscreen ? 'text-xl' : 'text-base'} font-bold text-white truncate`}>
                {channel.name}
              </h3>
              {currentProgram ? (
                <p className="text-xs text-neutral-300 mt-0.5 truncate">
                  Now: {currentProgram.title}
                  {nextProgram ? ` · Next: ${nextProgram.title}` : ''}
                </p>
              ) : null}
            </div>

            <div className="flex items-center gap-1.5 flex-wrap">
              <button
                type="button"
                onClick={togglePlayPause}
                className="h-8 px-2.5 rounded-lg bg-black/80 border border-neutral-800 hover:border-red-600/60 hover:bg-neutral-900 text-white flex items-center gap-1.5 text-xs font-medium cursor-pointer"
                title="Play / Pause"
              >
                {playbackState === 'playing' ? (
                  <Pause className="w-3.5 h-3.5 text-red-500" />
                ) : (
                  <Play className="w-3.5 h-3.5 text-red-500" />
                )}
                <span>{playbackState === 'playing' ? 'Pause' : 'Play'}</span>
              </button>

              <button
                type="button"
                onClick={toggleMute}
                className={`h-8 px-2.5 rounded-lg flex items-center gap-1.5 text-xs font-medium cursor-pointer border ${
                  isMuted
                    ? 'bg-red-600/20 text-red-400 border-red-500/50'
                    : 'bg-black/80 border-neutral-800 hover:border-red-600/60 hover:bg-neutral-900 text-white'
                }`}
                title={isMuted ? 'Unmute Audio' : 'Mute Audio'}
              >
                {isMuted ? (
                  <VolumeX className="w-3.5 h-3.5" />
                ) : (
                  <Volume2 className="w-3.5 h-3.5" />
                )}
                <span>{isMuted ? 'Unmute' : 'Mute'}</span>
              </button>

              <button
                type="button"
                onClick={() => onChannelStep(-1)}
                className="h-8 px-2.5 rounded-lg bg-black/80 border border-neutral-800 hover:border-red-600/60 hover:bg-neutral-900 text-white flex items-center gap-1 text-xs cursor-pointer"
                title="Previous Channel"
              >
                <ChevronDown className="w-3.5 h-3.5" />
                <span>CH-</span>
              </button>

              <button
                type="button"
                onClick={() => onChannelStep(1)}
                className="h-8 px-2.5 rounded-lg bg-black/80 border border-neutral-800 hover:border-red-600/60 hover:bg-neutral-900 text-white flex items-center gap-1 text-xs cursor-pointer"
                title="Next Channel"
              >
                <ChevronUp className="w-3.5 h-3.5" />
                <span>CH+</span>
              </button>

              <button
                type="button"
                onClick={onToggleFavorite}
                className={`h-8 px-2.5 rounded-lg flex items-center gap-1 text-xs font-medium cursor-pointer border ${
                  isFavorite
                    ? 'bg-red-600/20 text-red-400 border-red-500/50'
                    : 'bg-black/80 border-neutral-800 text-neutral-200 hover:bg-neutral-900'
                }`}
              >
                <Star className={`w-3.5 h-3.5 ${isFavorite ? 'fill-red-500 text-red-500' : ''}`} />
                <span>{isFavorite ? 'Saved' : 'Fav'}</span>
              </button>

              {audioTracks.length > 1 && (
                <button
                  type="button"
                  onClick={() => {
                    if (!hlsRef.current) return;
                    const next = (currentAudio + 1) % audioTracks.length;
                    hlsRef.current.audioTrack = next;
                    setCurrentAudio(next);
                  }}
                  className="h-8 px-2.5 rounded-lg bg-black/80 border border-neutral-800 hover:bg-neutral-900 text-white flex items-center gap-1 text-xs cursor-pointer"
                >
                  <Volume2 className="w-3.5 h-3.5" />
                  <span>{audioTracks[currentAudio]?.name || 'Audio'}</span>
                </button>
              )}

              {subtitleTracks.length > 0 && (
                <button
                  type="button"
                  onClick={() => {
                    if (!hlsRef.current) return;
                    const next = currentSubtitle + 1 >= subtitleTracks.length ? -1 : currentSubtitle + 1;
                    hlsRef.current.subtitleTrack = next;
                    setCurrentSubtitle(next);
                  }}
                  className="h-8 px-2.5 rounded-lg bg-black/80 border border-neutral-800 hover:bg-neutral-900 text-white flex items-center gap-1 text-xs cursor-pointer"
                >
                  <Subtitles className="w-3.5 h-3.5" />
                  <span>{currentSubtitle === -1 ? 'CC Off' : subtitleTracks[currentSubtitle]?.name}</span>
                </button>
              )}

              <button
                type="button"
                onClick={cycleAspectRatio}
                title={`Aspect Ratio: ${aspectLabel}`}
                className="h-8 px-2.5 rounded-lg bg-black/80 border border-neutral-800 hover:bg-neutral-900 text-white flex items-center gap-1 text-xs cursor-pointer"
              >
                <Maximize2 className="w-3.5 h-3.5" />
                <span>{aspectLabel}</span>
              </button>

              {isFullscreen && (
                <button
                  type="button"
                  onClick={onCloseFullscreen}
                  className="h-8 px-2.5 rounded-lg bg-red-600 hover:bg-red-500 text-white flex items-center gap-1 text-xs font-medium cursor-pointer"
                >
                  <X className="w-3.5 h-3.5" />
                  <span>Exit</span>
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
