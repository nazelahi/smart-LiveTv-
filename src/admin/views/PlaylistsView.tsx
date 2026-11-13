import React, { useState } from 'react';
import {
  CheckCircle2,
  Eye,
  History,
  Plus,
  RefreshCw,
  RotateCcw,
  Trash2,
  Upload,
} from 'lucide-react';
import { toast } from 'sonner';
import { adminFetch } from '../api';
import {
  Button,
  Input,
  ModalDialog,
  Select,
  StatusText,
  Surface,
  Textarea,
} from '../../components/ui/Primitives';

export interface PlaylistRow {
  id: string;
  name: string;
  description: string | null;
  sourceType: 'url' | 'file' | 'manual';
  sourceUrl: string | null;
  autoRefreshIntervalMins: number;
  isEnabled: boolean;
  activeVersionNumber: number;
  epgSourceId: string | null;
  lastFetchedAt: string | null;
  lastFetchStatus: string | null;
  channelCount: number;
  createdAt: string;
}

interface PlaylistVersionRow {
  id: string;
  versionNumber: number;
  status: string;
  channelCount: number;
  checksum: string;
  changelog: string | null;
  publishedBy: string | null;
  publishedAt: string;
}

interface PreviewResult {
  epgUrl: string | null;
  totalFound: number;
  warnings: string[];
  previewChannels: Array<{
    name: string;
    tvgId: string | null;
    groupTitle: string | null;
    channelNumber: number;
    streamFormat: string;
    streamUrl: string;
  }>;
}

export const PlaylistsView: React.FC<{
  playlists: PlaylistRow[];
  epgSources: Array<{ id: string; name: string }>;
  onReload: () => Promise<void>;
}> = ({ playlists, epgSources, onReload }) => {
  const [addOpen, setAddOpen] = useState(false);
  const [versionsOpen, setVersionsOpen] = useState<PlaylistRow | null>(null);
  const [versions, setVersions] = useState<PlaylistVersionRow[]>([]);
  const [editTarget, setEditTarget] = useState<PlaylistRow | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<PlaylistRow | null>(null);

  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [sourceType, setSourceType] = useState<'url' | 'file'>('url');
  const [sourceUrl, setSourceUrl] = useState('');
  const [m3uContent, setM3uContent] = useState('');
  const [epgSourceId, setEpgSourceId] = useState('');
  const [preview, setPreview] = useState<PreviewResult | null>(null);
  const [busy, setBusy] = useState(false);

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      setM3uContent(String(reader.result || ''));
      if (!name) setName(file.name.replace(/\.(m3u8?|txt)$/i, ''));
      setSourceType('file');
      toast.success(`Loaded ${file.name}`);
    };
    reader.readAsText(file);
  };

  const handlePreview = async () => {
    setBusy(true);
    try {
      const res = await adminFetch<PreviewResult>('/api/admin/playlists/preview', {
        method: 'POST',
        body: JSON.stringify({ sourceType, sourceUrl, m3uContent }),
      });
      setPreview(res);
      toast.success(`Validated ${res.totalFound} channels`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Preview failed');
    } finally {
      setBusy(false);
    }
  };

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      const res = await adminFetch<{ importedCount: number }>('/api/admin/playlists', {
        method: 'POST',
        body: JSON.stringify({
          name,
          description,
          sourceType,
          sourceUrl: sourceType === 'url' ? sourceUrl : null,
          m3uContent: sourceType === 'file' ? m3uContent : null,
          epgSourceId: epgSourceId || null,
        }),
      });
      toast.success(`Imported playlist with ${res.importedCount} channels`);
      setAddOpen(false);
      setName('');
      setDescription('');
      setSourceUrl('');
      setM3uContent('');
      setPreview(null);
      await onReload();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to create playlist');
    } finally {
      setBusy(false);
    }
  };

  const openVersions = async (pl: PlaylistRow) => {
    setVersionsOpen(pl);
    try {
      const rows = await adminFetch<PlaylistVersionRow[]>(
        `/api/admin/playlists/${pl.id}/versions`
      );
      setVersions(rows);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to load versions');
    }
  };

  const handlePublish = async (pl: PlaylistRow) => {
    setBusy(true);
    try {
      const res = await adminFetch<{ version: { versionNumber: number }; dispatchedDevices: number }>(
        `/api/admin/playlists/${pl.id}/publish`,
        {
          method: 'POST',
          body: JSON.stringify({ changelog: 'Published from Admin Console' }),
        }
      );
      toast.success(
        `Published v${res.version.versionNumber} · Notified ${res.dispatchedDevices} devices`
      );
      await onReload();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Publish failed');
    } finally {
      setBusy(false);
    }
  };

  const handleRefresh = async (pl: PlaylistRow) => {
    setBusy(true);
    try {
      const res = await adminFetch<{ refreshedCount: number }>(
        `/api/admin/playlists/${pl.id}/refresh`,
        { method: 'POST' }
      );
      toast.success(`Refreshed ${res.refreshedCount} channels (overrides preserved)`);
      await onReload();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Refresh failed');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold text-white">M3U Playlists</h2>
          <p className="text-xs text-slate-400 mt-1">
            Import remote M3U URLs or local files, preview streams, and publish versioned updates.
          </p>
        </div>
        <Button onClick={() => setAddOpen(true)}>
          <Plus className="w-4 h-4" />
          Import Playlist
        </Button>
      </div>

      {playlists.length === 0 ? (
        <Surface className="p-10 text-center">
          <p className="text-sm text-slate-300">No playlists configured yet.</p>
          <Button className="mt-4" onClick={() => setAddOpen(true)}>
            Import First M3U Playlist
          </Button>
        </Surface>
      ) : (
        <Surface className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="border-b border-slate-800 text-xs text-slate-400">
                <th className="py-3 px-4 font-medium">Playlist Name</th>
                <th className="py-3 px-4 font-medium">Source</th>
                <th className="py-3 px-4 font-medium text-right">Channels</th>
                <th className="py-3 px-4 font-medium text-right">Active Ver.</th>
                <th className="py-3 px-4 font-medium">Status</th>
                <th className="py-3 px-4 font-medium text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/70 text-sm">
              {playlists.map((pl) => (
                <tr key={pl.id} className="hover:bg-slate-800/30">
                  <td className="py-3 px-4">
                    <div className="font-medium text-white">{pl.name}</div>
                    {pl.description && (
                      <div className="text-xs text-slate-400 truncate max-w-xs">
                        {pl.description}
                      </div>
                    )}
                  </td>
                  <td className="py-3 px-4 text-xs text-slate-300">
                    <span className="uppercase font-mono">{pl.sourceType}</span>
                    {pl.sourceUrl && (
                      <span className="text-slate-500 ml-2 truncate max-w-[200px] inline-block align-bottom">
                        {pl.sourceUrl}
                      </span>
                    )}
                  </td>
                  <td className="py-3 px-4 text-right font-mono tabular-nums text-slate-200">
                    {pl.channelCount}
                  </td>
                  <td className="py-3 px-4 text-right font-mono tabular-nums text-sky-400">
                    v{pl.activeVersionNumber}
                  </td>
                  <td className="py-3 px-4">
                    <button
                      type="button"
                      onClick={async () => {
                        await adminFetch(`/api/admin/playlists/${pl.id}`, {
                          method: 'PATCH',
                          body: JSON.stringify({ isEnabled: !pl.isEnabled }),
                        });
                        await onReload();
                      }}
                      className="cursor-pointer"
                    >
                      <StatusText
                        tone={pl.isEnabled ? 'ok' : 'muted'}
                        label={pl.isEnabled ? 'Enabled' : 'Disabled'}
                      />
                    </button>
                  </td>
                  <td className="py-3 px-4">
                    <div className="flex items-center justify-end gap-1.5">
                      {pl.sourceUrl && (
                        <Button
                          size="sm"
                          variant="ghost"
                          disabled={busy}
                          onClick={() => void handleRefresh(pl)}
                          title="Refresh remote M3U"
                        >
                          <RefreshCw className="w-3.5 h-3.5" />
                        </Button>
                      )}
                      <Button
                        size="sm"
                        variant="secondary"
                        disabled={busy}
                        onClick={() => void handlePublish(pl)}
                      >
                        <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
                        Publish
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => void openVersions(pl)}
                        title="Version History & Rollback"
                      >
                        <History className="w-3.5 h-3.5" />
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => setEditTarget(pl)}
                      >
                        Edit
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => setDeleteTarget(pl)}
                      >
                        <Trash2 className="w-3.5 h-3.5 text-rose-400" />
                      </Button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Surface>
      )}

      {/* Import M3U Modal */}
      <ModalDialog
        open={addOpen}
        onClose={() => setAddOpen(false)}
        title="Import M3U Playlist"
        description="Provide an authorized M3U/M3U8 URL or upload a local file. Server imports are SSRF-validated."
        maxWidth="max-w-2xl"
      >
        <form onSubmit={handleCreate} className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs text-slate-400 mb-1.5">Playlist Name</label>
              <Input
                required
                placeholder="e.g. Sports & News Lineup"
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </div>
            <div>
              <label className="block text-xs text-slate-400 mb-1.5">Linked EPG Source</label>
              <Select value={epgSourceId} onChange={(e) => setEpgSourceId(e.target.value)}>
                <option value="">None</option>
                {epgSources.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </Select>
            </div>
          </div>

          <div>
            <label className="block text-xs text-slate-400 mb-1.5">Description</label>
            <Input
              placeholder="Optional administrative note"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          </div>

          <div className="flex items-center gap-2 p-1 bg-[#090c10] rounded-lg w-fit border border-slate-800">
            <button
              type="button"
              onClick={() => setSourceType('url')}
              className={`px-3 py-1.5 text-xs font-medium rounded-md cursor-pointer ${
                sourceType === 'url' ? 'bg-slate-800 text-white' : 'text-slate-400'
              }`}
            >
              Remote M3U URL
            </button>
            <button
              type="button"
              onClick={() => setSourceType('file')}
              className={`px-3 py-1.5 text-xs font-medium rounded-md cursor-pointer ${
                sourceType === 'file' ? 'bg-slate-800 text-white' : 'text-slate-400'
              }`}
            >
              Upload / Paste M3U
            </button>
          </div>

          {sourceType === 'url' ? (
            <div>
              <label className="block text-xs text-slate-400 mb-1.5">M3U URL (HTTPS)</label>
              <Input
                placeholder="https://example.com/playlist.m3u8"
                value={sourceUrl}
                onChange={(e) => setSourceUrl(e.target.value)}
              />
            </div>
          ) : (
            <div className="space-y-3">
              <label className="inline-flex items-center gap-2 px-3 py-2 rounded-lg bg-[#171d28] border border-slate-700 text-xs text-slate-200 cursor-pointer hover:bg-slate-800">
                <Upload className="w-3.5 h-3.5" />
                <span>Choose .m3u / .m3u8 File</span>
                <input
                  type="file"
                  accept=".m3u,.m3u8,.txt"
                  className="hidden"
                  onChange={handleFileUpload}
                />
              </label>
              <Textarea
                rows={5}
                placeholder="#EXTM3U&#10;#EXTINF:-1 tvg-id=&quot;ch1&quot; group-title=&quot;News&quot;,Channel One&#10;https://..."
                value={m3uContent}
                onChange={(e) => setM3uContent(e.target.value)}
                className="font-mono text-xs"
              />
            </div>
          )}

          {preview && (
            <div className="p-4 rounded-lg bg-[#090c10] border border-slate-800 space-y-2">
              <div className="flex items-center justify-between text-xs">
                <span className="font-medium text-sky-400">
                  Preview: {preview.totalFound} channels detected
                </span>
                {preview.warnings.length > 0 && (
                  <span className="text-amber-400">{preview.warnings.length} warnings</span>
                )}
              </div>
              <div className="max-h-36 overflow-y-auto divide-y divide-slate-800/70 text-xs">
                {preview.previewChannels.slice(0, 12).map((ch, idx) => (
                  <div key={idx} className="py-1.5 flex items-center justify-between gap-2">
                    <span className="text-slate-200 truncate">
                      {ch.channelNumber}. {ch.name}
                    </span>
                    <span className="text-slate-500 font-mono shrink-0">
                      {ch.groupTitle || 'General'} · {ch.streamFormat}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="flex items-center justify-end gap-3 pt-2">
            <Button variant="secondary" disabled={busy} onClick={() => void handlePreview()}>
              <Eye className="w-4 h-4" />
              Validate &amp; Preview
            </Button>
            <Button type="submit" disabled={busy}>
              Import &amp; Publish v1
            </Button>
          </div>
        </form>
      </ModalDialog>

      {/* Version History & Rollback Modal */}
      <ModalDialog
        open={Boolean(versionsOpen)}
        onClose={() => setVersionsOpen(null)}
        title={`Version History — ${versionsOpen?.name || ''}`}
        description="Restore any previously published immutable snapshot to all assigned TVs."
      >
        <div className="space-y-2">
          {versions.map((v) => {
            const isCurrent = v.versionNumber === versionsOpen?.activeVersionNumber;
            return (
              <div
                key={v.id}
                className="flex items-center justify-between gap-4 p-3 rounded-lg bg-[#090c10] border border-slate-800"
              >
                <div>
                  <div className="text-sm font-medium text-white font-mono">
                    v{v.versionNumber} · {v.channelCount} channels
                    {isCurrent && (
                      <span className="text-emerald-400 text-xs font-sans ml-2">Active</span>
                    )}
                  </div>
                  <div className="text-xs text-slate-400 mt-0.5">
                    {v.changelog || 'Published'} · {new Date(v.publishedAt).toLocaleString()}
                  </div>
                </div>
                {!isCurrent && versionsOpen && (
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={async () => {
                      await adminFetch(`/api/admin/playlists/${versionsOpen.id}/rollback`, {
                        method: 'POST',
                        body: JSON.stringify({ versionNumber: v.versionNumber }),
                      });
                      toast.success(`Rolled back to v${v.versionNumber}`);
                      setVersionsOpen(null);
                      await onReload();
                    }}
                  >
                    <RotateCcw className="w-3.5 h-3.5" />
                    Restore
                  </Button>
                )}
              </div>
            );
          })}
        </div>
      </ModalDialog>

      {/* Edit Playlist Modal */}
      <ModalDialog
        open={Boolean(editTarget)}
        onClose={() => setEditTarget(null)}
        title={`Edit Playlist — ${editTarget?.name || ''}`}
      >
        {editTarget && (
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              await adminFetch(`/api/admin/playlists/${editTarget.id}`, {
                method: 'PATCH',
                body: JSON.stringify({
                  name: editTarget.name,
                  description: editTarget.description,
                  sourceUrl: editTarget.sourceUrl,
                  epgSourceId: editTarget.epgSourceId || null,
                }),
              });
              toast.success('Playlist updated');
              setEditTarget(null);
              await onReload();
            }}
            className="space-y-4"
          >
            <div>
              <label className="block text-xs text-slate-400 mb-1">Name</label>
              <Input
                value={editTarget.name}
                onChange={(e) => setEditTarget({ ...editTarget, name: e.target.value })}
              />
            </div>
            <div>
              <label className="block text-xs text-slate-400 mb-1">Description</label>
              <Input
                value={editTarget.description || ''}
                onChange={(e) => setEditTarget({ ...editTarget, description: e.target.value })}
              />
            </div>
            <div>
              <label className="block text-xs text-slate-400 mb-1">Source URL</label>
              <Input
                value={editTarget.sourceUrl || ''}
                onChange={(e) => setEditTarget({ ...editTarget, sourceUrl: e.target.value })}
              />
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="ghost" onClick={() => setEditTarget(null)}>
                Cancel
              </Button>
              <Button type="submit">Save Changes</Button>
            </div>
          </form>
        )}
      </ModalDialog>

      {/* Delete Confirmation Modal */}
      <ModalDialog
        open={Boolean(deleteTarget)}
        onClose={() => setDeleteTarget(null)}
        title="Delete Playlist"
        description="This removes the playlist, imported channels, and version snapshots permanently."
      >
        <div className="flex justify-end gap-3">
          <Button variant="ghost" onClick={() => setDeleteTarget(null)}>
            Cancel
          </Button>
          <Button
            variant="danger"
            onClick={async () => {
              if (!deleteTarget) return;
              await adminFetch(`/api/admin/playlists/${deleteTarget.id}`, {
                method: 'DELETE',
              });
              toast.success('Playlist deleted');
              setDeleteTarget(null);
              await onReload();
            }}
          >
            Confirm Delete
          </Button>
        </div>
      </ModalDialog>
    </div>
  );
};
