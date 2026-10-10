/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
*/
import React, { useRef, useState } from 'react';
import { CityStats, Grid } from '../types';
import { GRID_SIZE_OPTIONS, SavedLayout, createEmptyGrid, parseLayout } from '../services/layoutFile';
import { CloseIcon, FileCheckIcon, UploadIcon } from './Icons';

interface StartScreenProps {
  onStart: (aiEnabled: boolean, savedStats: CityStats | null) => void;
  aiAvailable: boolean;
  defaultGridSize: number;
  // Shows the chosen map behind the menu
  onPreviewGrid: (grid: Grid) => void;
  onPlayWithFriends: () => void;
}

const StartScreen: React.FC<StartScreenProps> = ({ onStart, aiAvailable, defaultGridSize, onPreviewGrid, onPlayWithFriends }) => {
  const [aiEnabled, setAiEnabled] = useState(aiAvailable);
  const [gridSize, setGridSize] = useState(defaultGridSize);
  const [uploaded, setUploaded] = useState<{ name: string; layout: SavedLayout } | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const sizeOptions = Array.from(new Set([...GRID_SIZE_OPTIONS, defaultGridSize])).sort((a, b) => a - b);

  const handleSizeChange = (size: number) => {
    setGridSize(size);
    setUploaded(null);
    setUploadError(null);
    onPreviewGrid(createEmptyGrid(size));
  };

  const handleFile = async (file: File | undefined) => {
    if (!file) return;
    try {
      const layout = parseLayout(await file.text());
      setUploaded({ name: file.name, layout });
      setUploadError(null);
      onPreviewGrid(layout.grid);
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : 'Could not read this file.');
    } finally {
      // Allow re-selecting the same file after an error
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const clearUpload = () => {
    setUploaded(null);
    onPreviewGrid(createEmptyGrid(gridSize));
  };

  return (
    <div className="absolute inset-0 flex flex-col items-center overflow-y-auto z-50 text-white font-sans p-6 bg-black/30 backdrop-blur-sm transition-all duration-1000">
      <div className="my-auto max-w-md w-full bg-slate-900/90 p-8 rounded-2xl border border-slate-700 shadow-2xl backdrop-blur-xl relative overflow-hidden animate-fade-in">
        {/* Decorative background glow */}
        <div className="absolute -top-24 -right-24 w-48 h-48 bg-cyan-500/20 rounded-full blur-3xl pointer-events-none"></div>
        <div className="absolute -bottom-24 -left-24 w-48 h-48 bg-indigo-500/20 rounded-full blur-3xl pointer-events-none"></div>
        
        <div className="relative z-10">
            <h1 className="text-5xl font-black mb-2 bg-gradient-to-br from-white via-cyan-200 to-blue-400 bg-clip-text text-transparent tracking-tight">
            SkyMetropolis
            </h1>
            <p className="text-slate-400 mb-8 text-sm font-medium uppercase tracking-widest">
            Isometric City Builder
            </p>

            {/* Map: grid size or uploaded layout */}
            <div className="bg-slate-800/50 p-5 rounded-xl border border-slate-700/50 mb-4 shadow-inner">
              <div className="flex items-center justify-between gap-4">
                <div className="flex flex-col gap-1">
                  <span className="font-bold text-base text-slate-200">Map Size</span>
                  <span className="text-xs text-slate-500">
                    {uploaded ? `From layout: ${uploaded.layout.grid.length} × ${uploaded.layout.grid.length}` : `${gridSize} × ${gridSize} tiles`}
                  </span>
                </div>
                <select
                  value={uploaded ? '' : gridSize}
                  onChange={(e) => handleSizeChange(Number(e.target.value))}
                  className="bg-slate-700 text-slate-100 text-sm font-bold rounded-lg px-3 py-2 border border-slate-600 focus:outline-none focus:ring-2 focus:ring-cyan-500/40 cursor-pointer"
                >
                  {uploaded && <option value="" disabled>Layout</option>}
                  {sizeOptions.map(size => <option key={size} value={size}>{size} × {size}</option>)}
                </select>
              </div>

              <div className="mt-4 pt-4 border-t border-slate-700/50">
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".json,application/json"
                  className="hidden"
                  onChange={(e) => handleFile(e.target.files?.[0])}
                />
                {uploaded ? (
                  <div className="flex items-center gap-3 px-3 py-2 rounded-lg bg-cyan-500/10 border border-cyan-500/30">
                    <FileCheckIcon className="w-4 h-4 text-cyan-300 flex-shrink-0" />
                    <div className="flex flex-col min-w-0 flex-1">
                      <span className="text-xs font-bold text-cyan-100 truncate" title={uploaded.name}>{uploaded.name}</span>
                      {uploaded.layout.stats && (
                        <span className="text-[10px] text-cyan-300/80">Day {uploaded.layout.stats.day} · ${uploaded.layout.stats.money.toLocaleString()}</span>
                      )}
                    </div>
                    <button
                      onClick={clearUpload}
                      title="Remove layout"
                      aria-label="Remove layout"
                      className="p-1.5 rounded-md text-slate-400 hover:text-white hover:bg-slate-700/60 transition-colors flex-shrink-0"
                    >
                      <CloseIcon className="w-4 h-4" />
                    </button>
                  </div>
                ) : (
                  <button
                    onClick={() => fileInputRef.current?.click()}
                    className="w-full flex items-center justify-center gap-2 py-2.5 text-sm font-bold text-slate-200 bg-slate-700/40 hover:bg-slate-700/70 hover:text-white border border-dashed border-slate-500 hover:border-cyan-500/60 rounded-lg transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan-500/40"
                  >
                    <UploadIcon className="w-4 h-4" />
                    Upload Layout
                    <span className="text-[10px] font-mono font-normal text-slate-400">.json</span>
                  </button>
                )}
                {uploadError && <p className="mt-2 text-xs text-red-400">{uploadError}</p>}
              </div>
            </div>

            <div className="bg-slate-800/50 p-5 rounded-xl border border-slate-700/50 mb-8 hover:border-slate-600 transition-colors shadow-inner">
            <label className={`flex items-center justify-between group ${aiAvailable ? 'cursor-pointer' : 'opacity-50 cursor-not-allowed'}`}>
                <div className="flex flex-col gap-1">
                <span className="font-bold text-base text-slate-200 group-hover:text-white transition-colors flex items-center gap-2">
                    AI City Advisor
                    {aiEnabled && <span className="flex h-2 w-2 rounded-full bg-cyan-400 animate-pulse"></span>}
                </span>
                <span className="text-xs text-slate-500 group-hover:text-slate-400 transition-colors">
                    {aiAvailable ? 'Enable dynamic quests & news events via Gemini API' : 'Unavailable — no Gemini API key configured'}
                </span>
                </div>
                
                <div className="relative flex-shrink-0 ml-4">
                <input 
                    type="checkbox" 
                    className="sr-only peer"
                    checked={aiEnabled}
                    disabled={!aiAvailable}
                    onChange={(e) => setAiEnabled(e.target.checked)}
                />
                <div className="w-11 h-6 bg-slate-700 rounded-full peer peer-focus:ring-2 peer-focus:ring-cyan-500/40 peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-slate-300 after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-cyan-600 peer-checked:after:bg-white"></div>
                </div>
            </label>
            </div>

            <button 
            onClick={() => onStart(aiAvailable && aiEnabled, uploaded?.layout.stats ?? null)}
            className="w-full py-4 bg-gradient-to-r from-cyan-600 to-blue-600 hover:from-cyan-500 hover:to-blue-500 text-white font-bold rounded-xl shadow-lg shadow-cyan-900/20 transform transition-all hover:scale-[1.02] active:scale-[0.98] text-lg tracking-wide"
            >
            {uploaded ? 'Continue Building' : 'Start Building'}
            </button>

            <button
              onClick={onPlayWithFriends}
              className="mt-3 w-full py-3 bg-slate-800/70 hover:bg-slate-700/80 text-cyan-100 font-bold rounded-xl border border-cyan-500/30 hover:border-cyan-400/60 transition-all tracking-wide"
            >
              Play with Friends
              <span className="block text-[10px] font-medium text-slate-400 uppercase tracking-widest mt-0.5">River Cities co-op</span>
            </button>

            <div className="mt-8 text-center">
                <a 
                    href="https://x.com/ammaar" 
                    target="_blank" 
                    rel="noreferrer" 
                    className="inline-flex items-center gap-2 text-xs text-slate-500 hover:text-cyan-400 transition-colors font-mono group"
                >
                    <span>Created by</span>
                    <span className="font-bold group-hover:underline decoration-cyan-500/50 underline-offset-2">@ammaar</span>
                </a>
            </div>
        </div>
      </div>
    </div>
  );
};

export default StartScreen;