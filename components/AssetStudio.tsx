/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
*/
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Canvas } from '@react-three/fiber';
import { OrbitControls, Edges } from '@react-three/drei';
import { ASSET_TIERS, LICENCE_DAY_OPTIONS, MAX_FOOTPRINT, MAX_PROFIT_SHARE } from '../constants';
import { AssetTier } from '../types';
import {
  AssetSpec, AssetTerms, DEFAULT_TERMS, STARTER_ASSET, checkGlb, expandParts, extractJson, maxHeight, monumentStats, validateAsset,
} from '../services/assets/spec';
import { Library, LibraryEntry, deleteAsset, saveAsset } from '../services/assets/library';
import { aiPrompt, skillFile } from '../services/assets/skill';
import { AssetModel } from './AssetModel';
import { CloseIcon, DownloadIcon, UploadIcon } from './Icons';

interface AssetStudioProps {
  library: Library;
  onLibraryChanged: () => Promise<void> | void;
  onClose: () => void;
}

const download = (name: string, text: string, type = 'application/json') => {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
};

const toBase64 = (buf: ArrayBuffer) => {
  const bytes = new Uint8Array(buf);
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
};

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'asset';

// The editor shows the JSON without the (large) embedded model, which is kept to one side
const editorText = (spec: object) => {
  const { model, ...rest } = spec as AssetSpec;
  return JSON.stringify(rest, null, 2);
};

type Parsed = { value?: any; parseError?: string };
const parse = (text: string): Parsed => {
  try {
    return { value: JSON.parse(extractJson(text)) };
  } catch (err) {
    return { parseError: err instanceof Error ? err.message.replace(/^JSON\.parse: /, '') : 'Not valid JSON.' };
  }
};

// --- Live preview ---

const Preview = ({ spec, night }: { spec: AssetSpec | null; night: boolean }) => {
  const footprint = spec?.footprint ?? [1, 1];
  const limit = spec ? maxHeight(spec.tier, spec.footprint) : 3;
  const [w, d] = footprint;
  return (
    <Canvas shadows camera={{ position: [2.6 + w, 2.2 + limit / 2, 2.6 + d], fov: 40 }} dpr={[1, 1.5]}>
      <color attach="background" args={[night ? '#0b1120' : '#0c4a6e']} />
      <ambientLight intensity={night ? 0.15 : 0.6} color={night ? '#1e3a8a' : '#cceeff'} />
      <directionalLight position={[4, 8, 3]} intensity={night ? 0.3 : 2} color={night ? '#93c5fd' : '#fffbeb'} castShadow shadow-mapSize={[1024, 1024]} />
      {/* Ground: the footprint tiles on a patch of grass */}
      <mesh position={[0, -0.26, 0]} receiveShadow>
        <boxGeometry args={[w + 2, 0.5, d + 2]} />
        <meshStandardMaterial color={night ? '#064e3b' : '#10b981'} roughness={1} />
      </mesh>
      <mesh position={[0, -0.005, 0]} receiveShadow>
        <boxGeometry args={[w, 0.02, d]} />
        <meshStandardMaterial color="#d1d5db" roughness={1} />
        <Edges color="#475569" />
      </mesh>
      {/* Height limit */}
      <mesh position={[0, limit / 2, 0]} raycast={() => null}>
        <boxGeometry args={[w, limit, d]} />
        <meshBasicMaterial transparent opacity={0} depthWrite={false} />
        <Edges color="#22d3ee" />
      </mesh>
      {spec && <AssetModel spec={spec} night={night ? 1 : 0} />}
      <OrbitControls makeDefault target={[0, Math.min(limit, 2) / 2, 0]} enablePan={false} minDistance={1.5} maxDistance={14} />
    </Canvas>
  );
};

// --- Studio ---

const AssetStudio: React.FC<AssetStudioProps> = ({ library, onLibraryChanged, onClose }) => {
  const [key, setKey] = useState<string | null>(null); // Library entry being edited (null = new, unsaved)
  const [text, setText] = useState(() => editorText(STARTER_ASSET));
  const [model, setModel] = useState<{ glb: string } | undefined>(undefined);
  const [terms, setTerms] = useState<AssetTerms>(DEFAULT_TERMS);
  const [night, setNight] = useState(false);
  const [status, setStatus] = useState<{ text: string; tone: 'good' | 'bad' } | null>(null);
  const [lastGood, setLastGood] = useState<AssetSpec | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  const parsed = useMemo(() => parse(text), [text]);
  const result = useMemo(
    () => (parsed.value !== undefined ? validateAsset(model ? { ...parsed.value, model } : parsed.value) : null),
    [parsed, model],
  );
  useEffect(() => { if (result?.asset) setLastGood(result.asset); }, [result]);

  const flash = (t: string, tone: 'good' | 'bad' = 'good') => {
    setStatus({ text: t, tone });
    setTimeout(() => setStatus(s => (s?.text === t ? null : s)), 2500);
  };

  // Quick fields edit the JSON in place
  const patch = (change: (v: any) => void) => {
    if (parsed.value === undefined) return;
    const v = JSON.parse(JSON.stringify(parsed.value));
    change(v);
    setText(JSON.stringify(v, null, 2));
  };

  const open = (entry: LibraryEntry | null) => {
    if (!entry) {
      setKey(null);
      setText(editorText(STARTER_ASSET));
      setModel(undefined);
      setTerms(DEFAULT_TERMS);
      return;
    }
    const spec = library.versions[entry.id];
    if (!spec) return;
    setKey(entry.key);
    setText(editorText(spec));
    setModel(spec.model);
    setTerms(entry.terms);
  };

  const save = async (asNew = false) => {
    if (!result?.asset) { flash('Fix the errors before saving.', 'bad'); return; }
    const entry = await saveAsset(result.asset, terms, asNew ? undefined : key ?? undefined);
    setKey(entry.key);
    await onLibraryChanged();
    flash(asNew ? 'Saved as a copy.' : library.persistent ? 'Saved to your library.' : 'Saved for this visit (this browser blocks storage).');
  };

  const remove = async () => {
    if (!key) return;
    const entry = library.entries.find(e => e.key === key);
    if (!window.confirm(`Delete "${entry ? library.versions[entry.id]?.name : 'this asset'}" from your library? Monuments already built keep their look.`)) return;
    await deleteAsset(key);
    await onLibraryChanged();
    open(null);
    flash('Deleted.');
  };

  const importFile = async (file: File | undefined) => {
    if (!file) return;
    try {
      if (file.name.toLowerCase().endsWith('.glb')) {
        const glb = toBase64(await file.arrayBuffer());
        const problem = checkGlb(glb);
        if (problem) { flash(problem, 'bad'); return; }
        setKey(null);
        setModel({ glb });
        setText(JSON.stringify({ ...editorTextObject(file.name.replace(/\.glb$/i, '')), parts: [] }, null, 2));
        flash('Model imported. Set the tier and footprint, then save.');
      } else {
        const raw = JSON.parse(extractJson(await file.text()));
        setKey(null);
        setModel(typeof raw?.model?.glb === 'string' ? { glb: raw.model.glb } : undefined);
        setText(editorText(raw));
        flash('Imported. Check it, then save it to your library.');
      }
    } catch {
      flash('Could not read that file. Use a .json asset or a .glb model.', 'bad');
    } finally {
      if (fileInput.current) fileInput.current.value = '';
    }
  };

  const copyPrompt = async () => {
    try {
      await navigator.clipboard.writeText(aiPrompt());
      flash('Prompt copied. Paste it into ChatGPT or Claude, describe your landmark, then paste the reply here.');
    } catch {
      download('skymetropolis-asset-prompt.txt', aiPrompt(), 'text/plain');
    }
  };

  const shown = result?.asset ?? lastGood;
  const value = parsed.value;
  const tier: AssetTier = value?.tier === 'grand' ? 'grand' : 'monument';
  const fp: [number, number] = Array.isArray(value?.footprint) ? [value.footprint[0] || 1, value.footprint[1] || 1] : [1, 1];
  const stats = monumentStats(tier, fp);
  const shapes = result?.asset ? expandParts(result.asset.parts).length : 0;

  return (
    <div className="absolute inset-0 z-50 flex flex-col bg-slate-950/95 text-white font-sans">
      {/* Header */}
      <div className="flex items-center gap-2 px-3 md:px-5 py-2.5 border-b border-slate-800 bg-slate-900/90">
        <h1 className="text-lg md:text-xl font-black bg-gradient-to-br from-white via-cyan-200 to-violet-300 bg-clip-text text-transparent mr-auto">Asset Studio</h1>
        <button onClick={() => download('skymetropolis-asset-skill.md', skillFile(), 'text/markdown')} title="Instructions an AI can follow to design assets (works as a Claude Skill or pasted into ChatGPT)" className="flex items-center gap-1.5 text-xs font-bold px-2.5 py-1.5 rounded-lg bg-violet-600/80 hover:bg-violet-500 border border-violet-400/40">
          <DownloadIcon className="w-3.5 h-3.5" /> AI skill file
        </button>
        <button onClick={copyPrompt} title="Copy a ready-made prompt for ChatGPT or Claude" className="text-xs font-bold px-2.5 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 border border-slate-600">Copy AI prompt</button>
        <button onClick={onClose} aria-label="Close the Asset Studio" className="p-1.5 rounded-lg hover:bg-slate-800"><CloseIcon className="w-5 h-5" /></button>
      </div>

      <div className="flex-1 min-h-0 flex flex-col lg:flex-row">
        {/* Library */}
        <aside className="lg:w-60 border-b lg:border-b-0 lg:border-r border-slate-800 flex flex-col min-h-0 max-h-48 lg:max-h-none">
          <div className="flex gap-1.5 p-2">
            <button onClick={() => open(null)} className="flex-1 text-xs font-bold py-1.5 rounded-md bg-cyan-600 hover:bg-cyan-500">New</button>
            <button onClick={() => fileInput.current?.click()} className="flex-1 flex items-center justify-center gap-1 text-xs font-bold py-1.5 rounded-md bg-slate-800 hover:bg-slate-700 border border-slate-600">
              <UploadIcon className="w-3.5 h-3.5" /> Import
            </button>
            <input ref={fileInput} type="file" accept=".json,.glb,application/json,model/gltf-binary" className="hidden" onChange={e => importFile(e.target.files?.[0])} />
          </div>
          <ul className="flex-1 overflow-y-auto px-2 pb-2 flex flex-col gap-1">
            {library.entries.length === 0 && <li className="text-[11px] text-slate-500 px-1 py-2">No assets yet. Edit the starter obelisk, ask an AI with the skill file, or import a .glb model.</li>}
            {library.entries.map(e => {
              const spec = library.versions[e.id];
              return (
                <li key={e.key}>
                  <button
                    onClick={() => open(e)}
                    className={`w-full text-left px-2.5 py-1.5 rounded-md text-xs border ${e.key === key ? 'bg-cyan-500/15 border-cyan-500/50' : 'border-transparent hover:bg-slate-800'}`}
                  >
                    <span className="block font-bold truncate">{spec?.name ?? 'Missing asset'}</span>
                    <span className="block text-[10px] text-slate-400">
                      {spec ? `${ASSET_TIERS[spec.tier].label} · ${spec.footprint[0]}×${spec.footprint[1]}${spec.model ? ' · model' : ''}` : ''}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
          {!library.persistent && <p className="text-[10px] text-amber-300/80 px-3 pb-2">This browser blocks storage: assets last until you close the page. Export them to keep them.</p>}
        </aside>

        {/* Preview */}
        <section className="relative flex-1 min-h-[260px]">
          <Preview spec={shown} night={night} />
          <div className="absolute top-2 left-2 flex gap-1.5">
            <button onClick={() => setNight(false)} className={`text-xs font-bold px-2.5 py-1 rounded-md border ${!night ? 'bg-amber-400 text-slate-900 border-amber-300' : 'bg-slate-900/80 border-slate-600'}`}>Day</button>
            <button onClick={() => setNight(true)} className={`text-xs font-bold px-2.5 py-1 rounded-md border ${night ? 'bg-indigo-500 border-indigo-300' : 'bg-slate-900/80 border-slate-600'}`}>Night</button>
          </div>
          <p className="absolute bottom-2 left-2 text-[10px] text-slate-300/80 bg-slate-900/70 px-2 py-1 rounded">Drag to orbit · the blue box is the height limit</p>
        </section>

        {/* Editor */}
        <section className="lg:w-[440px] border-t lg:border-t-0 lg:border-l border-slate-800 flex flex-col min-h-0">
          <div className="p-3 grid grid-cols-2 gap-2 border-b border-slate-800">
            <label className="col-span-2 text-[10px] font-bold uppercase tracking-widest text-slate-400">Name
              <input
                value={typeof value?.name === 'string' ? value.name : ''}
                disabled={value === undefined}
                maxLength={40}
                onChange={e => patch(v => { v.name = e.target.value; })}
                className="mt-1 block w-full bg-slate-800 text-sm font-bold normal-case tracking-normal text-white rounded-md px-2 py-1.5 border border-slate-600 disabled:opacity-50"
              />
            </label>
            <label className="text-[10px] font-bold uppercase tracking-widest text-slate-400">Tier
              <select value={tier} disabled={value === undefined} onChange={e => patch(v => { v.tier = e.target.value; })} className="mt-1 block w-full bg-slate-800 text-sm normal-case tracking-normal text-white rounded-md px-2 py-1.5 border border-slate-600">
                {(Object.keys(ASSET_TIERS) as AssetTier[]).map(t => <option key={t} value={t}>{ASSET_TIERS[t].label}</option>)}
              </select>
            </label>
            <label className="text-[10px] font-bold uppercase tracking-widest text-slate-400">Footprint (tiles)
              <span className="mt-1 flex items-center gap-1">
                {[0, 1].map(i => (
                  <select key={i} value={fp[i]} disabled={value === undefined} onChange={e => patch(v => { const f = [fp[0], fp[1]]; f[i] = Number(e.target.value); v.footprint = f; })} className="flex-1 bg-slate-800 text-sm normal-case tracking-normal text-white rounded-md px-2 py-1.5 border border-slate-600">
                    {Array.from({ length: MAX_FOOTPRINT }, (_, n) => <option key={n + 1} value={n + 1}>{n + 1}</option>)}
                  </select>
                ))}
              </span>
            </label>
            <p className="col-span-2 text-[11px] text-slate-400">
              Build ${stats.cost.toLocaleString()} · tourism ${stats.tourism}/day · +{stats.popGen} move-ins/day · upkeep ${stats.upkeep}/day · up to {maxHeight(tier, fp)} tall
            </p>
          </div>

          {model && (
            <div className="mx-3 mt-2 flex items-center gap-2 text-[11px] px-2 py-1.5 rounded-md bg-violet-500/10 border border-violet-500/30">
              <span className="flex-1">Imported .glb model ({(model.glb.length * 0.75 / 1024).toFixed(0)} KB), scaled to fit the footprint</span>
              <button onClick={() => setModel(undefined)} className="font-bold text-violet-200 hover:text-white">Remove</button>
            </div>
          )}

          <label className="sr-only" htmlFor="asset-json">Asset JSON</label>
          <textarea
            id="asset-json"
            value={text}
            onChange={e => setText(e.target.value)}
            spellCheck={false}
            className="flex-1 min-h-[180px] m-3 mb-0 p-2.5 font-mono text-[11px] leading-relaxed bg-slate-900 text-slate-100 rounded-lg border border-slate-700 focus:outline-none focus:ring-2 focus:ring-cyan-500/40 resize-none"
            placeholder="Paste the JSON from ChatGPT or Claude here"
          />

          <div className="px-3 py-2 text-[11px] max-h-28 overflow-y-auto" aria-live="polite">
            {parsed.parseError && <p className="text-red-400">Not valid JSON yet: {parsed.parseError}</p>}
            {result?.errors.map((e, i) => <p key={i} className="text-red-400">✕ {e}</p>)}
            {result?.warnings.map((w, i) => <p key={i} className="text-amber-300">! {w}</p>)}
            {result?.asset && <p className="text-emerald-300">✓ Ready · {shapes} shapes{result.asset.model ? ' + model' : ''}</p>}
          </div>

          {/* Licence terms */}
          <div className="px-3 pb-2 grid grid-cols-3 gap-2 border-t border-slate-800 pt-2">
            <span className="col-span-3 text-[10px] font-bold uppercase tracking-widest text-slate-400">Licence terms when friends buy it (co-op)</span>
            <label className="text-[10px] text-slate-400">Price ($)
              <input type="number" min={0} value={terms.price} onChange={e => setTerms(t => ({ ...t, price: Math.max(0, Number(e.target.value) || 0) }))} className="mt-1 block w-full bg-slate-800 text-sm text-white rounded-md px-2 py-1 border border-slate-600" />
            </label>
            <label className="text-[10px] text-slate-400">Lasts
              <select value={terms.days} onChange={e => setTerms(t => ({ ...t, days: Number(e.target.value) }))} className="mt-1 block w-full bg-slate-800 text-sm text-white rounded-md px-2 py-1 border border-slate-600">
                {LICENCE_DAY_OPTIONS.map(d => <option key={d} value={d}>{d} days ({d / 30} mo)</option>)}
              </select>
            </label>
            <label className="text-[10px] text-slate-400">Profit share
              <span className="mt-1 flex items-center gap-1">
                <input type="number" min={0} max={MAX_PROFIT_SHARE} value={terms.share} onChange={e => setTerms(t => ({ ...t, share: Math.min(MAX_PROFIT_SHARE, Math.max(0, Number(e.target.value) || 0)) }))} className="w-full bg-slate-800 text-sm text-white rounded-md px-2 py-1 border border-slate-600" />
                <span className="text-slate-400">%</span>
              </span>
            </label>
          </div>

          <div className="flex flex-wrap items-center gap-1.5 p-3 border-t border-slate-800">
            <button onClick={() => save()} className="text-xs font-bold px-3 py-1.5 rounded-md bg-emerald-600 hover:bg-emerald-500">{key ? 'Save' : 'Save to library'}</button>
            {key && <button onClick={() => save(true)} className="text-xs font-bold px-3 py-1.5 rounded-md bg-slate-800 hover:bg-slate-700 border border-slate-600">Save as copy</button>}
            <button
              onClick={() => result?.asset && download(`${slug(result.asset.name)}.skymetro-asset.json`, JSON.stringify(result.asset, null, 2))}
              disabled={!result?.asset}
              className="text-xs font-bold px-3 py-1.5 rounded-md bg-slate-800 hover:bg-slate-700 border border-slate-600 disabled:opacity-40"
            >Export</button>
            {key && <button onClick={remove} className="text-xs font-bold px-3 py-1.5 rounded-md bg-slate-800 hover:bg-red-700/70 border border-slate-600">Delete</button>}
            {status && <span className={`text-[11px] ml-auto ${status.tone === 'good' ? 'text-emerald-300' : 'text-red-400'}`} role="status">{status.text}</span>}
          </div>
        </section>
      </div>
    </div>
  );
};

// Fields for a freshly imported model
const editorTextObject = (name: string) => ({
  format: STARTER_ASSET.format, version: STARTER_ASSET.version, name: name.slice(0, 40) || 'Imported model',
  description: '', tier: 'monument', footprint: [1, 1],
});

export default AssetStudio;
