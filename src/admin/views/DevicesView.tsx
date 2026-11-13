import React, { useState } from 'react';
import { KeyRound, RefreshCw, ShieldOff, Tv } from 'lucide-react';
import { toast } from 'sonner';
import { adminFetch } from '../api';
import {
  Button,
  Input,
  ModalDialog,
  Select,
  StatusText,
  Surface,
} from '../../components/ui/Primitives';
import type { PlaylistRow } from './PlaylistsView';

export interface DeviceRow {
  id: string;
  deviceName: string;
  platform: string;
  model: string | null;
  hardwareId: string;
  pairingCode: string | null;
  status: string;
  appVersion: string | null;
  groupId: string | null;
  groupName: string | null;
  lastOnlineAt: string | null;
  lastSyncAt: string | null;
  lastSyncVersion: number | null;
  assignedPlaylists: Array<{
    assignmentId: string;
    playlistId: string;
    playlistName: string;
    mode: string;
  }>;
}

export const DevicesView: React.FC<{
  devices: DeviceRow[];
  groups: Array<{ id: string; name: string }>;
  playlists: PlaylistRow[];
  onReload: () => Promise<void>;
}> = ({ devices, groups, playlists, onReload }) => {
  const [pairOpen, setPairOpen] = useState(false);
  const [pairingCode, setPairingCode] = useState('');
  const [deviceName, setDeviceName] = useState('');
  const [groupId, setGroupId] = useState('');
  const [selectedPlaylists, setSelectedPlaylists] = useState<string[]>([]);
  const [editDevice, setEditDevice] = useState<DeviceRow | null>(null);
  const [revokeTarget, setRevokeTarget] = useState<DeviceRow | null>(null);

  const handlePair = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await adminFetch('/api/admin/devices/pair', {
        method: 'POST',
        body: JSON.stringify({
          pairingCode,
          deviceName,
          groupId: groupId || null,
          playlistIds: selectedPlaylists,
        }),
      });
      toast.success('Device paired and authorized');
      setPairOpen(false);
      setPairingCode('');
      setDeviceName('');
      setSelectedPlaylists([]);
      await onReload();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Pairing failed');
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold text-white">Connected Smart TVs</h2>
          <p className="text-xs text-slate-400 mt-1">
            Authorize new TVs via pairing codes, monitor connection status, or revoke credentials instantly.
          </p>
        </div>
        <Button onClick={() => setPairOpen(true)}>
          <KeyRound className="w-4 h-4" />
          Pair New TV
        </Button>
      </div>

      {devices.length === 0 ? (
        <Surface className="p-10 text-center">
          <Tv className="w-10 h-10 text-slate-600 mx-auto mb-3" />
          <p className="text-sm text-slate-300">No TVs registered yet.</p>
          <p className="text-xs text-slate-500 mt-1">
            Launch the Smart TV interface to generate a temporary pairing code, then authorize it here.
          </p>
        </Surface>
      ) : (
        <Surface className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="border-b border-slate-800 text-xs text-slate-400">
                <th className="py-3 px-4 font-medium">Device</th>
                <th className="py-3 px-4 font-medium">Platform &amp; Model</th>
                <th className="py-3 px-4 font-medium">Group</th>
                <th className="py-3 px-4 font-medium">Assigned Playlists</th>
                <th className="py-3 px-4 font-medium">Status</th>
                <th className="py-3 px-4 font-medium">Last Sync</th>
                <th className="py-3 px-4 font-medium text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/70 text-sm">
              {devices.map((dev) => {
                const tone =
                  dev.status === 'active'
                    ? 'ok'
                    : dev.status === 'revoked'
                      ? 'error'
                      : 'warn';
                return (
                  <tr key={dev.id} className="hover:bg-slate-800/30">
                    <td className="py-3 px-4">
                      <div className="font-medium text-white">{dev.deviceName}</div>
                      <div className="text-xs font-mono text-slate-500">{dev.hardwareId}</div>
                    </td>
                    <td className="py-3 px-4 text-xs text-slate-300">
                      <div>{dev.platform}</div>
                      <div className="text-slate-500">
                        {dev.model} · v{dev.appVersion}
                      </div>
                    </td>
                    <td className="py-3 px-4 text-xs text-slate-300">
                      {dev.groupName || 'Unassigned'}
                    </td>
                    <td className="py-3 px-4 text-xs text-slate-300">
                      {dev.assignedPlaylists.length > 0
                        ? dev.assignedPlaylists.map((p) => p.playlistName).join(', ')
                        : 'None'}
                    </td>
                    <td className="py-3 px-4">
                      <StatusText tone={tone} label={dev.status} />
                    </td>
                    <td className="py-3 px-4 text-xs font-mono tabular-nums text-slate-400">
                      {dev.lastSyncAt
                        ? `${new Date(dev.lastSyncAt).toLocaleTimeString()} (v${dev.lastSyncVersion || 0})`
                        : 'Pending'}
                    </td>
                    <td className="py-3 px-4">
                      <div className="flex items-center justify-end gap-1.5">
                        {dev.status !== 'revoked' && (
                          <Button
                            size="sm"
                            variant="ghost"
                            title="Force Synchronization"
                            onClick={async () => {
                              await adminFetch(`/api/admin/devices/${dev.id}/sync`, {
                                method: 'POST',
                              });
                              toast.success(`Sync event pushed to ${dev.deviceName}`);
                              await onReload();
                            }}
                          >
                            <RefreshCw className="w-3.5 h-3.5" />
                          </Button>
                        )}
                        <Button size="sm" variant="ghost" onClick={() => setEditDevice(dev)}>
                          Edit
                        </Button>
                        {dev.status !== 'revoked' && (
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => setRevokeTarget(dev)}
                            title="Revoke Device Access"
                          >
                            <ShieldOff className="w-3.5 h-3.5 text-rose-400" />
                          </Button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </Surface>
      )}

      {/* Pair Device Modal */}
      <ModalDialog
        open={pairOpen}
        onClose={() => setPairOpen(false)}
        title="Pair Smart TV via Code"
        description="Enter the 6-character temporary pairing code displayed on the television screen."
      >
        <form onSubmit={handlePair} className="space-y-4">
          <div>
            <label className="block text-xs text-slate-400 mb-1">Pairing Code</label>
            <Input
              required
              placeholder="e.g. A7K-92M"
              className="font-mono uppercase tracking-widest text-lg"
              value={pairingCode}
              onChange={(e) => setPairingCode(e.target.value)}
            />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs text-slate-400 mb-1">Device Name</label>
              <Input
                placeholder="e.g. Living Room OLED"
                value={deviceName}
                onChange={(e) => setDeviceName(e.target.value)}
              />
            </div>
            <div>
              <label className="block text-xs text-slate-400 mb-1">Device Group</label>
              <Select value={groupId} onChange={(e) => setGroupId(e.target.value)}>
                <option value="">No Group</option>
                {groups.map((g) => (
                  <option key={g.id} value={g.id}>
                    {g.name}
                  </option>
                ))}
              </Select>
            </div>
          </div>

          <div>
            <label className="block text-xs text-slate-400 mb-2">
              Assign Additional Playlists (optional)
            </label>
            <div className="space-y-1.5 max-h-36 overflow-y-auto p-3 rounded-lg bg-[#090c10] border border-slate-800">
              {playlists.map((p) => (
                <label key={p.id} className="flex items-center gap-2 text-xs text-slate-200 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={selectedPlaylists.includes(p.id)}
                    onChange={(e) =>
                      setSelectedPlaylists((prev) =>
                        e.target.checked ? [...prev, p.id] : prev.filter((id) => id !== p.id)
                      )
                    }
                  />
                  <span>{p.name}</span>
                </label>
              ))}
            </div>
          </div>

          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setPairOpen(false)}>
              Cancel
            </Button>
            <Button type="submit">Approve &amp; Authorize TV</Button>
          </div>
        </form>
      </ModalDialog>

      {/* Edit Device Modal */}
      <ModalDialog
        open={Boolean(editDevice)}
        onClose={() => setEditDevice(null)}
        title="Edit Device"
      >
        {editDevice && (
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              await adminFetch(`/api/admin/devices/${editDevice.id}`, {
                method: 'PATCH',
                body: JSON.stringify({
                  deviceName: editDevice.deviceName,
                  groupId: editDevice.groupId || null,
                }),
              });
              toast.success('Device updated');
              setEditDevice(null);
              await onReload();
            }}
            className="space-y-4"
          >
            <div>
              <label className="block text-xs text-slate-400 mb-1">Device Name</label>
              <Input
                value={editDevice.deviceName}
                onChange={(e) =>
                  setEditDevice({ ...editDevice, deviceName: e.target.value })
                }
              />
            </div>
            <div>
              <label className="block text-xs text-slate-400 mb-1">Device Group</label>
              <Select
                value={editDevice.groupId || ''}
                onChange={(e) =>
                  setEditDevice({ ...editDevice, groupId: e.target.value || null })
                }
              >
                <option value="">Unassigned</option>
                {groups.map((g) => (
                  <option key={g.id} value={g.id}>
                    {g.name}
                  </option>
                ))}
              </Select>
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="ghost" onClick={() => setEditDevice(null)}>
                Cancel
              </Button>
              <Button type="submit">Save</Button>
            </div>
          </form>
        )}
      </ModalDialog>

      {/* Revoke Confirmation Modal */}
      <ModalDialog
        open={Boolean(revokeTarget)}
        onClose={() => setRevokeTarget(null)}
        title="Revoke Device Access"
        description="Revoking invalidates all device credentials immediately and disconnects the TV."
      >
        <div className="flex justify-end gap-3">
          <Button variant="ghost" onClick={() => setRevokeTarget(null)}>
            Cancel
          </Button>
          <Button
            variant="danger"
            onClick={async () => {
              if (!revokeTarget) return;
              await adminFetch(`/api/admin/devices/${revokeTarget.id}/revoke`, {
                method: 'POST',
              });
              toast.success(`${revokeTarget.deviceName} revoked`);
              setRevokeTarget(null);
              await onReload();
            }}
          >
            Confirm Revoke
          </Button>
        </div>
      </ModalDialog>
    </div>
  );
};
