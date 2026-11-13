import React, { useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { adminFetch } from '../api';
import { Button, Input, Select, StatusText, Surface } from '../../components/ui/Primitives';
import type { PlaylistRow } from './PlaylistsView';
import type { DeviceRow } from './DevicesView';

export const CategoriesView: React.FC<{
  categories: Array<{ id: string; name: string; slug: string; sortOrder: number; isHidden: boolean }>;
  onReload: () => Promise<void>;
}> = ({ categories, onReload }) => {
  const [name, setName] = useState('');
  const [sortOrder, setSortOrder] = useState(1);

  return (
    <div className="space-y-6">
      <h2 className="text-xl font-bold text-white">Channel Categories</h2>
      <Surface className="p-4">
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            await adminFetch('/api/admin/categories', {
              method: 'POST',
              body: JSON.stringify({ name, sortOrder }),
            });
            setName('');
            toast.success('Category added');
            await onReload();
          }}
          className="flex flex-wrap items-end gap-3"
        >
          <div className="flex-1 min-w-[200px]">
            <label className="block text-xs text-slate-400 mb-1">Category Name</label>
            <Input required value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div className="w-28">
            <label className="block text-xs text-slate-400 mb-1">Order</label>
            <Input
              type="number"
              value={sortOrder}
              onChange={(e) => setSortOrder(Number(e.target.value))}
            />
          </div>
          <Button type="submit">
            <Plus className="w-4 h-4" />
            Add Category
          </Button>
        </form>
      </Surface>

      <Surface className="overflow-x-auto">
        <table className="w-full text-left border-collapse">
          <thead>
            <tr className="border-b border-slate-800 text-xs text-slate-400">
              <th className="py-3 px-4">Order</th>
              <th className="py-3 px-4">Name</th>
              <th className="py-3 px-4">Slug</th>
              <th className="py-3 px-4">Visibility</th>
              <th className="py-3 px-4 text-right">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-800/70 text-sm">
            {categories.map((c) => (
              <tr key={c.id}>
                <td className="py-3 px-4 font-mono tabular-nums">{c.sortOrder}</td>
                <td className="py-3 px-4 font-medium text-white">{c.name}</td>
                <td className="py-3 px-4 font-mono text-xs text-slate-400">{c.slug}</td>
                <td className="py-3 px-4">
                  <button
                    type="button"
                    className="cursor-pointer"
                    onClick={async () => {
                      await adminFetch(`/api/admin/categories/${c.id}`, {
                        method: 'PATCH',
                        body: JSON.stringify({ isHidden: !c.isHidden }),
                      });
                      await onReload();
                    }}
                  >
                    <StatusText tone={c.isHidden ? 'warn' : 'ok'} label={c.isHidden ? 'Hidden' : 'Visible'} />
                  </button>
                </td>
                <td className="py-3 px-4 text-right">
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={async () => {
                      await adminFetch(`/api/admin/categories/${c.id}`, { method: 'DELETE' });
                      toast.success('Category deleted');
                      await onReload();
                    }}
                  >
                    <Trash2 className="w-3.5 h-3.5 text-rose-400" />
                  </Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Surface>
    </div>
  );
};

export const DeviceGroupsView: React.FC<{
  groups: Array<{ id: string; name: string; description: string | null }>;
  onReload: () => Promise<void>;
}> = ({ groups, onReload }) => {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');

  return (
    <div className="space-y-6">
      <h2 className="text-xl font-bold text-white">Device Groups</h2>
      <Surface className="p-4">
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            await adminFetch('/api/admin/device-groups', {
              method: 'POST',
              body: JSON.stringify({ name, description }),
            });
            setName('');
            setDescription('');
            toast.success('Device group created');
            await onReload();
          }}
          className="flex flex-wrap items-end gap-3"
        >
          <div className="w-64">
            <label className="block text-xs text-slate-400 mb-1">Group Name</label>
            <Input required value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div className="flex-1 min-w-[200px]">
            <label className="block text-xs text-slate-400 mb-1">Description</label>
            <Input value={description} onChange={(e) => setDescription(e.target.value)} />
          </div>
          <Button type="submit">Create Group</Button>
        </form>
      </Surface>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {groups.map((g) => (
          <Surface key={g.id} className="p-5 flex items-start justify-between gap-3">
            <div>
              <div className="font-semibold text-white">{g.name}</div>
              <div className="text-xs text-slate-400 mt-1">{g.description || 'No description'}</div>
            </div>
            <Button
              size="sm"
              variant="ghost"
              onClick={async () => {
                await adminFetch(`/api/admin/device-groups/${g.id}`, { method: 'DELETE' });
                toast.success('Group deleted');
                await onReload();
              }}
            >
              <Trash2 className="w-3.5 h-3.5 text-rose-400" />
            </Button>
          </Surface>
        ))}
      </div>
    </div>
  );
};

export const AssignmentsView: React.FC<{
  assignments: Array<{
    id: string;
    playlistId: string;
    deviceId: string | null;
    deviceGroupId: string | null;
    assignmentMode: string;
    createdAt: string;
  }>;
  playlists: PlaylistRow[];
  devices: DeviceRow[];
  groups: Array<{ id: string; name: string }>;
  onReload: () => Promise<void>;
}> = ({ assignments, playlists, devices, groups, onReload }) => {
  const [playlistId, setPlaylistId] = useState(playlists[0]?.id || '');
  const [mode, setMode] = useState<'central' | 'individual' | 'multi'>('central');
  const [deviceId, setDeviceId] = useState('');
  const [groupId, setGroupId] = useState('');

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-bold text-white">Playlist Assignments</h2>
        <p className="text-xs text-slate-400 mt-1">
          Distribute central playlists globally, target device groups, or assign multiple playlists per TV.
        </p>
      </div>

      <Surface className="p-5">
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            await adminFetch('/api/admin/assignments', {
              method: 'POST',
              body: JSON.stringify({
                playlistId: playlistId || playlists[0]?.id,
                assignmentMode: mode,
                deviceId: mode === 'central' ? null : deviceId || null,
                deviceGroupId: mode === 'central' ? groupId || null : null,
              }),
            });
            toast.success('Assignment saved & synchronization triggered');
            await onReload();
          }}
          className="grid grid-cols-1 md:grid-cols-4 gap-3 items-end"
        >
          <div>
            <label className="block text-xs text-slate-400 mb-1">Playlist</label>
            <Select
              value={playlistId || playlists[0]?.id || ''}
              onChange={(e) => setPlaylistId(e.target.value)}
            >
              {playlists.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </Select>
          </div>
          <div>
            <label className="block text-xs text-slate-400 mb-1">Mode</label>
            <Select value={mode} onChange={(e) => setMode(e.target.value as any)}>
              <option value="central">Central (All TVs / Group)</option>
              <option value="individual">Individual TV</option>
              <option value="multi">Multi-Playlist on TV</option>
            </Select>
          </div>
          <div>
            <label className="block text-xs text-slate-400 mb-1">
              {mode === 'central' ? 'Target Group (optional)' : 'Target TV'}
            </label>
            {mode === 'central' ? (
              <Select value={groupId} onChange={(e) => setGroupId(e.target.value)}>
                <option value="">All Registered TVs</option>
                {groups.map((g) => (
                  <option key={g.id} value={g.id}>
                    {g.name}
                  </option>
                ))}
              </Select>
            ) : (
              <Select required value={deviceId} onChange={(e) => setDeviceId(e.target.value)}>
                <option value="">Select TV...</option>
                {devices.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.deviceName}
                  </option>
                ))}
              </Select>
            )}
          </div>
          <Button type="submit">Assign &amp; Sync</Button>
        </form>
      </Surface>

      <Surface className="overflow-x-auto">
        <table className="w-full text-left border-collapse">
          <thead>
            <tr className="border-b border-slate-800 text-xs text-slate-400">
              <th className="py-3 px-4">Playlist</th>
              <th className="py-3 px-4">Mode</th>
              <th className="py-3 px-4">Target</th>
              <th className="py-3 px-4 text-right">Remove</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-800/70 text-sm">
            {assignments.map((a) => {
              const pl = playlists.find((p) => p.id === a.playlistId);
              const dev = devices.find((d) => d.id === a.deviceId);
              const grp = groups.find((g) => g.id === a.deviceGroupId);
              return (
                <tr key={a.id}>
                  <td className="py-3 px-4 font-medium text-white">{pl?.name || a.playlistId}</td>
                  <td className="py-3 px-4 capitalize text-xs text-sky-400">{a.assignmentMode}</td>
                  <td className="py-3 px-4 text-xs text-slate-300">
                    {dev?.deviceName || grp?.name || 'All Registered TVs'}
                  </td>
                  <td className="py-3 px-4 text-right">
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={async () => {
                        await adminFetch(`/api/admin/assignments/${a.id}`, { method: 'DELETE' });
                        toast.success('Assignment removed');
                        await onReload();
                      }}
                    >
                      <Trash2 className="w-3.5 h-3.5 text-rose-400" />
                    </Button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </Surface>
    </div>
  );
};

export const SynchronizationView: React.FC<{
  syncEvents: Array<{
    id: string;
    deviceId: string | null;
    eventType: string;
    playlistVersion: number;
    status: string;
    createdAt: string;
    acknowledgedAt: string | null;
  }>;
  devices: DeviceRow[];
}> = ({ syncEvents, devices }) => (
  <div className="space-y-6">
    <h2 className="text-xl font-bold text-white">Remote Synchronization Queue</h2>
    <Surface className="overflow-x-auto">
      <table className="w-full text-left border-collapse">
        <thead>
          <tr className="border-b border-slate-800 text-xs text-slate-400">
            <th className="py-3 px-4">Device</th>
            <th className="py-3 px-4">Event Type</th>
            <th className="py-3 px-4 text-right">Version</th>
            <th className="py-3 px-4">Status</th>
            <th className="py-3 px-4">Created</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-800/70 text-sm">
          {syncEvents.map((ev) => {
            const dev = devices.find((d) => d.id === ev.deviceId);
            return (
              <tr key={ev.id}>
                <td className="py-3 px-4 text-white">{dev?.deviceName || ev.deviceId || 'Broadcast'}</td>
                <td className="py-3 px-4 font-mono text-xs text-slate-300">{ev.eventType}</td>
                <td className="py-3 px-4 text-right font-mono tabular-nums">v{ev.playlistVersion}</td>
                <td className="py-3 px-4">
                  <StatusText
                    tone={ev.status === 'acknowledged' ? 'ok' : ev.status === 'failed' ? 'error' : 'warn'}
                    label={ev.status}
                  />
                </td>
                <td className="py-3 px-4 text-xs font-mono text-slate-400">
                  {new Date(ev.createdAt).toLocaleString()}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </Surface>
  </div>
);

export const DiagnosticsView: React.FC<{
  diagnostics: Array<{
    id: string;
    deviceId: string;
    streamFormat: string;
    status: string;
    latencyMs: number | null;
    bitrateKbps: number | null;
    errorCode: string | null;
    errorMessage: string | null;
    createdAt: string;
  }>;
  devices: DeviceRow[];
}> = ({ diagnostics, devices }) => (
  <div className="space-y-6">
    <h2 className="text-xl font-bold text-white">Playback Diagnostics</h2>
    <Surface className="overflow-x-auto">
      <table className="w-full text-left border-collapse">
        <thead>
          <tr className="border-b border-slate-800 text-xs text-slate-400">
            <th className="py-3 px-4">Device</th>
            <th className="py-3 px-4">Format</th>
            <th className="py-3 px-4">Status</th>
            <th className="py-3 px-4 text-right">Startup Latency</th>
            <th className="py-3 px-4 text-right">Bitrate</th>
            <th className="py-3 px-4">Details</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-800/70 text-sm">
          {diagnostics.length === 0 ? (
            <tr>
              <td colSpan={6} className="py-8 text-center text-slate-400 text-xs">
                No playback telemetry reported yet. Tune a channel on a paired TV to record live metrics.
              </td>
            </tr>
          ) : (
            diagnostics.map((d) => {
              const dev = devices.find((x) => x.id === d.deviceId);
              return (
                <tr key={d.id}>
                  <td className="py-3 px-4 text-white">{dev?.deviceName || d.deviceId}</td>
                  <td className="py-3 px-4 font-mono text-xs uppercase">{d.streamFormat}</td>
                  <td className="py-3 px-4">
                    <StatusText tone={d.status === 'ok' ? 'ok' : 'error'} label={d.status} />
                  </td>
                  <td className="py-3 px-4 text-right font-mono tabular-nums">{d.latencyMs || 0} ms</td>
                  <td className="py-3 px-4 text-right font-mono tabular-nums">{d.bitrateKbps || 0} kbps</td>
                  <td className="py-3 px-4 text-xs text-slate-400">{d.errorMessage || 'Nominal'}</td>
                </tr>
              );
            })
          )}
        </tbody>
      </table>
    </Surface>
  </div>
);

export const AdminUsersView: React.FC<{
  users: Array<{
    id: string;
    email: string;
    displayName: string | null;
    role: string;
    isActive: boolean;
    lastLoginAt: string | null;
  }>;
  onReload: () => Promise<void>;
}> = ({ users, onReload }) => {
  const [email, setEmail] = useState('');
  const [role, setRole] = useState('operator');

  return (
    <div className="space-y-6">
      <h2 className="text-xl font-bold text-white">Administrators &amp; Roles</h2>
      <Surface className="p-4">
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            try {
              await adminFetch('/api/admin/users', {
                method: 'POST',
                body: JSON.stringify({ email, role }),
              });
              setEmail('');
              toast.success('Administrator invited');
              await onReload();
            } catch (err) {
              toast.error(err instanceof Error ? err.message : 'Invite failed');
            }
          }}
          className="flex flex-wrap items-end gap-3"
        >
          <div className="flex-1 min-w-[220px]">
            <label className="block text-xs text-slate-400 mb-1">Google Account Email</label>
            <Input
              type="email"
              required
              placeholder="operator@company.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </div>
          <div className="w-44">
            <label className="block text-xs text-slate-400 mb-1">Role</label>
            <Select value={role} onChange={(e) => setRole(e.target.value)}>
              <option value="super_admin">Super Admin</option>
              <option value="admin">Admin</option>
              <option value="operator">Operator</option>
              <option value="viewer">Viewer</option>
            </Select>
          </div>
          <Button type="submit">Invite User</Button>
        </form>
      </Surface>

      <Surface className="overflow-x-auto">
        <table className="w-full text-left border-collapse">
          <thead>
            <tr className="border-b border-slate-800 text-xs text-slate-400">
              <th className="py-3 px-4">Administrator</th>
              <th className="py-3 px-4">Role</th>
              <th className="py-3 px-4">Status</th>
              <th className="py-3 px-4">Last Login</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-800/70 text-sm">
            {users.map((u) => (
              <tr key={u.id}>
                <td className="py-3 px-4">
                  <div className="font-medium text-white">{u.displayName || u.email}</div>
                  <div className="text-xs text-slate-400">{u.email}</div>
                </td>
                <td className="py-3 px-4">
                  <Select
                    className="w-36 h-8 text-xs"
                    value={u.role}
                    onChange={async (e) => {
                      await adminFetch(`/api/admin/users/${u.id}`, {
                        method: 'PATCH',
                        body: JSON.stringify({ role: e.target.value }),
                      });
                      toast.success('Role updated');
                      await onReload();
                    }}
                  >
                    <option value="super_admin">super_admin</option>
                    <option value="admin">admin</option>
                    <option value="operator">operator</option>
                    <option value="viewer">viewer</option>
                  </Select>
                </td>
                <td className="py-3 px-4">
                  <button
                    type="button"
                    className="cursor-pointer"
                    onClick={async () => {
                      await adminFetch(`/api/admin/users/${u.id}`, {
                        method: 'PATCH',
                        body: JSON.stringify({ isActive: !u.isActive }),
                      });
                      await onReload();
                    }}
                  >
                    <StatusText tone={u.isActive ? 'ok' : 'error'} label={u.isActive ? 'Active' : 'Disabled'} />
                  </button>
                </td>
                <td className="py-3 px-4 text-xs font-mono text-slate-400">
                  {u.lastLoginAt ? new Date(u.lastLoginAt).toLocaleString() : 'Never'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Surface>
    </div>
  );
};

export const AuditLogsView: React.FC<{
  logs: Array<{
    id: string;
    actorEmail: string | null;
    action: string;
    resourceType: string;
    createdAt: string;
    details: Record<string, unknown>;
  }>;
}> = ({ logs }) => (
  <div className="space-y-6">
    <h2 className="text-xl font-bold text-white">Administrative Audit Logs</h2>
    <Surface className="overflow-x-auto">
      <table className="w-full text-left border-collapse">
        <thead>
          <tr className="border-b border-slate-800 text-xs text-slate-400">
            <th className="py-3 px-4">Timestamp</th>
            <th className="py-3 px-4">Actor</th>
            <th className="py-3 px-4">Action</th>
            <th className="py-3 px-4">Resource</th>
            <th className="py-3 px-4">Details</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-800/70 text-xs">
          {logs.map((l) => (
            <tr key={l.id}>
              <td className="py-3 px-4 font-mono text-slate-400 whitespace-nowrap">
                {new Date(l.createdAt).toLocaleString()}
              </td>
              <td className="py-3 px-4 text-slate-200">{l.actorEmail || 'system'}</td>
              <td className="py-3 px-4 font-mono text-sky-400">{l.action}</td>
              <td className="py-3 px-4 text-slate-300">{l.resourceType}</td>
              <td className="py-3 px-4 font-mono text-slate-400 truncate max-w-sm">
                {JSON.stringify(l.details)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </Surface>
  </div>
);

export const SettingsView: React.FC<{
  settings: Array<{ id: string; key: string; value: unknown; description: string | null }>;
  onReload: () => Promise<void>;
}> = ({ settings, onReload }) => {
  const [drafts, setDrafts] = useState<Record<string, string>>({});

  return (
    <div className="space-y-6 max-w-3xl">
      <h2 className="text-xl font-bold text-white">Platform Settings</h2>
      <Surface className="divide-y divide-slate-800">
        {settings.map((s) => {
          const val = drafts[s.key] ?? JSON.stringify(s.value);
          return (
            <div key={s.id} className="p-5 flex flex-wrap items-center justify-between gap-4">
              <div className="min-w-0 flex-1">
                <div className="text-sm font-mono text-white">{s.key}</div>
                <div className="text-xs text-slate-400 mt-1">{s.description}</div>
              </div>
              <div className="flex items-center gap-2">
                <Input
                  className="w-32 font-mono text-xs"
                  value={val}
                  onChange={(e) => setDrafts({ ...drafts, [s.key]: e.target.value })}
                />
                <Button
                  size="sm"
                  onClick={async () => {
                    let parsed: unknown = val;
                    try {
                      parsed = JSON.parse(val);
                    } catch {
                      // Keep string
                    }
                    await adminFetch('/api/admin/settings', {
                      method: 'PUT',
                      body: JSON.stringify({ key: s.key, value: parsed }),
                    });
                    toast.success(`Saved ${s.key}`);
                    await onReload();
                  }}
                >
                  Save
                </Button>
              </div>
            </div>
          );
        })}
      </Surface>
    </div>
  );
};
