import React, { useMemo, useState } from 'react';
import { Edit3, Plus, RotateCcw, Search } from 'lucide-react';
import { toast } from 'sonner';
import type { EffectiveChannel } from '../../../packages/core-models/src/index';
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
import type { PlaylistRow } from './PlaylistsView';

export const ChannelsView: React.FC<{
  channels: EffectiveChannel[];
  playlists: PlaylistRow[];
  categories: Array<{ id: string; name: string }>;
  onReload: () => Promise<void>;
}> = ({ channels, playlists, categories, onReload }) => {
  const [search, setSearch] = useState('');
  const [playlistFilter, setPlaylistFilter] = useState('ALL');
  const [categoryFilter, setCategoryFilter] = useState('ALL');
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [page, setPage] = useState(1);
  const pageSize = 100;
  const [editing, setEditing] = useState<EffectiveChannel | null>(null);
  const [addOpen, setAddOpen] = useState(false);

  const [editForm, setEditForm] = useState({
    customName: '',
    customLogoUrl: '',
    customCategoryId: '',
    customChannelNumber: 1,
    customStreamUrl: '',
    customHttpHeadersJson: '{}',
    isEnabledOverride: true,
    isHiddenOverride: false,
    customSortOrder: 1,
  });

  const [newChannel, setNewChannel] = useState({
    playlistId: playlists[0]?.id || '',
    name: '',
    tvgId: '',
    logoUrl: '',
    categoryId: '',
    channelNumber: 100,
    streamUrl: '',
    streamFormat: 'hls',
  });

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return channels.filter((c) => {
      if (playlistFilter !== 'ALL' && c.playlistId !== playlistFilter) return false;
      if (categoryFilter !== 'ALL' && c.categoryId !== categoryFilter) return false;
      if (
        q &&
        !c.name.toLowerCase().includes(q) &&
        !(c.tvgId || '').toLowerCase().includes(q) &&
        !String(c.channelNumber).includes(q)
      ) {
        return false;
      }
      return true;
    });
  }, [channels, search, playlistFilter, categoryFilter]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const safePage = Math.min(page, totalPages);
  const paginated = filtered.slice((safePage - 1) * pageSize, safePage * pageSize);

  const openEdit = (ch: EffectiveChannel) => {
    setEditing(ch);
    setEditForm({
      customName: ch.name,
      customLogoUrl: ch.logoUrl || '',
      customCategoryId: ch.categoryId || '',
      customChannelNumber: ch.channelNumber,
      customStreamUrl: ch.streamUrl,
      customHttpHeadersJson: JSON.stringify(ch.httpHeaders || {}, null, 2),
      isEnabledOverride: ch.isEnabled,
      isHiddenOverride: ch.isHidden,
      customSortOrder: ch.sortOrder,
    });
  };

  const handleSaveEdit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editing) return;
    let parsedHeaders: Record<string, string> = {};
    try {
      parsedHeaders = JSON.parse(editForm.customHttpHeadersJson || '{}');
    } catch {
      toast.error('HTTP Headers must be valid JSON');
      return;
    }

    await adminFetch(`/api/admin/channels/${editing.id}`, {
      method: 'PATCH',
      body: JSON.stringify({
        customName: editForm.customName,
        customLogoUrl: editForm.customLogoUrl || null,
        customCategoryId: editForm.customCategoryId || null,
        customChannelNumber: Number(editForm.customChannelNumber),
        customStreamUrl: editForm.customStreamUrl,
        customHttpHeaders: parsedHeaders,
        isEnabledOverride: editForm.isEnabledOverride,
        isHiddenOverride: editForm.isHiddenOverride,
        customSortOrder: Number(editForm.customSortOrder),
      }),
    });
    toast.success('Channel override saved. Publish playlist to push to TVs.');
    setEditing(null);
    await onReload();
  };

  const handleBulk = async (action: 'enable' | 'disable' | 'hide' | 'unhide') => {
    if (selectedIds.length === 0) return;
    await adminFetch('/api/admin/channels/bulk', {
      method: 'POST',
      body: JSON.stringify({ channelIds: selectedIds, action }),
    });
    toast.success(`Updated ${selectedIds.length} channels`);
    setSelectedIds([]);
    await onReload();
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold text-white">Channel Editor &amp; Overrides</h2>
          <p className="text-xs text-slate-400 mt-1">
            Administrative edits are stored as non-destructive overrides preserved across M3U refreshes.
          </p>
        </div>
        <Button onClick={() => setAddOpen(true)}>
          <Plus className="w-4 h-4" />
          Add Channel
        </Button>
      </div>

      {/* Filters & Bulk Toolbar */}
      <Surface className="p-4 flex flex-wrap items-center gap-3">
        <div className="relative flex-1 min-w-[220px]">
          <Search className="w-4 h-4 text-slate-500 absolute left-3 top-3" />
          <Input
            className="pl-9"
            placeholder="Search channel name, number, or tvg-id..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <Select
          className="w-48"
          value={playlistFilter}
          onChange={(e) => setPlaylistFilter(e.target.value)}
        >
          <option value="ALL">All Playlists</option>
          {playlists.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </Select>
        <Select
          className="w-48"
          value={categoryFilter}
          onChange={(e) => setCategoryFilter(e.target.value)}
        >
          <option value="ALL">All Categories</option>
          {categories.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </Select>
      </Surface>

      {selectedIds.length > 0 && (
        <div className="flex items-center justify-between gap-4 px-4 py-3 rounded-xl bg-sky-500/10 border border-sky-500/30">
          <span className="text-xs font-medium text-sky-300 tabular-nums">
            {selectedIds.length} channels selected
          </span>
          <div className="flex items-center gap-2">
            <Button size="sm" variant="secondary" onClick={() => void handleBulk('enable')}>
              Enable
            </Button>
            <Button size="sm" variant="secondary" onClick={() => void handleBulk('disable')}>
              Disable
            </Button>
            <Button size="sm" variant="secondary" onClick={() => void handleBulk('hide')}>
              Hide
            </Button>
            <Button size="sm" variant="secondary" onClick={() => void handleBulk('unhide')}>
              Unhide
            </Button>
          </div>
        </div>
      )}

      <Surface className="overflow-x-auto">
        <table className="w-full text-left border-collapse">
          <thead>
            <tr className="border-b border-slate-800 text-xs text-slate-400">
              <th className="py-3 px-4 w-10">
                <input
                  type="checkbox"
                  checked={filtered.length > 0 && selectedIds.length === filtered.length}
                  onChange={(e) =>
                    setSelectedIds(e.target.checked ? filtered.map((c) => c.id) : [])
                  }
                />
              </th>
              <th className="py-3 px-4 font-medium">No.</th>
              <th className="py-3 px-4 font-medium">Channel</th>
              <th className="py-3 px-4 font-medium">Category</th>
              <th className="py-3 px-4 font-medium">Playlist</th>
              <th className="py-3 px-4 font-medium">State</th>
              <th className="py-3 px-4 font-medium text-right">Edit</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-800/70 text-sm">
            {paginated.map((ch) => (
              <tr key={ch.id} className="hover:bg-slate-800/30">
                <td className="py-3 px-4">
                  <input
                    type="checkbox"
                    checked={selectedIds.includes(ch.id)}
                    onChange={(e) =>
                      setSelectedIds((prev) =>
                        e.target.checked
                          ? [...prev, ch.id]
                          : prev.filter((id) => id !== ch.id)
                      )
                    }
                  />
                </td>
                <td className="py-3 px-4 font-mono tabular-nums text-sky-400">
                  {ch.channelNumber}
                </td>
                <td className="py-3 px-4">
                  <div className="flex items-center gap-3">
                    <img
                      src={ch.logoUrl || '/src/assets/images/tv_channel_cinema_1794571501792.jpg'}
                      alt={ch.name}
                      referrerPolicy="no-referrer"
                      className="w-8 h-8 rounded object-cover bg-slate-900 shrink-0"
                    />
                    <div className="min-w-0">
                      <div className="font-medium text-white truncate max-w-xs">
                        {ch.name}
                        {ch.hasOverride && (
                          <span className="text-xs text-amber-400 ml-2">Overridden</span>
                        )}
                      </div>
                      <div className="text-xs text-slate-500 font-mono truncate max-w-xs">
                        {ch.tvgId || 'No tvg-id'} · {ch.streamFormat}
                      </div>
                    </div>
                  </div>
                </td>
                <td className="py-3 px-4 text-xs text-slate-300">
                  {ch.categoryName || ch.groupTitle || 'Uncategorized'}
                </td>
                <td className="py-3 px-4 text-xs text-slate-400">{ch.playlistName}</td>
                <td className="py-3 px-4">
                  <StatusText
                    tone={!ch.isEnabled ? 'error' : ch.isHidden ? 'warn' : 'ok'}
                    label={!ch.isEnabled ? 'Disabled' : ch.isHidden ? 'Hidden' : 'Active'}
                  />
                </td>
                <td className="py-3 px-4 text-right">
                  <div className="flex items-center justify-end gap-1">
                    {ch.hasOverride && (
                      <Button
                        size="sm"
                        variant="ghost"
                        title="Reset to imported M3U values"
                        onClick={async () => {
                          await adminFetch(`/api/admin/channels/${ch.id}/override`, {
                            method: 'DELETE',
                          });
                          toast.success('Override cleared');
                          await onReload();
                        }}
                      >
                        <RotateCcw className="w-3.5 h-3.5" />
                      </Button>
                    )}
                    <Button size="sm" variant="ghost" onClick={() => openEdit(ch)}>
                      <Edit3 className="w-3.5 h-3.5" />
                    </Button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {filtered.length > pageSize && (
          <div className="flex items-center justify-between px-4 py-3 border-t border-slate-800 text-xs text-slate-400">
            <span className="tabular-nums">
              Showing {(safePage - 1) * pageSize + 1}–{Math.min(safePage * pageSize, filtered.length)} of {filtered.length} channels
            </span>
            <div className="flex items-center gap-2">
              <Button
                size="sm"
                variant="secondary"
                disabled={safePage <= 1}
                onClick={() => setPage((p) => Math.max(1, p - 1))}
              >
                Previous
              </Button>
              <span className="font-mono tabular-nums text-slate-200">
                {safePage} / {totalPages}
              </span>
              <Button
                size="sm"
                variant="secondary"
                disabled={safePage >= totalPages}
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              >
                Next
              </Button>
            </div>
          </div>
        )}
      </Surface>

      {/* Edit Channel Override Modal */}
      <ModalDialog
        open={Boolean(editing)}
        onClose={() => setEditing(null)}
        title={`Edit Channel — ${editing?.name || ''}`}
        description={`Original imported name: ${editing?.rawName || ''}`}
        maxWidth="max-w-2xl"
      >
        <form onSubmit={handleSaveEdit} className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs text-slate-400 mb-1">Channel Name</label>
              <Input
                value={editForm.customName}
                onChange={(e) => setEditForm({ ...editForm, customName: e.target.value })}
              />
            </div>
            <div>
              <label className="block text-xs text-slate-400 mb-1">Channel Number</label>
              <Input
                type="number"
                value={editForm.customChannelNumber}
                onChange={(e) =>
                  setEditForm({ ...editForm, customChannelNumber: Number(e.target.value) })
                }
              />
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs text-slate-400 mb-1">Category</label>
              <Select
                value={editForm.customCategoryId}
                onChange={(e) => setEditForm({ ...editForm, customCategoryId: e.target.value })}
              >
                <option value="">Uncategorized</option>
                {categories.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </Select>
            </div>
            <div>
              <label className="block text-xs text-slate-400 mb-1">Sort Order</label>
              <Input
                type="number"
                value={editForm.customSortOrder}
                onChange={(e) =>
                  setEditForm({ ...editForm, customSortOrder: Number(e.target.value) })
                }
              />
            </div>
          </div>

          <div>
            <label className="block text-xs text-slate-400 mb-1">Logo URL</label>
            <Input
              value={editForm.customLogoUrl}
              onChange={(e) => setEditForm({ ...editForm, customLogoUrl: e.target.value })}
            />
          </div>

          <div>
            <label className="block text-xs text-slate-400 mb-1">Stream URL</label>
            <Input
              value={editForm.customStreamUrl}
              onChange={(e) => setEditForm({ ...editForm, customStreamUrl: e.target.value })}
            />
          </div>

          <div>
            <label className="block text-xs text-slate-400 mb-1">HTTP Headers (JSON)</label>
            <Textarea
              rows={3}
              className="font-mono text-xs"
              value={editForm.customHttpHeadersJson}
              onChange={(e) =>
                setEditForm({ ...editForm, customHttpHeadersJson: e.target.value })
              }
            />
          </div>

          <div className="flex items-center gap-6 text-sm">
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={editForm.isEnabledOverride}
                onChange={(e) =>
                  setEditForm({ ...editForm, isEnabledOverride: e.target.checked })
                }
              />
              <span>Enabled</span>
            </label>
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={editForm.isHiddenOverride}
                onChange={(e) =>
                  setEditForm({ ...editForm, isHiddenOverride: e.target.checked })
                }
              />
              <span>Hidden from TV Guide</span>
            </label>
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <Button variant="ghost" onClick={() => setEditing(null)}>
              Cancel
            </Button>
            <Button type="submit">Save Override</Button>
          </div>
        </form>
      </ModalDialog>

      {/* Add Manual Channel Modal */}
      <ModalDialog
        open={addOpen}
        onClose={() => setAddOpen(false)}
        title="Add Channel Manually"
      >
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            await adminFetch('/api/admin/channels', {
              method: 'POST',
              body: JSON.stringify(newChannel),
            });
            toast.success('Channel added. Publish playlist to push to TVs.');
            setAddOpen(false);
            await onReload();
          }}
          className="space-y-4"
        >
          <div>
            <label className="block text-xs text-slate-400 mb-1">Target Playlist</label>
            <Select
              required
              value={newChannel.playlistId || playlists[0]?.id || ''}
              onChange={(e) => setNewChannel({ ...newChannel, playlistId: e.target.value })}
            >
              {playlists.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </Select>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs text-slate-400 mb-1">Channel Name</label>
              <Input
                required
                value={newChannel.name}
                onChange={(e) => setNewChannel({ ...newChannel, name: e.target.value })}
              />
            </div>
            <div>
              <label className="block text-xs text-slate-400 mb-1">Number</label>
              <Input
                type="number"
                value={newChannel.channelNumber}
                onChange={(e) =>
                  setNewChannel({ ...newChannel, channelNumber: Number(e.target.value) })
                }
              />
            </div>
          </div>
          <div>
            <label className="block text-xs text-slate-400 mb-1">Stream URL</label>
            <Input
              required
              placeholder="https://example.com/live/stream.m3u8"
              value={newChannel.streamUrl}
              onChange={(e) => setNewChannel({ ...newChannel, streamUrl: e.target.value })}
            />
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setAddOpen(false)}>
              Cancel
            </Button>
            <Button type="submit">Create Channel</Button>
          </div>
        </form>
      </ModalDialog>
    </div>
  );
};
