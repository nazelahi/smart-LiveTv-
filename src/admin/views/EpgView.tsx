import React, { useState } from 'react';
import { Plus, RefreshCw, Trash2, Upload } from 'lucide-react';
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

export interface EpgSourceRow {
  id: string;
  name: string;
  sourceType: string;
  sourceUrl: string | null;
  timezoneOffset: string;
  lastStatus: string | null;
  channelCount: number;
  programCount: number;
  lastFetchedAt: string | null;
}

export interface EpgChannelRow {
  id: string;
  epgSourceId: string;
  xmltvChannelId: string;
  displayName: string;
  mappedChannelId: string | null;
}

export const EpgView: React.FC<{
  sources: EpgSourceRow[];
  epgChannels: EpgChannelRow[];
  programs: Array<{
    id: string;
    xmltvChannelId: string;
    title: string;
    startTime: string;
    endTime: string;
  }>;
  channels: EffectiveChannel[];
  onReload: () => Promise<void>;
}> = ({ sources, epgChannels, programs, channels, onReload }) => {
  const [addOpen, setAddOpen] = useState(false);
  const [name, setName] = useState('');
  const [sourceType, setSourceType] = useState<'url' | 'file'>('url');
  const [sourceUrl, setSourceUrl] = useState('');
  const [xmlContent, setXmlContent] = useState('');
  const [timezoneOffset, setTimezoneOffset] = useState('+00:00');
  const [busy, setBusy] = useState(false);

  const handleFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      setXmlContent(String(reader.result || ''));
      if (!name) setName(file.name.replace(/\.xml$/i, ''));
      setSourceType('file');
    };
    reader.readAsText(file);
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold text-white">EPG Management (XMLTV)</h2>
          <p className="text-xs text-slate-400 mt-1">
            Ingest XMLTV feeds, convert timezones, and map guide channels to your IPTV lineup.
          </p>
        </div>
        <Button onClick={() => setAddOpen(true)}>
          <Plus className="w-4 h-4" />
          Add XMLTV Source
        </Button>
      </div>

      {/* EPG Sources Table */}
      <Surface className="overflow-x-auto">
        <table className="w-full text-left border-collapse">
          <thead>
            <tr className="border-b border-slate-800 text-xs text-slate-400">
              <th className="py-3 px-4 font-medium">Source Name</th>
              <th className="py-3 px-4 font-medium">Timezone</th>
              <th className="py-3 px-4 font-medium text-right">EPG Channels</th>
              <th className="py-3 px-4 font-medium text-right">Programs</th>
              <th className="py-3 px-4 font-medium">Status</th>
              <th className="py-3 px-4 font-medium text-right">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-800/70 text-sm">
            {sources.map((src) => (
              <tr key={src.id} className="hover:bg-slate-800/30">
                <td className="py-3 px-4">
                  <div className="font-medium text-white">{src.name}</div>
                  {src.sourceUrl && (
                    <div className="text-xs text-slate-500 truncate max-w-xs">{src.sourceUrl}</div>
                  )}
                </td>
                <td className="py-3 px-4 font-mono text-xs text-slate-300">
                  UTC{src.timezoneOffset}
                </td>
                <td className="py-3 px-4 text-right font-mono tabular-nums">{src.channelCount}</td>
                <td className="py-3 px-4 text-right font-mono tabular-nums">{src.programCount}</td>
                <td className="py-3 px-4">
                  <StatusText
                    tone={src.lastStatus === 'success' ? 'ok' : 'warn'}
                    label={src.lastStatus === 'success' ? 'Synced' : 'Pending'}
                  />
                </td>
                <td className="py-3 px-4 text-right">
                  <div className="flex items-center justify-end gap-2">
                    {src.sourceUrl && (
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={async () => {
                          setBusy(true);
                          try {
                            await adminFetch(`/api/admin/epg/sources/${src.id}/refresh`, {
                              method: 'POST',
                            });
                            toast.success('EPG source refreshed');
                            await onReload();
                          } finally {
                            setBusy(false);
                          }
                        }}
                        disabled={busy}
                      >
                        <RefreshCw className="w-3.5 h-3.5" />
                      </Button>
                    )}
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={async () => {
                        await adminFetch(`/api/admin/epg/sources/${src.id}`, { method: 'DELETE' });
                        toast.success('EPG source deleted');
                        await onReload();
                      }}
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

      {/* Channel-to-XMLTV Mapping */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Surface className="p-5 space-y-4">
          <h3 className="text-base font-semibold text-white">Channel Mapping (tvg-id)</h3>
          <div className="space-y-2.5 max-h-96 overflow-y-auto pr-1">
            {epgChannels.map((ec) => (
              <div
                key={ec.id}
                className="flex items-center justify-between gap-3 p-3 rounded-lg bg-[#090c10] border border-slate-800/80"
              >
                <div className="min-w-0">
                  <div className="text-sm font-medium text-white truncate">{ec.displayName}</div>
                  <div className="text-xs font-mono text-slate-400 truncate">
                    {ec.xmltvChannelId}
                  </div>
                </div>
                <Select
                  className="w-52 shrink-0"
                  value={ec.mappedChannelId || ''}
                  onChange={async (e) => {
                    await adminFetch('/api/admin/epg/map', {
                      method: 'POST',
                      body: JSON.stringify({
                        epgChannelId: ec.id,
                        channelId: e.target.value || null,
                      }),
                    });
                    toast.success('Channel EPG mapping updated');
                    await onReload();
                  }}
                >
                  <option value="">Unmapped</option>
                  {channels.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.channelNumber}. {c.name}
                    </option>
                  ))}
                </Select>
              </div>
            ))}
          </div>
        </Surface>

        <Surface className="p-5 space-y-4">
          <h3 className="text-base font-semibold text-white">Current &amp; Upcoming Schedule</h3>
          <div className="space-y-2 max-h-96 overflow-y-auto pr-1">
            {programs.slice(0, 25).map((p) => (
              <div
                key={p.id}
                className="p-3 rounded-lg bg-[#090c10] border border-slate-800/80 flex items-center justify-between gap-4"
              >
                <div className="min-w-0">
                  <div className="text-sm font-medium text-slate-100 truncate">{p.title}</div>
                  <div className="text-xs font-mono text-sky-400">{p.xmltvChannelId}</div>
                </div>
                <div className="text-xs font-mono text-slate-400 tabular-nums shrink-0">
                  {new Date(p.startTime).toLocaleTimeString([], {
                    hour: '2-digit',
                    minute: '2-digit',
                  })}{' '}
                  –{' '}
                  {new Date(p.endTime).toLocaleTimeString([], {
                    hour: '2-digit',
                    minute: '2-digit',
                  })}
                </div>
              </div>
            ))}
          </div>
        </Surface>
      </div>

      {/* Add XMLTV Source Modal */}
      <ModalDialog
        open={addOpen}
        onClose={() => setAddOpen(false)}
        title="Add XMLTV EPG Source"
      >
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            setBusy(true);
            try {
              await adminFetch('/api/admin/epg/sources', {
                method: 'POST',
                body: JSON.stringify({
                  name,
                  sourceType,
                  sourceUrl: sourceType === 'url' ? sourceUrl : null,
                  xmlContent: sourceType === 'file' ? xmlContent : null,
                  timezoneOffset,
                }),
              });
              toast.success('EPG source ingested');
              setAddOpen(false);
              await onReload();
            } catch (err) {
              toast.error(err instanceof Error ? err.message : 'EPG import failed');
            } finally {
              setBusy(false);
            }
          }}
          className="space-y-4"
        >
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs text-slate-400 mb-1">Source Name</label>
              <Input required value={name} onChange={(e) => setName(e.target.value)} />
            </div>
            <div>
              <label className="block text-xs text-slate-400 mb-1">Default Timezone Offset</label>
              <Select value={timezoneOffset} onChange={(e) => setTimezoneOffset(e.target.value)}>
                <option value="+00:00">UTC (+00:00)</option>
                <option value="+06:00">Asia/Dhaka (+06:00)</option>
                <option value="+08:00">Asia/Singapore (+08:00)</option>
                <option value="-05:00">US Eastern (-05:00)</option>
                <option value="+01:00">Europe/Berlin (+01:00)</option>
              </Select>
            </div>
          </div>

          <div className="flex gap-2">
            <Button
              size="sm"
              variant={sourceType === 'url' ? 'primary' : 'secondary'}
              onClick={() => setSourceType('url')}
            >
              XMLTV URL
            </Button>
            <Button
              size="sm"
              variant={sourceType === 'file' ? 'primary' : 'secondary'}
              onClick={() => setSourceType('file')}
            >
              Upload XML File
            </Button>
          </div>

          {sourceType === 'url' ? (
            <Input
              placeholder="https://example.com/epg.xml"
              value={sourceUrl}
              onChange={(e) => setSourceUrl(e.target.value)}
            />
          ) : (
            <div className="space-y-2">
              <label className="inline-flex items-center gap-2 px-3 py-2 rounded-lg bg-[#171d28] border border-slate-700 text-xs text-slate-200 cursor-pointer">
                <Upload className="w-3.5 h-3.5" />
                <span>Choose .xml File</span>
                <input type="file" accept=".xml" className="hidden" onChange={handleFile} />
              </label>
              <Textarea
                rows={5}
                className="font-mono text-xs"
                placeholder="<tv><channel id=&quot;...&quot;>...</tv>"
                value={xmlContent}
                onChange={(e) => setXmlContent(e.target.value)}
              />
            </div>
          )}

          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setAddOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={busy}>
              Ingest XMLTV
            </Button>
          </div>
        </form>
      </ModalDialog>
    </div>
  );
};
