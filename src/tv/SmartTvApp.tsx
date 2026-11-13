import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Bookmark,
  Calendar,
  FolderKanban,
  Home,
  RefreshCw,
  Search as SearchIcon,
  Tv,
  Wifi,
  WifiOff,
} from 'lucide-react';
import { toast } from 'sonner';
import type { DeviceSyncConfig, EffectiveChannel } from '../../packages/core-models/src/index';
import { RemoteKeyManager, type RemoteAction } from './RemoteKeyManager';
import { TvVideoPlayer } from './TvVideoPlayer';
import { TvHomeScreen } from './TvHomeScreen';
import { tvStorage, type TvDeviceIdentity } from './tvStorage';
import { apiUrl, wsUrl } from '../lib/apiConfig';
import { Button, Input } from '../components/ui/Primitives';

type TvScreen =
  | 'home'
  | 'live'
  | 'categories'
  | 'favorites'
  | 'epg'
  | 'search';

export const SmartTvApp: React.FC<{
  contained?: boolean;
  platformLabel?: string;
  externalRemote?: RemoteKeyManager;
}> = ({ contained = false, platformLabel = 'Smart Display', externalRemote }) => {
  const [identity, setIdentity] = useState<TvDeviceIdentity | null>(null);
  const [bootstrapping, setBootstrapping] = useState(true);
  const [pairingCode, setPairingCode] = useState<string | null>(null);
  const [pairingExpiresAt, setPairingExpiresAt] = useState<string | null>(null);
  const [hardwareId, setHardwareId] = useState<string>('');
  const [pairingError, setPairingError] = useState<string | null>(null);
  const [isRevoked, setIsRevoked] = useState(false);

  const [config, setConfig] = useState<DeviceSyncConfig | null>(null);
  const [screen, setScreen] = useState<TvScreen>('live');
  const [selectedCategory, setSelectedCategory] = useState<string>('ALL');
  const [searchQuery, setSearchQuery] = useState('');
  const [activeChannel, setActiveChannel] = useState<EffectiveChannel | null>(null);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [showOverlay, setShowOverlay] = useState(true);
  const [favorites, setFavorites] = useState<string[]>([]);
  const [historyIds, setHistoryIds] = useState<string[]>([]);
  const [aspectRatio, setAspectRatio] = useState<'contain' | 'cover' | '16:9' | '4:3'>('contain');
  const [wsConnected, setWsConnected] = useState(false);
  const [isOffline, setIsOffline] = useState(!navigator.onLine);
  const [numericBuffer, setNumericBuffer] = useState('');
  const [playPauseSignal, setPlayPauseSignal] = useState(0);
  const [liveVisibleCount, setLiveVisibleCount] = useState(80);
  const [epgVisibleCount, setEpgVisibleCount] = useState(40);
  const [liveGuideMode, setLiveGuideMode] = useState<'channel' | 'lineup'>('channel');

  const tvRootRef = useRef<HTMLDivElement | null>(null);
  const lastFocusedTvElRef = useRef<HTMLElement | null>(null);
  const remoteRef = useRef<RemoteKeyManager | null>(null);
  const numericTimerRef = useRef<number | null>(null);
  const overlayTimerRef = useRef<number | null>(null);
  const activeChannelRef = useRef<EffectiveChannel | null>(null);
  const configRef = useRef<DeviceSyncConfig | null>(null);

  useEffect(() => {
    activeChannelRef.current = activeChannel;
  }, [activeChannel]);

  useEffect(() => {
    configRef.current = config;
  }, [config]);

  const bootstrapTvIdentity = useCallback(async (hwId: string): Promise<TvDeviceIdentity | null> => {
    try {
      setBootstrapping(true);
      setPairingError(null);
      const res = await fetch(apiUrl('/api/device/bootstrap'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          hardwareId: hwId,
          platform: 'web_tv',
          model: 'Vanguard Smart TV Client',
          appVersion: '1.0.0',
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.status === 403) {
        setIsRevoked(true);
        setPairingError(data.error || 'This TV has been disabled by an administrator.');
        return null;
      }
      if (!res.ok) {
        setPairingError(data.error || 'Unable to connect to broadcast server.');
        return null;
      }
      if (data.status === 'active' && data.deviceToken) {
        const newId: TvDeviceIdentity = {
          hardwareId: hwId,
          deviceId: data.deviceId,
          deviceToken: data.deviceToken,
          deviceName: data.deviceName || 'Smart TV',
        };
        await tvStorage.saveDeviceIdentity(newId);
        setIdentity(newId);
        setPairingCode(null);
        setIsRevoked(false);
        return newId;
      }
      if (data.status === 'pending' && data.pairingCode) {
        setPairingCode(data.pairingCode);
        setPairingExpiresAt(data.expiresAt || null);
      }
      return null;
    } catch {
      setPairingError('Unable to reach broadcast server.');
      return null;
    } finally {
      setBootstrapping(false);
    }
  }, []);

  const fetchLatestConfig = useCallback(
    async (devIdentity: TvDeviceIdentity, quiet = false) => {
      if (!devIdentity.deviceToken) return;
      try {
        const res = await fetch(apiUrl('/api/device/config'), {
          headers: { Authorization: `Bearer ${devIdentity.deviceToken}` },
        });
        if (res.status === 401 || res.status === 403) {
          await tvStorage.clearDeviceIdentity();
          setIdentity(null);
          setConfig(null);
          // Attempt seamless zero-touch re-bootstrap in case credential rotated
          const refreshed = await bootstrapTvIdentity(devIdentity.hardwareId);
          if (refreshed) {
            const retryRes = await fetch(apiUrl('/api/device/config'), {
              headers: { Authorization: `Bearer ${refreshed.deviceToken}` },
            });
            if (retryRes.ok) {
              const nextConfig = (await retryRes.json()) as DeviceSyncConfig;
              setConfig(nextConfig);
              await tvStorage.saveCachedConfig(nextConfig);
              if (nextConfig.channels.length > 0) setActiveChannel(nextConfig.channels[0]);
            }
          }
          return;
        }
        if (!res.ok) throw new Error('Sync request failed');
        const nextConfig = (await res.json()) as DeviceSyncConfig;
        setConfig(nextConfig);
        setIsOffline(false);
        await tvStorage.saveCachedConfig(nextConfig);

        const currentActive = activeChannelRef.current;
        if (!currentActive && nextConfig.channels.length > 0) {
          const prefs = await tvStorage.getPreferences();
          const last = nextConfig.channels.find((c) => c.id === prefs.lastPlayedChannelId);
          setActiveChannel(last || nextConfig.channels[0]);
        } else if (currentActive) {
          const updated = nextConfig.channels.find((c) => c.id === currentActive.id);
          setActiveChannel(updated || nextConfig.channels[0] || null);
        }

        await fetch(apiUrl('/api/device/sync/ack'), {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${devIdentity.deviceToken}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ configVersion: nextConfig.configVersion, status: 'acknowledged' }),
        });

        if (!quiet) toast.success(`Synced ${nextConfig.channels.length} channels`);
      } catch {
        setIsOffline(true);
        const cached = await tvStorage.getCachedConfig();
        if (cached && !configRef.current) {
          setConfig(cached);
          if (cached.channels.length > 0) setActiveChannel(cached.channels[0]);
        }
      }
    },
    [bootstrapTvIdentity]
  );

  // Zero-touch Bootstrap TV identity & IndexedDB cache
  useEffect(() => {
    let active = true;
    (async () => {
      const hwId = await tvStorage.getOrCreateHardwareId();
      if (!active) return;
      setHardwareId(hwId);

      const prefs = await tvStorage.getPreferences();
      setAspectRatio(prefs.aspectRatio);
      setFavorites(await tvStorage.getLocalFavorites());
      const hist = await tvStorage.getLocalHistory();
      setHistoryIds(hist.map((h) => h.channelId));

      const cached = await tvStorage.getCachedConfig();
      if (cached && active) {
        setConfig(cached);
        const last = cached.channels.find((c) => c.id === prefs.lastPlayedChannelId);
        setActiveChannel(last || cached.channels[0] || null);
      }

      const savedId = await tvStorage.getDeviceIdentity();
      if (savedId?.deviceToken && active) {
        setIdentity(savedId);
        setBootstrapping(false);
        void fetchLatestConfig(savedId, true);
      } else if (active) {
        const autoId = await bootstrapTvIdentity(hwId);
        if (autoId && active) {
          void fetchLatestConfig(autoId, true);
        }
      }
    })();

    return () => {
      active = false;
    };
  }, []);

  // Poll pairing status only if administrator explicitly enabled require_manual_pairing
  useEffect(() => {
    if (identity?.deviceToken || !pairingCode || !hardwareId) return;
    const interval = window.setInterval(async () => {
      try {
        const res = await fetch(apiUrl('/api/device/pairing/poll'), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ hardwareId, pairingCode }),
        });
        const data = await res.json();
        if (data.status === 'active' && data.deviceToken) {
          const newId: TvDeviceIdentity = {
            hardwareId,
            deviceId: data.deviceId,
            deviceToken: data.deviceToken,
            deviceName: data.deviceName || 'Smart TV',
          };
          await tvStorage.saveDeviceIdentity(newId);
          setIdentity(newId);
          setPairingCode(null);
          void fetchLatestConfig(newId, true);
        }
      } catch {
        // Retry silently
      }
    }, 3000);
    return () => window.clearInterval(interval);
  }, [identity, pairingCode, hardwareId, fetchLatestConfig]);

  // Real-Time WebSocket connection + periodic polling fallback
  useEffect(() => {
    if (!identity?.deviceToken) return;

    const socketEndpoint = wsUrl(`/ws/device?token=${encodeURIComponent(identity.deviceToken)}`);
    let ws: WebSocket | null = null;
    let reconnectTimer: number | null = null;
    let closedByEffect = false;

    const connectWs = () => {
      ws = new WebSocket(socketEndpoint);
      ws.onopen = () => {
        setWsConnected(true);
        setIsOffline(false);
      };
      ws.onmessage = (evt) => {
        try {
          const msg = JSON.parse(evt.data) as { type: string };
          if (msg.type === 'sync:update_available') {
            toast.info('Playlist update published — synchronizing silently');
            void fetchLatestConfig(identity, true);
          } else if (msg.type === 'device:revoked') {
            toast.error('This TV has been revoked by an administrator.');
            void tvStorage.clearDeviceIdentity();
            setIdentity(null);
            setConfig(null);
          }
        } catch {
          // Ignore
        }
      };
      ws.onclose = () => {
        setWsConnected(false);
        if (!closedByEffect) {
          reconnectTimer = window.setTimeout(connectWs, 5000);
        }
      };
    };

    connectWs();

    const fallbackPoll = window.setInterval(() => {
      void fetchLatestConfig(identity, true);
    }, 60000);

    return () => {
      closedByEffect = true;
      if (reconnectTimer) window.clearTimeout(reconnectTimer);
      window.clearInterval(fallbackPoll);
      ws?.close();
    };
  }, [identity, fetchLatestConfig]);

  const channels = config?.channels ?? [];

  const selectChannel = useCallback(
    async (ch: EffectiveChannel, openFullscreen = false) => {
      setActiveChannel(ch);
      if (openFullscreen) setIsFullscreen(true);
      setShowOverlay(true);
      if (overlayTimerRef.current) window.clearTimeout(overlayTimerRef.current);
      overlayTimerRef.current = window.setTimeout(() => setShowOverlay(false), 5000);

      await tvStorage.pushLocalHistory(ch.id);
      setHistoryIds((prev) => [ch.id, ...prev.filter((id) => id !== ch.id)].slice(0, 25));
      await tvStorage.savePreferences({ aspectRatio, lastPlayedChannelId: ch.id });

      if (identity?.deviceToken) {
        void fetch(apiUrl('/api/device/history'), {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${identity.deviceToken}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ channelId: ch.id }),
        });
      }
    },
    [aspectRatio, identity]
  );

  const stepChannel = useCallback(
    (delta: number) => {
      if (channels.length === 0) return;
      const idx = activeChannel ? channels.findIndex((c) => c.id === activeChannel.id) : 0;
      const nextIdx = (idx + delta + channels.length) % channels.length;
      void selectChannel(channels[nextIdx], isFullscreen);
    },
    [channels, activeChannel, isFullscreen, selectChannel]
  );

  const setTvFocus = useCallback((el: HTMLElement | null) => {
    const root = tvRootRef.current;
    if (root) {
      root.querySelectorAll('.tv-focused').forEach((node) => node.classList.remove('tv-focused'));
    }
    if (el) {
      lastFocusedTvElRef.current = el;
      el.classList.add('tv-focused');
      el.focus();
      el.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    }
  }, []);

  const moveSpatialFocus = useCallback((dir: Extract<RemoteAction, 'UP' | 'DOWN' | 'LEFT' | 'RIGHT'>) => {
    const root = tvRootRef.current;
    if (!root) return;
    const candidates = Array.from(root.querySelectorAll<HTMLElement>('.tv-focusable')).filter(
      (el) => el.offsetParent !== null
    );
    if (candidates.length === 0) return;

    const docActive = document.activeElement as HTMLElement | null;
    const active =
      docActive && candidates.includes(docActive)
        ? docActive
        : lastFocusedTvElRef.current && candidates.includes(lastFocusedTvElRef.current)
          ? lastFocusedTvElRef.current
          : null;

    if (!active) {
      setTvFocus(candidates[0]);
      return;
    }

    const cur = active.getBoundingClientRect();
    const curX = cur.left + cur.width / 2;
    const curY = cur.top + cur.height / 2;

    let bestEl: HTMLElement | null = null;
    let bestScore = Infinity;

    for (const el of candidates) {
      if (el === active) continue;
      const r = el.getBoundingClientRect();
      const x = r.left + r.width / 2;
      const y = r.top + r.height / 2;
      const dx = x - curX;
      const dy = y - curY;

      const valid =
        (dir === 'UP' && dy < -8) ||
        (dir === 'DOWN' && dy > 8) ||
        (dir === 'LEFT' && dx < -8) ||
        (dir === 'RIGHT' && dx > 8);

      if (!valid) continue;

      const primary = dir === 'UP' || dir === 'DOWN' ? Math.abs(dy) : Math.abs(dx);
      const secondary = dir === 'UP' || dir === 'DOWN' ? Math.abs(dx) : Math.abs(dy);
      const score = primary + secondary * 2.2;
      if (score < bestScore) {
        bestScore = score;
        bestEl = el;
      }
    }

    if (bestEl) {
      setTvFocus(bestEl);
    } else {
      setTvFocus(active);
    }
  }, [setTvFocus]);

  // Centralized RemoteKeyManager wiring
  useEffect(() => {
    const manager = externalRemote || new RemoteKeyManager();
    remoteRef.current = manager;
    if (!externalRemote) {
      manager.attach();
    }

    const unsub = manager.subscribe((evt) => {
      if (evt.action === 'BACK') {
        if (isFullscreen) {
          setIsFullscreen(false);
        } else if (screen !== 'live') {
          setScreen('live');
        }
        return;
      }

      if (evt.action === 'INFO') {
        setShowOverlay((prev) => !prev);
        return;
      }

      if (evt.action === 'PLAY_PAUSE') {
        setPlayPauseSignal((n) => n + 1);
        return;
      }

      if (evt.action === 'MENU') {
        setScreen((prev) => (prev === 'live' ? 'home' : 'live'));
        return;
      }

      if (evt.action === 'CHANNEL_UP') {
        stepChannel(1);
        return;
      }

      if (evt.action === 'CHANNEL_DOWN') {
        stepChannel(-1);
        return;
      }

      if (evt.action === 'DIGIT' && evt.digit) {
        setNumericBuffer((prev) => {
          const next = (prev + evt.digit).slice(0, 4);
          if (numericTimerRef.current) window.clearTimeout(numericTimerRef.current);
          numericTimerRef.current = window.setTimeout(() => {
            const targetNum = Number.parseInt(next, 10);
            const match = channels.find((c) => c.channelNumber === targetNum);
            if (match) {
              void selectChannel(match, isFullscreen);
            } else {
              toast.info(`Channel ${targetNum} not in lineup`);
            }
            setNumericBuffer('');
          }, 1100);
          return next;
        });
        return;
      }

      if (isFullscreen) {
        if (evt.action === 'UP') stepChannel(1);
        if (evt.action === 'DOWN') stepChannel(-1);
        if (evt.action === 'SELECT') setShowOverlay((v) => !v);
        return;
      }

      if (
        evt.action === 'UP' ||
        evt.action === 'DOWN' ||
        evt.action === 'LEFT' ||
        evt.action === 'RIGHT'
      ) {
        moveSpatialFocus(evt.action);
      } else if (evt.action === 'SELECT') {
        const docActive = document.activeElement as HTMLElement | null;
        const target =
          docActive && tvRootRef.current?.contains(docActive)
            ? docActive
            : lastFocusedTvElRef.current;
        if (target && tvRootRef.current?.contains(target)) {
          target.click();
        }
      }
    });

    return () => {
      unsub();
      if (!externalRemote) {
        manager.detach();
      }
    };
  }, [
    externalRemote,
    isFullscreen,
    screen,
    stepChannel,
    channels,
    selectChannel,
    moveSpatialFocus,
  ]);

  const toggleFavorite = async (channelId: string) => {
    const next = favorites.includes(channelId)
      ? favorites.filter((id) => id !== channelId)
      : [...favorites, channelId];
    setFavorites(next);
    await tvStorage.saveLocalFavorites(next);
    if (identity?.deviceToken) {
      void fetch(apiUrl('/api/device/favorites/toggle'), {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${identity.deviceToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ channelId }),
      });
    }
  };

  const epgByChannelTvgId = useMemo(() => {
    const map = new Map<string, DeviceSyncConfig['epgPrograms']>();
    for (const prog of config?.epgPrograms ?? []) {
      const key = prog.channelTvgId;
      if (!key) continue;
      const list = map.get(key);
      if (list) {
        list.push(prog);
      } else {
        map.set(key, [prog]);
      }
    }
    for (const list of map.values()) {
      list.sort((a, b) => new Date(a.startTime).getTime() - new Date(b.startTime).getTime());
    }
    return map;
  }, [config]);

  const getProgramPair = useCallback(
    (tvgId: string | null) => {
      if (!tvgId) return { current: null, next: null };
      const chProgs = epgByChannelTvgId.get(tvgId);
      if (!chProgs || chProgs.length === 0) return { current: null, next: null };
      const now = Date.now();
      const current =
        chProgs.find(
          (p) => new Date(p.startTime).getTime() <= now && new Date(p.endTime).getTime() > now
        ) || null;
      const next =
        chProgs.find((p) => new Date(p.startTime).getTime() > now) || null;
      return { current, next };
    },
    [epgByChannelTvgId]
  );

  const activeChannelSchedule = useMemo(() => {
    if (!activeChannel?.tvgId) return [];
    const list = epgByChannelTvgId.get(activeChannel.tvgId) ?? [];
    const now = Date.now();
    const upcomingOrLive = list.filter((p) => new Date(p.endTime).getTime() > now);
    return (upcomingOrLive.length > 0 ? upcomingOrLive : list).slice(0, 12);
  }, [activeChannel, epgByChannelTvgId]);

  const filteredChannels = useMemo(() => {
    return channels.filter((ch) => {
      const catMatch =
        selectedCategory === 'ALL' ||
        (ch.categoryName || ch.groupTitle || 'Uncategorized') === selectedCategory;
      const q = searchQuery.trim().toLowerCase();
      const searchMatch =
        !q ||
        ch.name.toLowerCase().includes(q) ||
        String(ch.channelNumber).includes(q);
      return catMatch && searchMatch;
    });
  }, [channels, selectedCategory, searchQuery]);

  // Zero-touch startup / Admin-locked pairing or suspended screen
  if (!identity?.deviceToken && !config) {
    if (bootstrapping) {
      return (
        <div
          className={`${
            contained ? 'h-full w-full' : 'min-h-screen'
          } bg-[#050507] text-neutral-100 flex flex-col items-center justify-center p-6`}
        >
          <div className="flex flex-col items-center gap-3 text-center">
            <div className="w-12 h-12 rounded-2xl bg-red-600/15 border border-red-500/40 flex items-center justify-center">
              <RefreshCw className="w-6 h-6 text-red-500 animate-spin" />
            </div>
            <div className="text-sm font-semibold text-white">Connecting to Live TV...</div>
          </div>
        </div>
      );
    }

    if (isRevoked) {
      return (
        <div
          className={`${
            contained ? 'h-full w-full' : 'min-h-screen'
          } bg-[#050507] text-neutral-100 flex flex-col items-center justify-center p-6`}
        >
          <div className="w-full max-w-md bg-[#0c0c10] border border-red-900/60 rounded-2xl p-6 text-center space-y-3">
            <Tv className="w-8 h-8 text-red-500 mx-auto" />
            <h1 className="text-lg font-bold text-white">Broadcast Access Suspended</h1>
            <p className="text-xs text-neutral-400">
              {pairingError || 'Contact your service administrator to reactivate this television.'}
            </p>
            <div className="text-[11px] font-mono text-neutral-500">Hardware ID: {hardwareId}</div>
          </div>
        </div>
      );
    }

    if (pairingCode) {
      return (
        <div
          className={`${
            contained ? 'h-full w-full' : 'min-h-screen'
          } bg-[#050507] text-neutral-100 flex flex-col items-center justify-center p-6 overflow-y-auto`}
        >
          <div className={`w-full max-w-xl bg-[#0c0c10] border border-red-950/60 rounded-2xl text-center ${contained ? 'p-5 sm:p-6' : 'p-8'}`}>
            <div className="w-11 h-11 rounded-xl bg-red-600/15 border border-red-500/40 flex items-center justify-center mx-auto mb-3">
              <Tv className="w-5 h-5 text-red-500" />
            </div>
            <h1 className={`${contained ? 'text-xl sm:text-2xl' : 'text-2xl'} font-bold tracking-tight text-white`}>
              Waiting for Administrator Activation
            </h1>
            <p className="text-xs text-neutral-400 mt-1.5 max-w-md mx-auto">
              Provide this activation code to your administrator to authorize this {platformLabel}.
            </p>

            <div className={`${contained ? 'mt-4 py-3.5 px-6' : 'mt-6 py-5 px-7'} rounded-xl bg-[#050507] border border-red-900/50 inline-block`}>
              <div className="text-xs text-neutral-400 mb-1">Activation Code</div>
              <div className={`${contained ? 'text-3xl sm:text-4xl' : 'text-4xl'} font-mono font-bold tracking-[0.22em] text-red-500 tabular-nums`}>
                {pairingCode}
              </div>
              <div className="text-xs text-neutral-500 mt-1.5 font-mono">
                Hardware ID: {hardwareId}
                {pairingExpiresAt ? ` · Expires ${new Date(pairingExpiresAt).toLocaleTimeString()}` : ''}
              </div>
            </div>
          </div>
        </div>
      );
    }

    return (
      <div
        className={`${
          contained ? 'h-full w-full' : 'min-h-screen'
        } bg-[#050507] text-neutral-100 flex flex-col items-center justify-center p-6`}
      >
        <div className="w-full max-w-md bg-[#0c0c10] border border-red-950/60 rounded-2xl p-6 text-center space-y-4">
          <Tv className="w-8 h-8 text-red-500 mx-auto" />
          <p className="text-sm text-neutral-300">
            {pairingError || 'Unable to connect to broadcast service.'}
          </p>
          <Button size="sm" onClick={() => void bootstrapTvIdentity(hardwareId)}>
            <RefreshCw className="w-3.5 h-3.5" />
            Reconnect
          </Button>
        </div>
      </div>
    );
  }

  const navItems: Array<{ id: TvScreen; label: string; icon: React.ReactNode }> = [
    { id: 'live', label: 'Live TV', icon: <Tv className="w-4 h-4" /> },
    { id: 'home', label: 'Home', icon: <Home className="w-4 h-4" /> },
    { id: 'categories', label: 'Categories', icon: <FolderKanban className="w-4 h-4" /> },
    { id: 'favorites', label: 'Favorites', icon: <Bookmark className="w-4 h-4" /> },
    { id: 'epg', label: 'TV Guide', icon: <Calendar className="w-4 h-4" /> },
    { id: 'search', label: 'Search', icon: <SearchIcon className="w-4 h-4" /> },
  ];

  const activeProgPair = getProgramPair(activeChannel?.tvgId ?? null);

  return (
    <div
      ref={tvRootRef}
      onFocusCapture={(e) => {
        const target = e.target;
        if (target instanceof HTMLElement && target.classList.contains('tv-focusable')) {
          tvRootRef.current
            ?.querySelectorAll('.tv-focused')
            .forEach((node) => node.classList.remove('tv-focused'));
          lastFocusedTvElRef.current = target;
          target.classList.add('tv-focused');
        }
      }}
      className={`${
        contained ? 'h-full w-full relative overflow-hidden' : 'min-h-screen'
      } bg-[#050507] text-neutral-100 flex flex-row`}
    >
      {/* Sleek Icon-Only Left Navigation Rail (Matte Black & Crimson Red) */}
      <aside
        aria-label="TV Navigation"
        className={`${contained ? 'w-14 py-2.5' : 'w-16 py-4'} shrink-0 bg-[#09090d] border-r border-red-950/60 flex flex-col items-center justify-between gap-2`}
      >
        {/* Brand Monogram */}
        <div
          title={`Vanguard TV · ${identity?.deviceName || config?.deviceName || platformLabel}`}
          className={`${contained ? 'w-9 h-9' : 'w-10 h-10'} rounded-xl bg-gradient-to-br from-red-600/25 to-red-950/40 border border-red-600/40 flex items-center justify-center shrink-0 shadow-sm shadow-red-950/50`}
        >
          <span className="text-sm font-black tracking-tight text-red-500">V</span>
        </div>

        {/* Icon-Only Primary Navigation */}
        <nav className="flex-1 flex flex-col items-center [justify-content:safe_center] gap-1.5 w-full px-1.5 overflow-y-auto min-h-0">
          {navItems.map((item) => {
            const active = screen === item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => setScreen(item.id)}
                title={item.label}
                aria-label={item.label}
                aria-current={active ? 'page' : undefined}
                className={`tv-focusable ${
                  contained ? 'w-9 h-9' : 'w-11 h-11'
                } rounded-xl flex items-center justify-center transition-all cursor-pointer shrink-0 relative ${
                  active
                    ? 'bg-red-600 text-white shadow-[0_0_18px_rgba(220,38,38,0.45)] ring-1 ring-red-400/50'
                    : 'text-neutral-400 hover:text-white hover:bg-[#14141d] border border-transparent hover:border-red-950/70'
                }`}
              >
                {item.icon}
              </button>
            );
          })}
        </nav>

        {/* Bottom Utility Indicator: Live Sync Status */}
        <div className="flex flex-col items-center gap-1.5 pt-2 border-t border-red-950/40 w-full px-1.5 shrink-0">
          <div
            title={
              isOffline
                ? 'Offline Mode'
                : wsConnected
                  ? 'Connected'
                  : 'Sync Active'
            }
            aria-label={
              isOffline
                ? 'Offline Mode'
                : wsConnected
                  ? 'Connected'
                  : 'Sync Active'
            }
            className={`${contained ? 'w-9 h-8' : 'w-10 h-9'} rounded-xl bg-[#101016] border border-neutral-800/80 flex items-center justify-center`}
          >
            {isOffline ? (
              <WifiOff className="w-4 h-4 text-amber-400" />
            ) : (
              <Wifi className={`w-4 h-4 ${wsConnected ? 'text-emerald-400' : 'text-red-500'}`} />
            )}
          </div>
        </div>
      </aside>

      {/* Main TV Canvas */}
      <main
        className={`flex-1 min-w-0 min-h-0 ${
          screen === 'live'
            ? `${contained ? 'p-2.5 lg:p-3' : 'p-5 lg:p-6'} flex flex-col gap-2 overflow-hidden`
            : `${contained ? 'p-5 lg:p-6' : 'p-8'} overflow-y-auto`
        }`}
      >
        {numericBuffer && (
          <div className={`${contained ? 'absolute top-4 right-4' : 'fixed top-6 right-8'} z-50 bg-[#0b0b0f] border border-red-600 rounded-xl px-6 py-3 shadow-2xl`}>
            <div className="text-xs text-neutral-400">Tuning Channel</div>
            <div className="text-3xl font-mono font-bold text-red-500 tabular-nums">
              {numericBuffer}
            </div>
          </div>
        )}

        {screen === 'live' && (
          <>
            {/* Top Compact Bar: Category Filters + Search + Fullscreen */}
            <div className="flex items-center justify-between gap-3 shrink-0">
              <div className="flex items-center gap-1.5 overflow-x-auto pb-0.5 min-w-0 flex-1">
                <button
                  type="button"
                  onClick={() => {
                    setSelectedCategory('ALL');
                    setLiveVisibleCount(80);
                  }}
                  className={`tv-focusable px-3 py-1.5 rounded-lg text-xs font-medium whitespace-nowrap shrink-0 cursor-pointer transition-colors ${
                    selectedCategory === 'ALL'
                      ? 'bg-red-600 text-white font-semibold'
                      : 'bg-[#0e0e13] border border-neutral-800 text-neutral-300 hover:border-red-800'
                  }`}
                >
                  All ({channels.length})
                </button>
                {(config?.categories ?? []).slice(0, 10).map((cat) => (
                  <button
                    key={cat.id}
                    type="button"
                    onClick={() => {
                      setSelectedCategory(cat.name);
                      setLiveVisibleCount(80);
                    }}
                    className={`tv-focusable px-3 py-1.5 rounded-lg text-xs font-medium whitespace-nowrap shrink-0 cursor-pointer transition-colors ${
                      selectedCategory === cat.name
                        ? 'bg-red-600 text-white font-semibold'
                        : 'bg-[#0e0e13] border border-neutral-800 text-neutral-300 hover:border-red-800'
                    }`}
                  >
                    {cat.name}
                  </button>
                ))}
              </div>

              <div className="flex items-center gap-2 shrink-0">
                <div className="w-40 sm:w-48">
                  <input
                    type="text"
                    placeholder="Find channel..."
                    value={searchQuery}
                    onChange={(e) => {
                      setSearchQuery(e.target.value);
                      setLiveVisibleCount(80);
                    }}
                    className="w-full h-8 px-3 rounded-lg bg-[#0b0b0f] border border-neutral-800 focus:border-red-600 focus:outline-none text-xs text-white placeholder:text-neutral-500"
                  />
                </div>
                <button
                  type="button"
                  onClick={() => setIsFullscreen(true)}
                  className="tv-focusable h-8 px-3 rounded-lg bg-red-600 hover:bg-red-500 text-white text-xs font-semibold whitespace-nowrap shrink-0 cursor-pointer"
                >
                  Fullscreen
                </button>
              </div>
            </div>

            {/* Split Stage: Live TV Player (Left, true 16:9) + TV Guide Panel (Right) */}
            <div className="flex-1 min-h-0 flex flex-col md:flex-row md:[container-type:size] gap-2.5">
              {/* Left: Live TV Video Player */}
              <div className="w-full aspect-video md:aspect-auto md:w-[min(calc(100cqw_-_260px),calc(100cqh*16/9))] md:h-[min(100cqh,calc((100cqw_-_260px)*9/16))] shrink-0 md:self-center">
                {activeChannel ? (
                  <TvVideoPlayer
                    channel={activeChannel}
                    deviceToken={identity?.deviceToken ?? undefined}
                    isFullscreen={false}
                    fillContainer={true}
                    playPauseSignal={playPauseSignal}
                    isFavorite={favorites.includes(activeChannel.id)}
                    showOverlay={true}
                    currentProgram={activeProgPair.current}
                    nextProgram={activeProgPair.next}
                    aspectRatio={aspectRatio}
                    onAspectRatioChange={async (ratio) => {
                      setAspectRatio(ratio);
                      await tvStorage.savePreferences({
                        aspectRatio: ratio,
                        lastPlayedChannelId: activeChannel.id,
                      });
                    }}
                    onToggleFavorite={() => void toggleFavorite(activeChannel.id)}
                    onChannelStep={stepChannel}
                    onCloseFullscreen={() => setIsFullscreen(false)}
                    onToggleOverlay={() => setShowOverlay((v) => !v)}
                    onDiagnostic={(diag) => {
                      if (!identity?.deviceToken) return;
                      void fetch(apiUrl('/api/device/diagnostics'), {
                        method: 'POST',
                        headers: {
                          Authorization: `Bearer ${identity.deviceToken}`,
                          'Content-Type': 'application/json',
                        },
                        body: JSON.stringify(diag),
                      });
                    }}
                  />
                ) : (
                  <div className="w-full h-full rounded-xl bg-[#09090d] border border-red-950/60 flex flex-col items-center justify-center p-6 text-center space-y-3">
                    <p className="text-sm text-neutral-300">
                      Channels are currently being updated by your broadcaster.
                    </p>
                    {identity && (
                      <Button size="sm" onClick={() => void fetchLatestConfig(identity, false)}>
                        <RefreshCw className="w-3.5 h-3.5" />
                        Refresh Channels
                      </Button>
                    )}
                  </div>
                )}
              </div>

              {/* Right: TV Guide (EPG) Panel */}
              <aside className="w-full md:flex-1 md:min-w-[240px] max-h-44 md:max-h-none min-h-0 flex flex-col bg-[#09090d] border border-red-950/60 rounded-xl overflow-hidden">
                <div className="px-3 py-2 border-b border-red-950/50 bg-[#0d0d12] flex items-center justify-between gap-2 shrink-0">
                  <div className="flex items-center gap-2 min-w-0">
                    <Calendar className="w-3.5 h-3.5 text-red-500 shrink-0" />
                    <span className="text-xs font-semibold text-white truncate">TV Guide</span>
                    {activeChannel && (
                      <span className="text-[11px] font-mono text-red-400 tabular-nums shrink-0">
                        CH {activeChannel.channelNumber}
                      </span>
                    )}
                  </div>

                  <div className="flex items-center gap-1 shrink-0">
                    <button
                      type="button"
                      onClick={() => setLiveGuideMode('channel')}
                      className={`tv-focusable px-2 py-0.5 rounded text-[11px] font-medium cursor-pointer transition-colors ${
                        liveGuideMode === 'channel'
                          ? 'bg-red-600 text-white'
                          : 'text-neutral-400 hover:text-white bg-[#14141b]'
                      }`}
                    >
                      Schedule
                    </button>
                    <button
                      type="button"
                      onClick={() => setLiveGuideMode('lineup')}
                      className={`tv-focusable px-2 py-0.5 rounded text-[11px] font-medium cursor-pointer transition-colors ${
                        liveGuideMode === 'lineup'
                          ? 'bg-red-600 text-white'
                          : 'text-neutral-400 hover:text-white bg-[#14141b]'
                      }`}
                    >
                      All Guide
                    </button>
                  </div>
                </div>

                {/* Active Channel Summary */}
                {activeChannel && (
                  <div className="px-3 py-2 border-b border-neutral-900 bg-[#0b0b10] shrink-0">
                    <div className="flex items-center gap-2.5">
                      <img
                        src={activeChannel.logoUrl || '/src/assets/images/tv_channel_cinema_1794571501792.jpg'}
                        alt={activeChannel.name}
                        referrerPolicy="no-referrer"
                        className="w-8 h-8 rounded object-cover bg-black border border-neutral-800 shrink-0"
                      />
                      <div className="min-w-0 flex-1">
                        <div className="text-xs font-semibold text-white truncate">
                          {activeChannel.name}
                        </div>
                        <div className="text-[11px] text-neutral-400 truncate">
                          {activeProgPair.current
                            ? `Now: ${activeProgPair.current.title}`
                            : `${activeChannel.categoryName || activeChannel.groupTitle || 'Live Broadcast'}`}
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={() => setScreen('epg')}
                        className="tv-focusable text-[11px] text-red-400 hover:text-red-300 font-medium whitespace-nowrap cursor-pointer shrink-0"
                      >
                        Full EPG
                      </button>
                    </div>
                  </div>
                )}

                {/* Scrollable Guide Body */}
                <div className="flex-1 min-h-0 overflow-y-auto p-2 space-y-1.5">
                  {liveGuideMode === 'channel' ? (
                    activeChannelSchedule.length > 0 ? (
                      activeChannelSchedule.map((prog, idx) => {
                        const now = Date.now();
                        const startMs = new Date(prog.startTime).getTime();
                        const endMs = new Date(prog.endTime).getTime();
                        const isLiveNow = startMs <= now && endMs > now;
                        const pct = isLiveNow
                          ? Math.min(100, Math.max(0, Math.round(((now - startMs) / Math.max(1, endMs - startMs)) * 100)))
                          : 0;
                        return (
                          <div
                            key={`${prog.title}-${prog.startTime}-${idx}`}
                            className={`p-2.5 rounded-lg border ${
                              isLiveNow
                                ? 'bg-red-950/25 border-red-600/70'
                                : 'bg-[#101016] border-neutral-800/80'
                            }`}
                          >
                            <div className="flex items-center justify-between gap-2 text-[11px] font-mono tabular-nums">
                              <span className={isLiveNow ? 'text-red-400 font-semibold' : 'text-neutral-400'}>
                                {new Date(prog.startTime).toLocaleTimeString([], {
                                  hour: '2-digit',
                                  minute: '2-digit',
                                })}{' '}
                                –{' '}
                                {new Date(prog.endTime).toLocaleTimeString([], {
                                  hour: '2-digit',
                                  minute: '2-digit',
                                })}
                              </span>
                              {isLiveNow && (
                                <span className="text-[10px] font-sans font-semibold text-red-400 uppercase tracking-wider">
                                  On Now
                                </span>
                              )}
                            </div>
                            <div className="text-xs font-semibold text-white mt-0.5 truncate">
                              {prog.title}
                            </div>
                            {prog.description && (
                              <p className="text-[11px] text-neutral-400 mt-1 line-clamp-2">
                                {prog.description}
                              </p>
                            )}
                            {isLiveNow && (
                              <progress
                                value={pct}
                                max={100}
                                className="mt-2 block w-full h-1 rounded-full overflow-hidden [&::-webkit-progress-bar]:bg-neutral-800 [&::-webkit-progress-value]:bg-red-500 [&::-moz-progress-bar]:bg-red-500"
                              />
                            )}
                          </div>
                        );
                      })
                    ) : null
                  ) : (
                    filteredChannels
                      .filter((ch) => Boolean(ch.tvgId && epgByChannelTvgId.has(ch.tvgId)))
                      .slice(0, 40)
                      .map((ch) => {
                        const pair = getProgramPair(ch.tvgId);
                        const isCurrent = activeChannel?.id === ch.id;
                        return (
                          <button
                            key={ch.id}
                            type="button"
                            onClick={() => void selectChannel(ch, false)}
                            className={`tv-focusable w-full text-left p-2 rounded-lg border transition-colors cursor-pointer flex items-center gap-2.5 ${
                              isCurrent
                                ? 'bg-red-600/20 border-red-500'
                                : 'bg-[#101016] border-neutral-800/80 hover:border-red-700/70'
                            }`}
                          >
                            <span className="text-[11px] font-mono text-red-500 tabular-nums w-8 shrink-0">
                              {ch.channelNumber}
                            </span>
                            <div className="min-w-0 flex-1">
                              <div className="text-xs font-semibold text-white truncate">
                                {ch.name}
                              </div>
                              <div className="text-[11px] text-neutral-400 truncate">
                                {pair.current
                                  ? `Now: ${pair.current.title}${pair.next ? ` · Next: ${pair.next.title}` : ''}`
                                  : pair.next
                                  ? `Next: ${pair.next.title}`
                                  : ''}
                              </div>
                            </div>
                          </button>
                        );
                      })
                  )}
                </div>
              </aside>
            </div>

            {/* Bottom Horizontal Multi-Row Channel Grid */}
            <section className="shrink-0 bg-[#09090d] border border-red-950/60 rounded-xl p-2">
              <div className="flex items-center justify-between px-1 mb-1.5">
                <div className="flex items-center gap-2 text-xs">
                  <span className="font-semibold text-white">Channel Lineup</span>
                  <span className="text-neutral-500">·</span>
                  <span className="font-mono text-red-500 tabular-nums">
                    {filteredChannels.length} channels
                  </span>
                </div>
                <span className="text-[11px] text-neutral-500 hidden sm:inline">
                  Scroll horizontally or use D-Pad Left / Right
                </span>
              </div>

              <div className="grid grid-rows-2 grid-flow-col auto-cols-[164px] sm:auto-cols-[180px] gap-1.5 overflow-x-auto pb-0.5">
                {filteredChannels.slice(0, liveVisibleCount).map((ch) => {
                  const selected = activeChannel?.id === ch.id;
                  return (
                    <button
                      key={ch.id}
                      type="button"
                      onClick={() => void selectChannel(ch, false)}
                      className={`tv-focusable flex items-center gap-2 p-1.5 rounded-lg text-left transition-all cursor-pointer border ${
                        selected
                          ? 'bg-red-600/20 border-red-500 text-white shadow-sm shadow-red-950/50'
                          : 'bg-[#101016] border-neutral-800/90 text-neutral-300 hover:border-red-700/70 hover:bg-[#16161f]'
                      }`}
                    >
                      <img
                        src={ch.logoUrl || '/src/assets/images/tv_channel_cinema_1794571501792.jpg'}
                        alt={ch.name}
                        loading="lazy"
                        referrerPolicy="no-referrer"
                        className="w-7 h-7 rounded object-cover bg-black shrink-0 border border-neutral-800"
                      />
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-1.5 text-[11px] font-mono tabular-nums">
                          <span className={selected ? 'text-red-400 font-bold' : 'text-red-500'}>
                            {ch.channelNumber}
                          </span>
                          <span className="text-neutral-600">·</span>
                          <span className="text-neutral-400 truncate">
                            {ch.categoryName || ch.groupTitle || 'Live'}
                          </span>
                        </div>
                        <div className="text-xs font-semibold text-white truncate mt-0.5">
                          {ch.name}
                        </div>
                      </div>
                    </button>
                  );
                })}
                {filteredChannels.length > liveVisibleCount && (
                  <button
                    type="button"
                    onClick={() => setLiveVisibleCount((n) => n + 80)}
                    className="tv-focusable row-span-2 flex flex-col items-center justify-center p-3 rounded-lg bg-[#121218] border border-red-900/60 hover:bg-red-950/30 text-xs font-semibold text-red-400 cursor-pointer text-center"
                  >
                    <span>Load More</span>
                    <span className="text-[11px] text-neutral-400 mt-1 tabular-nums">
                      +{filteredChannels.length - liveVisibleCount} left
                    </span>
                  </button>
                )}
              </div>
            </section>
          </>
        )}

        {screen === 'home' && (
          <TvHomeScreen
            config={config}
            channels={channels}
            activeChannel={activeChannel}
            favorites={favorites}
            historyIds={historyIds}
            epgByChannelTvgId={epgByChannelTvgId}
            getProgramPair={getProgramPair}
            onWatchChannel={(ch, openFs = false) => {
              setScreen('live');
              void selectChannel(ch, openFs);
            }}
            onToggleFavorite={(channelId) => void toggleFavorite(channelId)}
            onOpenFullGuide={() => setScreen('epg')}
            onOpenLiveTv={() => setScreen('live')}
            onRefreshConfig={
              identity ? () => void fetchLatestConfig(identity, false) : undefined
            }
          />
        )}

        {screen === 'categories' && (
          <div className="space-y-6">
            <h1 className="text-2xl font-bold text-white">Channel Categories</h1>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <button
                type="button"
                onClick={() => {
                  setSelectedCategory('ALL');
                  setScreen('live');
                }}
                className="tv-focusable p-6 rounded-xl bg-[#0c0c10] border border-neutral-800 text-left hover:border-red-600/70 cursor-pointer"
              >
                <div className="text-lg font-semibold text-white">All Channels</div>
                <div className="text-xs text-red-500 mt-1 font-mono tabular-nums">
                  {channels.length} channels
                </div>
              </button>
              {(config?.categories ?? []).map((cat) => {
                const count = channels.filter(
                  (c) => (c.categoryName || c.groupTitle) === cat.name
                ).length;
                return (
                  <button
                    key={cat.id}
                    type="button"
                    onClick={() => {
                      setSelectedCategory(cat.name);
                      setScreen('live');
                    }}
                    className="tv-focusable p-6 rounded-xl bg-[#0c0c10] border border-neutral-800 text-left hover:border-red-600/70 cursor-pointer"
                  >
                    <div className="text-lg font-semibold text-white">{cat.name}</div>
                    <div className="text-xs text-red-500 mt-1 font-mono tabular-nums">
                      {count} channels
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {screen === 'favorites' && (
          <div className="space-y-6">
            <h1 className="text-2xl font-bold text-white">Favorite Channels</h1>
            {favorites.length === 0 ? (
              <div className="p-10 rounded-xl bg-[#0c0c10] border border-red-950/60 text-center text-neutral-400">
                No favorites saved yet. Select Fav while watching any channel.
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                {channels
                  .filter((c) => favorites.includes(c.id))
                  .map((ch) => (
                    <button
                      key={ch.id}
                      type="button"
                      onClick={() => {
                        setScreen('live');
                        void selectChannel(ch, false);
                      }}
                      className="tv-focusable p-5 rounded-xl bg-[#0c0c10] border border-neutral-800 text-left hover:border-red-600/70 cursor-pointer"
                    >
                      <div className="text-xs font-mono text-red-500 tabular-nums">
                        CH {ch.channelNumber}
                      </div>
                      <div className="text-base font-semibold text-white mt-1">{ch.name}</div>
                    </button>
                  ))}
              </div>
            )}
          </div>
        )}

        {screen === 'epg' && (
          <div className="space-y-6">
            <h1 className="text-2xl font-bold text-white">Electronic Program Guide</h1>
            <div className="space-y-3">
              {channels.slice(0, epgVisibleCount).map((ch) => {
                const progs = (config?.epgPrograms ?? []).filter(
                  (p) => ch.tvgId && p.channelTvgId === ch.tvgId
                );
                return (
                  <div key={ch.id} className="p-4 rounded-xl bg-[#0c0c10] border border-neutral-800">
                    <div className="flex flex-col md:flex-row md:items-center gap-4">
                      <button
                        type="button"
                        onClick={() => {
                          setScreen('live');
                          void selectChannel(ch, false);
                        }}
                        className="tv-focusable w-56 shrink-0 flex items-center gap-3 text-left p-2 rounded-lg hover:bg-neutral-900 cursor-pointer"
                      >
                        <span className="text-xs font-mono text-red-500 tabular-nums">
                          {ch.channelNumber}
                        </span>
                        <span className="text-sm font-semibold text-white truncate">
                          {ch.name}
                        </span>
                      </button>
                      <div className="flex-1 grid grid-cols-1 md:grid-cols-3 gap-3">
                        {progs.length === 0 ? (
                          <div className="text-xs text-neutral-500 py-2">No schedule data</div>
                        ) : (
                          progs.slice(0, 3).map((p, idx) => (
                            <div
                              key={`${p.title}-${idx}`}
                              className="p-3 rounded-lg bg-[#050507] border border-neutral-800/80"
                            >
                              <div className="text-xs font-mono text-neutral-400 tabular-nums">
                                {new Date(p.startTime).toLocaleTimeString([], {
                                  hour: '2-digit',
                                  minute: '2-digit',
                                })}{' '}
                                -{' '}
                                {new Date(p.endTime).toLocaleTimeString([], {
                                  hour: '2-digit',
                                  minute: '2-digit',
                                })}
                              </div>
                              <div className="text-sm font-medium text-neutral-100 truncate mt-1">
                                {p.title}
                              </div>
                            </div>
                          ))
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
              {channels.length > epgVisibleCount && (
                <button
                  type="button"
                  onClick={() => setEpgVisibleCount((n) => n + 40)}
                  className="px-4 py-2 rounded-lg bg-[#0c0c10] border border-red-900/60 text-xs font-semibold text-red-400 hover:bg-neutral-900 cursor-pointer"
                >
                  Load More Guide Channels ({channels.length - epgVisibleCount} remaining)
                </button>
              )}
            </div>
          </div>
        )}

        {screen === 'search' && (
          <div className="space-y-6">
            <h1 className="text-2xl font-bold text-white">Search Channels</h1>
            <Input
              placeholder="Search by channel name or number..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              {filteredChannels.slice(0, 60).map((ch) => (
                <button
                  key={ch.id}
                  type="button"
                  onClick={() => {
                    setScreen('live');
                    void selectChannel(ch, false);
                  }}
                  className="tv-focusable p-4 rounded-xl bg-[#0c0c10] border border-neutral-800 text-left hover:border-red-600/70 cursor-pointer"
                >
                  <div className="text-xs font-mono text-red-500 tabular-nums">
                    CH {ch.channelNumber}
                  </div>
                  <div className="text-base font-semibold text-white mt-1">{ch.name}</div>
                </button>
              ))}
            </div>
          </div>
        )}

      </main>

      {/* Fullscreen Player Portal */}
      {isFullscreen && activeChannel && (
        <TvVideoPlayer
          channel={activeChannel}
          deviceToken={identity?.deviceToken ?? undefined}
          isFullscreen={true}
          contained={contained}
          playPauseSignal={playPauseSignal}
          isFavorite={favorites.includes(activeChannel.id)}
          showOverlay={showOverlay}
          currentProgram={activeProgPair.current}
          nextProgram={activeProgPair.next}
          aspectRatio={aspectRatio}
          onAspectRatioChange={setAspectRatio}
          onToggleFavorite={() => void toggleFavorite(activeChannel.id)}
          onChannelStep={stepChannel}
          onCloseFullscreen={() => setIsFullscreen(false)}
          onToggleOverlay={() => setShowOverlay((v) => !v)}
          onDiagnostic={(diag) => {
            if (!identity?.deviceToken) return;
            void fetch(apiUrl('/api/device/diagnostics'), {
              method: 'POST',
              headers: {
                Authorization: `Bearer ${identity.deviceToken}`,
                'Content-Type': 'application/json',
              },
              body: JSON.stringify(diag),
            });
          }}
        />
      )}
    </div>
  );
};
