import React, { useEffect, useRef, useState } from 'react';
import {
  ArrowLeft,
  Maximize2,
  Monitor,
} from 'lucide-react';
import { RemoteKeyManager } from './RemoteKeyManager';
import { SmartTvApp } from './SmartTvApp';
import { Button } from '../components/ui/Primitives';

type PlatformTarget = 'android_tv' | 'samsung_tizen' | 'lg_webos';

const PLATFORM_META: Record<
  PlatformTarget,
  { label: string; engine: string; resolution: string }
> = {
  android_tv: {
    label: 'Android TV / Google TV',
    engine: 'Media3 ExoPlayer (HLS + MPEG-TS)',
    resolution: '4K HDR · 60fps',
  },
  samsung_tizen: {
    label: 'Samsung Tizen TV',
    engine: 'Tizen AVPlay Native Pipeline',
    resolution: 'UHD · 60fps',
  },
  lg_webos: {
    label: 'LG webOS TV',
    engine: 'webOS Media / HTML5 MSE',
    resolution: 'OLED 4K · 60fps',
  },
};

export const TvMockupStudio: React.FC<{ onSwitchToAdmin: () => void }> = ({
  onSwitchToAdmin,
}) => {
  const [platform, setPlatform] = useState<PlatformTarget>('android_tv');
  const [viewMode, setViewMode] = useState<'bezel' | 'fullscreen'>('bezel');

  const remoteManagerRef = useRef<RemoteKeyManager>(new RemoteKeyManager());

  useEffect(() => {
    const mgr = remoteManagerRef.current;
    mgr.attach();
    return () => {
      mgr.detach();
    };
  }, []);

  if (viewMode === 'fullscreen') {
    return (
      <div className="relative min-h-screen bg-[#050507]">
        <div className="fixed top-4 right-4 z-50 flex items-center gap-2">
          <Button
            size="sm"
            variant="secondary"
            onClick={() => setViewMode('bezel')}
          >
            <Monitor className="w-3.5 h-3.5 text-red-500" />
            Show TV Mockup
          </Button>
        </div>
        <SmartTvApp
          platformLabel={PLATFORM_META[platform].label}
          externalRemote={remoteManagerRef.current}
        />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#050507] text-neutral-100 flex flex-col">
      {/* Studio Control Header */}
      <header className="min-h-14 px-6 py-2 border-b border-red-950/60 bg-[#0a0a0e] flex flex-wrap items-center justify-between gap-3 shrink-0">
        <div className="flex items-center gap-4 min-w-0">
          <Button size="sm" variant="ghost" onClick={onSwitchToAdmin}>
            <ArrowLeft className="w-4 h-4" />
            Admin Console
          </Button>
          <span className="text-sm font-semibold text-white whitespace-nowrap">
            Smart TV Simulator
          </span>
        </div>

        {/* Platform Target Segmented Control */}
        <div className="flex items-center gap-1 p-1 rounded-lg bg-[#050507] border border-red-950/60 overflow-x-auto">
          {(Object.keys(PLATFORM_META) as PlatformTarget[]).map((key) => (
            <button
              key={key}
              type="button"
              onClick={() => setPlatform(key)}
              className={`px-3 py-1 rounded-md text-xs font-medium transition-colors cursor-pointer whitespace-nowrap ${
                platform === key
                  ? 'bg-red-600 text-white font-semibold'
                  : 'text-neutral-400 hover:text-white'
              }`}
            >
              {PLATFORM_META[key].label}
            </button>
          ))}
        </div>

        <Button size="sm" variant="secondary" onClick={() => setViewMode('fullscreen')}>
          <Maximize2 className="w-3.5 h-3.5 text-red-500" />
          10-Foot Fullscreen
        </Button>
      </header>

      {/* Centered Smart TV Chassis */}
      <div className="flex-1 p-5 lg:p-8 flex flex-col items-center justify-center overflow-y-auto bg-[radial-gradient(circle_at_50%_20%,rgba(127,29,29,0.16),transparent_60%)]">
        {/* 16:9 Smart TV Chassis */}
        <div className="w-full max-w-[1220px] flex flex-col items-center">
          <div className="w-full aspect-video rounded-2xl bg-[#040406] p-2.5 sm:p-3.5 border-2 border-red-950/70 shadow-[0_30px_90px_rgba(0,0,0,0.92)] relative flex flex-col">
            {/* Actual Live Smart TV Viewport */}
            <div className="flex-1 w-full h-full rounded-lg overflow-hidden bg-[#050507] relative">
              <SmartTvApp
                contained={true}
                platformLabel={PLATFORM_META[platform].label}
                externalRemote={remoteManagerRef.current}
              />
            </div>

            {/* Bottom TV Bezel Brand & Crimson Power LED */}
            <div className="h-5 flex items-center justify-between px-4 pt-1.5 text-[10px] text-neutral-500 font-mono">
              <span>{PLATFORM_META[platform].label}</span>
              <span className="tracking-widest uppercase text-red-500/90 font-semibold">VANGUARD CINEMA OLED</span>
              <span>{PLATFORM_META[platform].engine}</span>
            </div>
          </div>

          {/* Metallic TV Stand Neck & Base */}
          <div className="w-24 h-6 bg-gradient-to-b from-neutral-800 to-neutral-900 border-x border-red-950/50" />
          <div className="w-72 h-2.5 rounded-full bg-gradient-to-r from-neutral-900 via-red-950/80 to-neutral-900 shadow-lg" />
        </div>
      </div>
    </div>
  );
};
