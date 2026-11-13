import React, { useEffect, useState } from 'react';
import { Toaster, toast } from 'sonner';
import { ShieldCheck } from 'lucide-react';
import { AuthProvider, useAuth } from './context/AuthContext';
import { AdminDashboard } from './admin/AdminDashboard';
import { SmartTvApp } from './tv/SmartTvApp';
import { TvMockupStudio } from './tv/TvMockupStudio';
import { Button, Surface } from './components/ui/Primitives';

type AppRouteMode = 'tv' | 'admin' | 'simulator';

const BUILD_APP_MODE = (import.meta.env.VITE_APP_MODE || 'auto') as 'auto' | 'tv' | 'admin';

function resolveRouteMode(): AppRouteMode {
  if (BUILD_APP_MODE === 'tv') return 'tv';
  if (BUILD_APP_MODE === 'admin') return 'admin';

  const path = window.location.pathname.toLowerCase();
  const hash = window.location.hash.toLowerCase();
  const search = window.location.search.toLowerCase();

  if (path.startsWith('/admin') || hash.startsWith('#/admin') || search.includes('mode=admin')) {
    return 'admin';
  }
  if (path.startsWith('/simulator') || hash.startsWith('#/simulator') || search.includes('mode=simulator')) {
    return 'simulator';
  }
  return 'tv';
}

function AdminOnlyPortal({ onLaunchSimulator }: { onLaunchSimulator?: () => void }) {
  const { user, loading, signInWithGoogle } = useAuth();
  const [signingIn, setSigningIn] = useState(false);

  if (loading) {
    return (
      <div className="min-h-screen bg-[#090c10] text-slate-300 flex items-center justify-center">
        <div className="text-sm font-mono">Initializing administrator session...</div>
      </div>
    );
  }

  if (!user) {
    return (
      <div className="min-h-screen bg-[#090c10] text-slate-100 flex flex-col items-center justify-center p-6">
        <Surface className="w-full max-w-md p-8 text-center space-y-5">
          <div className="w-12 h-12 rounded-2xl bg-sky-500/15 border border-sky-500/30 flex items-center justify-center mx-auto">
            <ShieldCheck className="w-6 h-6 text-sky-400" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-white tracking-tight">
              Vanguard IPTV Administration
            </h1>
            <p className="text-xs text-slate-400 mt-1.5 leading-relaxed">
              Restricted control console for managing playlists, channels, EPG schedules, and connected televisions.
            </p>
          </div>
          <Button
            size="lg"
            className="w-full"
            disabled={signingIn}
            onClick={async () => {
              setSigningIn(true);
              try {
                await signInWithGoogle();
              } catch (err) {
                toast.error(err instanceof Error ? err.message : 'Google Sign-In failed');
              } finally {
                setSigningIn(false);
              }
            }}
          >
            <ShieldCheck className="w-4 h-4" />
            {signingIn ? 'Signing In...' : 'Sign In as Administrator'}
          </Button>
        </Surface>
      </div>
    );
  }

  return <AdminDashboard onLaunchTv={onLaunchSimulator} />;
}

function RootRouter() {
  const [mode, setMode] = useState<AppRouteMode>(resolveRouteMode);

  useEffect(() => {
    const syncRoute = () => setMode(resolveRouteMode());
    window.addEventListener('hashchange', syncRoute);
    window.addEventListener('popstate', syncRoute);
    return () => {
      window.removeEventListener('hashchange', syncRoute);
      window.removeEventListener('popstate', syncRoute);
    };
  }, []);

  // Dedicated standalone Admin Panel build (VITE_APP_MODE=admin)
  if (BUILD_APP_MODE === 'admin') {
    return <AdminOnlyPortal />;
  }

  // Dedicated standalone TV build (VITE_APP_MODE=tv)
  if (BUILD_APP_MODE === 'tv' || mode === 'tv') {
    return <SmartTvApp />;
  }

  // Admin-accessible TV bezel simulator preview (#/simulator or /simulator)
  if (mode === 'simulator') {
    return (
      <TvMockupStudio
        onSwitchToAdmin={() => {
          window.location.hash = '#/admin';
          setMode('admin');
        }}
      />
    );
  }

  // Admin Panel (/admin or #/admin)
  return (
    <AdminOnlyPortal
      onLaunchSimulator={() => {
        window.location.hash = '#/simulator';
        setMode('simulator');
      }}
    />
  );
}

export default function App() {
  return (
    <AuthProvider>
      <Toaster theme="dark" position="top-right" richColors />
      <RootRouter />
    </AuthProvider>
  );
}
