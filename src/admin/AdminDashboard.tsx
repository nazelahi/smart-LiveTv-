import React, { useCallback, useEffect, useState } from 'react';
import {
  Activity,
  CalendarClock,
  FolderTree,
  GitBranch,
  History,
  Layers,
  LayoutDashboard,
  ListVideo,
  LogOut,
  Menu,
  MonitorSmartphone,
  RefreshCw,
  Settings,
  ShieldCheck,
  Tv,
  Users,
} from 'lucide-react';
import { toast } from 'sonner';
import { useAuth } from '../context/AuthContext';
import { adminFetch } from './api';
import { Button, StatusText, Surface } from '../components/ui/Primitives';
import { PlaylistsView, type PlaylistRow } from './views/PlaylistsView';
import { ChannelsView } from './views/ChannelsView';
import { EpgView, type EpgChannelRow, type EpgSourceRow } from './views/EpgView';
import { DevicesView, type DeviceRow } from './views/DevicesView';
import {
  AdminUsersView,
  AssignmentsView,
  AuditLogsView,
  CategoriesView,
  DeviceGroupsView,
  DiagnosticsView,
  SettingsView,
  SynchronizationView,
} from './views/OperationsViews';
import type { EffectiveChannel } from '../../packages/core-models/src/index';

type AdminNavId =
  | 'dashboard'
  | 'playlists'
  | 'channels'
  | 'categories'
  | 'epg'
  | 'devices'
  | 'groups'
  | 'assignments'
  | 'sync'
  | 'diagnostics'
  | 'users'
  | 'audit'
  | 'settings';

interface OverviewResponse {
  admin: { email: string; displayName: string; role: string };
  stats: {
    totalDevices: number;
    onlineDevices: number;
    offlineDevices: number;
    pendingDevices: number;
    totalPlaylists: number;
    activePlaylists: number;
    totalChannels: number;
    lastSyncAt: string | null;
  };
  recentSyncs: Array<{
    id: string;
    deviceId: string | null;
    eventType: string;
    playlistVersion: number;
    status: string;
    createdAt: string;
  }>;
  recentAuditLogs: Array<{
    id: string;
    actorEmail: string | null;
    action: string;
    resourceType: string;
    createdAt: string;
  }>;
}

export const AdminDashboard: React.FC<{ onLaunchTv?: () => void }> = ({ onLaunchTv }) => {
  const { user, logout } = useAuth();
  const [nav, setNav] = useState<AdminNavId>('dashboard');
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [overview, setOverview] = useState<OverviewResponse | null>(null);
  const [playlists, setPlaylists] = useState<PlaylistRow[]>([]);
  const [channels, setChannels] = useState<EffectiveChannel[]>([]);
  const [categories, setCategories] = useState<any[]>([]);
  const [epgSources, setEpgSources] = useState<EpgSourceRow[]>([]);
  const [epgChannels, setEpgChannels] = useState<EpgChannelRow[]>([]);
  const [epgPrograms, setEpgPrograms] = useState<any[]>([]);
  const [devices, setDevices] = useState<DeviceRow[]>([]);
  const [groups, setGroups] = useState<any[]>([]);
  const [assignments, setAssignments] = useState<any[]>([]);
  const [syncEvents, setSyncEvents] = useState<any[]>([]);
  const [diagnostics, setDiagnostics] = useState<any[]>([]);
  const [adminUsers, setAdminUsers] = useState<any[]>([]);
  const [auditLogs, setAuditLogs] = useState<any[]>([]);
  const [settings, setSettings] = useState<any[]>([]);

  const loadAllData = useCallback(async () => {
    setError(null);
    try {
      const [
        ov,
        pl,
        ch,
        cat,
        es,
        ec,
        ep,
        dev,
        grp,
        asg,
        syn,
        diag,
        usr,
        aud,
        setts,
      ] = await Promise.all([
        adminFetch<OverviewResponse>('/api/admin/overview'),
        adminFetch<PlaylistRow[]>('/api/admin/playlists'),
        adminFetch<EffectiveChannel[]>('/api/admin/channels'),
        adminFetch<any[]>('/api/admin/categories'),
        adminFetch<EpgSourceRow[]>('/api/admin/epg/sources'),
        adminFetch<EpgChannelRow[]>('/api/admin/epg/channels'),
        adminFetch<any[]>('/api/admin/epg/programs'),
        adminFetch<DeviceRow[]>('/api/admin/devices'),
        adminFetch<any[]>('/api/admin/device-groups'),
        adminFetch<any[]>('/api/admin/assignments'),
        adminFetch<any[]>('/api/admin/sync-events'),
        adminFetch<any[]>('/api/admin/diagnostics'),
        adminFetch<any[]>('/api/admin/users'),
        adminFetch<any[]>('/api/admin/audit-logs'),
        adminFetch<any[]>('/api/admin/settings'),
      ]);

      setOverview(ov);
      setPlaylists(pl);
      setChannels(ch);
      setCategories(cat);
      setEpgSources(es);
      setEpgChannels(ec);
      setEpgPrograms(ep);
      setDevices(dev);
      setGroups(grp);
      setAssignments(asg);
      setSyncEvents(syn);
      setDiagnostics(diag);
      setAdminUsers(usr);
      setAuditLogs(aud);
      setSettings(setts);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to load admin console data';
      setError(msg);
      toast.error(msg);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadAllData();
  }, [loadAllData]);

  const navItems: Array<{ id: AdminNavId; label: string; icon: React.ReactNode }> = [
    { id: 'dashboard', label: 'Dashboard', icon: <LayoutDashboard className="w-4 h-4" /> },
    { id: 'playlists', label: 'Playlists', icon: <ListVideo className="w-4 h-4" /> },
    { id: 'channels', label: 'Channels', icon: <Tv className="w-4 h-4" /> },
    { id: 'categories', label: 'Categories', icon: <FolderTree className="w-4 h-4" /> },
    { id: 'epg', label: 'EPG Management', icon: <CalendarClock className="w-4 h-4" /> },
    { id: 'devices', label: 'Devices', icon: <MonitorSmartphone className="w-4 h-4" /> },
    { id: 'groups', label: 'Device Groups', icon: <Layers className="w-4 h-4" /> },
    { id: 'assignments', label: 'Playlist Assignments', icon: <GitBranch className="w-4 h-4" /> },
    { id: 'sync', label: 'Synchronization', icon: <RefreshCw className="w-4 h-4" /> },
    { id: 'diagnostics', label: 'Playback Diagnostics', icon: <Activity className="w-4 h-4" /> },
    { id: 'users', label: 'Admin Users', icon: <Users className="w-4 h-4" /> },
    { id: 'audit', label: 'Audit Logs', icon: <History className="w-4 h-4" /> },
    { id: 'settings', label: 'Settings', icon: <Settings className="w-4 h-4" /> },
  ];

  const activeLabel = navItems.find((n) => n.id === nav)?.label || 'Dashboard';

  return (
    <div className="min-h-screen bg-[#090c10] text-slate-100 flex">
      {/* Sidebar */}
      <aside
        className={`fixed inset-y-0 left-0 z-40 w-64 bg-[#0d1117] border-r border-slate-800/80 flex flex-col justify-between transition-transform lg:static lg:translate-x-0 ${
          mobileMenuOpen ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
        <div className="p-4 overflow-y-auto">
          <div className="px-2 py-2 mb-5">
            <div className="text-base font-bold tracking-tight text-white">
              Vanguard IPTV
            </div>
            <div className="text-xs text-slate-400 mt-0.5">Remote Fleet Administration</div>
          </div>

          <nav className="space-y-0.5">
            {navItems.map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => {
                  setNav(item.id);
                  setMobileMenuOpen(false);
                }}
                className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm transition-colors cursor-pointer ${
                  nav === item.id
                    ? 'bg-sky-500/15 text-sky-400 font-medium'
                    : 'text-slate-400 hover:text-slate-100 hover:bg-slate-800/50'
                }`}
              >
                {item.icon}
                <span className="truncate">{item.label}</span>
              </button>
            ))}
          </nav>
        </div>

        <div className="p-4 border-t border-slate-800/80 space-y-3">
          <div className="flex items-center gap-3 px-1">
            <img
              src={user?.photoURL || '/src/assets/images/admin_avatar_lead_1794571502300.jpg'}
              alt="Admin profile"
              referrerPolicy="no-referrer"
              className="w-8 h-8 rounded-full object-cover bg-slate-800 shrink-0"
            />
            <div className="min-w-0 flex-1">
              <div className="text-xs font-medium text-white truncate">
                {overview?.admin.displayName || user?.displayName || user?.email}
              </div>
              <div className="text-xs text-slate-500 truncate">
                {overview?.admin.role || 'admin'}
              </div>
            </div>
          </div>
          <Button
            variant="ghost"
            size="sm"
            className="w-full justify-start"
            onClick={() => void logout()}
          >
            <LogOut className="w-3.5 h-3.5" />
            Sign Out
          </Button>
        </div>
      </aside>

      {/* Main Content Area */}
      <div className="flex-1 min-w-0 flex flex-col">
        <header className="h-16 px-6 border-b border-slate-800/80 bg-[#0d1117]/80 flex items-center justify-between gap-4 shrink-0">
          <div className="flex items-center gap-3 min-w-0">
            <button
              type="button"
              onClick={() => setMobileMenuOpen((v) => !v)}
              className="lg:hidden p-2 rounded-lg text-slate-300 hover:bg-slate-800 cursor-pointer"
            >
              <Menu className="w-5 h-5" />
            </button>
            <div className="text-sm text-slate-400 truncate">
              <span>Admin Console</span>
              <span className="mx-2">/</span>
              <span className="text-white font-medium">{activeLabel}</span>
            </div>
          </div>

          <div className="flex items-center gap-3 shrink-0">
            <Button variant="secondary" size="sm" onClick={() => void loadAllData()}>
              <RefreshCw className="w-3.5 h-3.5" />
              Refresh
            </Button>
            {onLaunchTv && (
              <Button size="sm" onClick={onLaunchTv}>
                <Tv className="w-3.5 h-3.5" />
                Launch TV Simulator
              </Button>
            )}
          </div>
        </header>

        <main className="flex-1 p-6 lg:p-8 overflow-y-auto">
          {loading ? (
            <div className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                {[1, 2, 3, 4].map((i) => (
                  <div
                    key={i}
                    className="h-28 rounded-xl bg-[#10151d] border border-slate-800 animate-pulse"
                  />
                ))}
              </div>
              <div className="h-64 rounded-xl bg-[#10151d] border border-slate-800 animate-pulse" />
            </div>
          ) : error ? (
            <Surface className="p-8 text-center">
              <ShieldCheck className="w-8 h-8 text-rose-400 mx-auto mb-2" />
              <p className="text-sm text-rose-300">{error}</p>
              <Button className="mt-4" onClick={() => void loadAllData()}>
                Retry
              </Button>
            </Surface>
          ) : (
            <>
              {nav === 'dashboard' && overview && (
                <div className="space-y-6">
                  <div>
                    <h1 className="text-2xl font-bold text-white">Operations Overview</h1>
                    <p className="text-xs text-slate-400 mt-1">
                      Fleet status, remote playlist versions, and recent synchronization activity.
                    </p>
                  </div>

                  {/* 4-Column KPI Strip */}
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                    <Surface className="p-5">
                      <div className="text-xs text-slate-400">Registered Smart TVs</div>
                      <div className="text-3xl font-bold font-mono tabular-nums text-white mt-2">
                        {overview.stats.totalDevices}
                      </div>
                      <div className="text-xs text-slate-400 mt-2">
                        {overview.stats.onlineDevices} online · {overview.stats.offlineDevices} offline
                      </div>
                    </Surface>

                    <Surface className="p-5">
                      <div className="text-xs text-slate-400">Managed Playlists</div>
                      <div className="text-3xl font-bold font-mono tabular-nums text-white mt-2">
                        {overview.stats.totalPlaylists}
                      </div>
                      <div className="text-xs text-slate-400 mt-2">
                        {overview.stats.activePlaylists} active distributions
                      </div>
                    </Surface>

                    <Surface className="p-5">
                      <div className="text-xs text-slate-400">Imported Channels</div>
                      <div className="text-3xl font-bold font-mono tabular-nums text-white mt-2">
                        {overview.stats.totalChannels}
                      </div>
                      <div className="text-xs text-slate-400 mt-2">
                        Across {categories.length} categories
                      </div>
                    </Surface>

                    <Surface className="p-5">
                      <div className="text-xs text-slate-400">Last Synchronization</div>
                      <div className="text-lg font-semibold font-mono tabular-nums text-sky-400 mt-3">
                        {overview.stats.lastSyncAt
                          ? new Date(overview.stats.lastSyncAt).toLocaleTimeString()
                          : 'No syncs yet'}
                      </div>
                      <div className="text-xs text-slate-400 mt-2">
                        {overview.stats.pendingDevices} pending pairing
                      </div>
                    </Surface>
                  </div>

                  {/* Recent Activities & Syncs */}
                  <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                    <Surface className="p-5 space-y-4">
                      <div className="flex items-center justify-between">
                        <h3 className="text-base font-semibold text-white">
                          Recent Administrative Activity
                        </h3>
                        <button
                          type="button"
                          onClick={() => setNav('audit')}
                          className="text-xs text-sky-400 hover:underline cursor-pointer"
                        >
                          View All
                        </button>
                      </div>
                      <div className="divide-y divide-slate-800/70">
                        {overview.recentAuditLogs.map((log) => (
                          <div
                            key={log.id}
                            className="py-2.5 flex items-center justify-between gap-4 text-xs"
                          >
                            <div className="min-w-0">
                              <span className="font-mono text-sky-400">{log.action}</span>
                              <span className="text-slate-400 ml-2">
                                {log.actorEmail || 'system'}
                              </span>
                            </div>
                            <span className="text-slate-500 font-mono tabular-nums shrink-0">
                              {new Date(log.createdAt).toLocaleTimeString()}
                            </span>
                          </div>
                        ))}
                      </div>
                    </Surface>

                    <Surface className="p-5 space-y-4">
                      <div className="flex items-center justify-between">
                        <h3 className="text-base font-semibold text-white">
                          Recent Device Sync Events
                        </h3>
                        <button
                          type="button"
                          onClick={() => setNav('sync')}
                          className="text-xs text-sky-400 hover:underline cursor-pointer"
                        >
                          Sync Queue
                        </button>
                      </div>
                      {overview.recentSyncs.length === 0 ? (
                        <p className="text-xs text-slate-400 py-6 text-center">
                          No sync events dispatched yet. Pair a TV or publish a playlist update.
                        </p>
                      ) : (
                        <div className="divide-y divide-slate-800/70">
                          {overview.recentSyncs.map((s) => (
                            <div
                              key={s.id}
                              className="py-2.5 flex items-center justify-between gap-4 text-xs"
                            >
                              <div className="font-mono text-slate-200">
                                {s.eventType} · v{s.playlistVersion}
                              </div>
                              <StatusText
                                tone={
                                  s.status === 'acknowledged'
                                    ? 'ok'
                                    : s.status === 'failed'
                                      ? 'error'
                                      : 'warn'
                                }
                                label={s.status}
                              />
                            </div>
                          ))}
                        </div>
                      )}
                    </Surface>
                  </div>
                </div>
              )}

              {nav === 'playlists' && (
                <PlaylistsView
                  playlists={playlists}
                  epgSources={epgSources}
                  onReload={loadAllData}
                />
              )}

              {nav === 'channels' && (
                <ChannelsView
                  channels={channels}
                  playlists={playlists}
                  categories={categories}
                  onReload={loadAllData}
                />
              )}

              {nav === 'categories' && (
                <CategoriesView categories={categories} onReload={loadAllData} />
              )}

              {nav === 'epg' && (
                <EpgView
                  sources={epgSources}
                  epgChannels={epgChannels}
                  programs={epgPrograms}
                  channels={channels}
                  onReload={loadAllData}
                />
              )}

              {nav === 'devices' && (
                <DevicesView
                  devices={devices}
                  groups={groups}
                  playlists={playlists}
                  onReload={loadAllData}
                />
              )}

              {nav === 'groups' && (
                <DeviceGroupsView groups={groups} onReload={loadAllData} />
              )}

              {nav === 'assignments' && (
                <AssignmentsView
                  assignments={assignments}
                  playlists={playlists}
                  devices={devices}
                  groups={groups}
                  onReload={loadAllData}
                />
              )}

              {nav === 'sync' && (
                <SynchronizationView syncEvents={syncEvents} devices={devices} />
              )}

              {nav === 'diagnostics' && (
                <DiagnosticsView diagnostics={diagnostics} devices={devices} />
              )}

              {nav === 'users' && (
                <AdminUsersView users={adminUsers} onReload={loadAllData} />
              )}

              {nav === 'audit' && <AuditLogsView logs={auditLogs} />}

              {nav === 'settings' && (
                <SettingsView settings={settings} onReload={loadAllData} />
              )}
            </>
          )}
        </main>
      </div>
    </div>
  );
};
