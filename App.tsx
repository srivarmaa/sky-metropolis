/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
*/
import React, { useState, useEffect, useCallback, useRef } from 'react';
import { Grid, BuildingType, CityStats, AIGoal, NewsItem, EconomyReport, TileData, CoopCity } from './types';
import { GRID_SIZE, TICK_RATE_MS, INITIAL_MONEY } from './constants';
import IsoMap from './components/IsoMap';
import UIOverlay from './components/UIOverlay';
import StartScreen from './components/StartScreen';
import CoopLobby from './components/CoopLobby';
import { generateCityGoal, generateNewsEvent, isAiAvailable } from './services/geminiService';
import { createEmptyGrid, downloadLayout } from './services/layoutFile';
import { computeEconomy, computePopulation, findCityProblems, CityProblem, CITY_PROBLEM_NEWS, EMPTY_ECONOMY } from './services/economy';
import { analyzeCity } from './services/city';
import { tryBuild } from './services/build';
import { useCoopGame } from './services/coop/useCoopGame';
import { bridgeIsLinked } from './services/coop/hostSim';

const newsId = () => `${Date.now()}.${Math.random().toString().slice(2)}`;

function App() {
  // --- Game State ---
  const [gameStarted, setGameStarted] = useState(false);
  const [aiEnabled, setAiEnabled] = useState(isAiAvailable);

  const [grid, setGrid] = useState<Grid>(() => createEmptyGrid(GRID_SIZE));
  const [stats, setStats] = useState<CityStats>({ money: INITIAL_MONEY, population: 0, day: 1 });
  const [selectedTool, setSelectedTool] = useState<BuildingType>(BuildingType.Road);
  const [economy, setEconomy] = useState<EconomyReport>(EMPTY_ECONOMY);
  
  // --- AI State ---
  const [currentGoal, setCurrentGoal] = useState<AIGoal | null>(null);
  const [isGeneratingGoal, setIsGeneratingGoal] = useState(false);
  const [newsFeed, setNewsFeed] = useState<NewsItem[]>([]);
  
  // Refs for accessing state inside intervals without dependencies
  const gridRef = useRef(grid);
  const statsRef = useRef(stats);
  const goalRef = useRef(currentGoal);
  const aiEnabledRef = useRef(aiEnabled);
  const economyProblemsRef = useRef<CityProblem[]>([]);

  // Sync refs
  useEffect(() => { gridRef.current = grid; }, [grid]);
  useEffect(() => { statsRef.current = stats; }, [stats]);
  useEffect(() => { goalRef.current = currentGoal; }, [currentGoal]);
  useEffect(() => { aiEnabledRef.current = aiEnabled; }, [aiEnabled]);

  // --- AI Logic Wrappers ---

  const addNewsItem = useCallback((item: NewsItem) => {
    setNewsFeed(prev => [...prev.slice(-12), item]); // Keep last few
  }, []);

  // Map updates also refresh the ref right away, so several builds in a row see each other
  const setWorld = useCallback((g: Grid) => {
    gridRef.current = g;
    setGrid(g);
  }, []);
  const applyTiles = useCallback((tiles: TileData[]) => {
    const g = gridRef.current.map(row => row.slice());
    tiles.forEach(t => { if (g[t.y]?.[t.x]) g[t.y][t.x] = t; });
    setWorld(g);
  }, [setWorld]);

  // --- Co-op (River Cities) ---
  const [showLobby, setShowLobby] = useState(false);
  const coop = useCoopGame({
    getGrid: () => gridRef.current,
    setWorld,
    applyTiles,
    addNews: (text, kind) => addNewsItem({ id: newsId(), text, type: kind }),
    onStart: () => {
      setAiEnabled(false); // The AI advisor is solo-only for now
      setShowLobby(false);
      setGameStarted(true);
    },
  });
  const coopRef = useRef(coop);
  coopRef.current = coop;
  const fetchNewGoal = useCallback(async () => {
    if (isGeneratingGoal || !aiEnabledRef.current) return;
    setIsGeneratingGoal(true);
    // Short delay for visual effect
    await new Promise(r => setTimeout(r, 500));
    
    const newGoal = await generateCityGoal(statsRef.current, gridRef.current);
    if (newGoal) {
      setCurrentGoal(newGoal);
    } else {
      // Retry soon if failed, but only if AI still enabled
      if(aiEnabledRef.current) setTimeout(fetchNewGoal, 5000);
    }
    setIsGeneratingGoal(false);
  }, [isGeneratingGoal]); 

  const fetchNews = useCallback(async () => {
    // chance to fetch news per tick
    if (!aiEnabledRef.current || Math.random() > 0.15) return; 
    const news = await generateNewsEvent(statsRef.current, null);
    if (news) addNewsItem(news);
  }, [addNewsItem]);


  // --- Initial Setup ---
  useEffect(() => {
    if (!gameStarted) return;

    addNewsItem({ id: Date.now().toString(), text: "Welcome to SkyMetropolis. Terrain generation complete.", type: 'positive' });
    
    if (aiEnabled) {
      fetchNewGoal();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gameStarted]);


  // --- Game Loop ---
  useEffect(() => {
    if (!gameStarted) return;

    const intervalId = setInterval(() => {
      // Co-op: the host simulates every city; clients wait for its updates
      if (coopRef.current.active) {
        coopRef.current.hostTick();
        return;
      }

      // 1. Analyse the city (road access, pollution) and update population (limited by homes and jobs)
      const city = analyzeCity(gridRef.current);
      const buildingCounts = city.counts;

      // Population only changes here, so the ref is current
      const newPop = computePopulation(city, statsRef.current.population);

      // 2. Economy: income depends on workers, paying customers and traffic, minus road upkeep
      const report = computeEconomy(city, newPop);
      setEconomy(report);

      // Announce economy problems once, when they first appear
      const problems = findCityProblems(city, report, Math.max(0, statsRef.current.money + report.income));
      problems.filter(p => !economyProblemsRef.current.includes(p)).forEach(p => {
        addNewsItem({ id: newsId(), text: CITY_PROBLEM_NEWS[p], type: 'negative' });
      });
      economyProblemsRef.current = problems;

      // 3. Update Stats (the treasury can't go below zero; unpaid upkeep is just lost)
      setStats(prev => {
        const newStats = {
          money: Math.max(0, prev.money + report.income),
          population: newPop,
          day: prev.day + 1,
        };
        
        // 4. Check Goal Completion
        const goal = goalRef.current;
        if (aiEnabledRef.current && goal && !goal.completed) {
          let isMet = false;
          if (goal.targetType === 'money' && newStats.money >= goal.targetValue) isMet = true;
          if (goal.targetType === 'population' && newStats.population >= goal.targetValue) isMet = true;
          if (goal.targetType === 'building_count' && goal.buildingType) {
            if ((buildingCounts[goal.buildingType] || 0) >= goal.targetValue) isMet = true;
          }

          if (isMet) {
            setCurrentGoal({ ...goal, completed: true });
          }
        }

        return newStats;
      });

      // 5. Trigger news
      fetchNews();

    }, TICK_RATE_MS);

    return () => clearInterval(intervalId);
  }, [fetchNews, addNewsItem, gameStarted]);


  // --- Interaction Logic ---

  const handleTileClick = useCallback((x: number, y: number) => {
    if (!gameStarted) return; // Prevent clicking through start screen

    // Co-op: the host checks and applies every build (clients just send the request)
    if (coopRef.current.active) {
      coopRef.current.requestBuild(x, y, selectedTool);
      return;
    }

    // Bulldoze, roundabout upgrade or placement (see services/build.ts)
    const result = tryBuild(gridRef.current, statsRef.current.money, x, y, selectedTool, null);
    if (!result.ok) {
      if (result.reason) addNewsItem({ id: newsId(), text: result.reason, type: 'negative' });
      return;
    }
    applyTiles([result.tile]);
    setStats(prev => ({ ...prev, money: prev.money - result.cost }));
  }, [selectedTool, addNewsItem, gameStarted, applyTiles]);

  const handleClaimReward = () => {
    if (currentGoal && currentGoal.completed) {
      setStats(prev => ({ ...prev, money: prev.money + currentGoal.reward }));
      addNewsItem({id: Date.now().toString(), text: `Goal achieved! ${currentGoal.reward} deposited to treasury.`, type: 'positive'});
      setCurrentGoal(null);
      fetchNewGoal();
    }
  };

  // The grid (chosen size or uploaded layout) is already set by the start screen preview
  const handleStart = (enabled: boolean, savedStats: CityStats | null) => {
    if (savedStats) setStats(savedStats);
    setAiEnabled(enabled);
    setGameStarted(true);
  };

  // In co-op, the stats bar shows your own city as simulated by the host
  const myCity = coop.active && coop.mySlot !== null ? coop.cities[coop.mySlot] : undefined;
  const shownStats = myCity?.stats ?? stats;
  const shownEconomy = myCity?.economy ?? economy;
  // Traffic and pedestrians on the map reflect every city
  const allCities = Object.values(coop.cities) as CoopCity[];
  const mapPopulation = coop.active ? allCities.reduce((n, c) => n + c.stats.population, 0) : stats.population;
  const mapCommuters = coop.active ? allCities.reduce((n, c) => n + c.economy.workers, 0) : economy.workers;

  // Co-op saves the whole world (every city) so the group can continue it later from the lobby
  const handleSaveLayout = useCallback(() => {
    if (coopRef.current.active) coopRef.current.exportSave();
    else downloadLayout(gridRef.current, statsRef.current);
  }, []);

  const backToSoloMenu = () => {
    setShowLobby(false);
    setWorld(createEmptyGrid(GRID_SIZE));
  };

  return (
    <div className="relative w-screen h-screen overflow-hidden selection:bg-transparent selection:text-transparent bg-sky-900">
      {/* 3D Rendering Layer - Always visible now, providing background for start screen */}
      <IsoMap
        grid={grid}
        onTileClick={handleTileClick}
        hoveredTool={selectedTool}
        population={mapPopulation}
        commuters={mapCommuters}
        coop={coop.active && coop.mySlot !== null
          ? {
              mySlot: coop.mySlot, plotSize: coop.plotSize, players: coop.players, cursors: coop.cursors,
              pendingBridges: coop.proposals.flatMap(p => (p.deal.kind === 'bridge' ? [p.deal.tiles] : [])),
            }
          : undefined}
        onHoverTile={coop.active ? coop.sendCursor : undefined}
      />

      {/* Start Screen / Co-op lobby */}
      {!gameStarted && (showLobby ? (
        <CoopLobby coop={coop} onBack={backToSoloMenu} />
      ) : (
        <StartScreen
          onStart={handleStart}
          aiAvailable={isAiAvailable}
          defaultGridSize={GRID_SIZE}
          onPreviewGrid={setWorld}
          onPlayWithFriends={() => setShowLobby(true)}
        />
      ))}

      {/* UI Layer */}
      {gameStarted && (
        <UIOverlay
          stats={shownStats}
          selectedTool={selectedTool}
          onSelectTool={setSelectedTool}
          currentGoal={currentGoal}
          newsFeed={newsFeed}
          onClaimReward={handleClaimReward}
          isGeneratingGoal={isGeneratingGoal}
          aiEnabled={aiEnabled}
          onSaveLayout={handleSaveLayout}
          economy={shownEconomy}
          coop={coop.active && coop.mySlot !== null
            ? {
                roomCode: coop.roomCode, players: coop.players, cities: coop.cities, mySlot: coop.mySlot, isHost: coop.role === 'host',
                deals: {
                  mySlot: coop.mySlot,
                  players: coop.players,
                  proposals: coop.proposals,
                  bridges: coop.bridges.map(b => ({ ...b, linked: bridgeIsLinked(grid, b) })),
                  clockOffset: coop.clockOffset,
                  economy: shownEconomy,
                  onRespond: coop.respond,
                  onCancel: coop.cancel,
                  onPropose: coop.propose,
                },
              }
            : undefined}
        />
      )}

      {/* The host left: the world stays on screen and can be saved */}
      {coop.phase === 'ended' && (
        <div className="absolute inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-6">
          <div className="max-w-sm w-full bg-slate-900/95 border border-slate-700 rounded-2xl p-6 text-white shadow-2xl text-center" role="alertdialog" aria-labelledby="host-left-title">
            <h2 id="host-left-title" className="text-xl font-black mb-2">The host left the room</h2>
            <p className="text-sm text-slate-400 mb-5">The game has ended. Download the world to continue it later: anyone can host it again from Play with Friends → Load saved world.</p>
            <div className="flex flex-col gap-2">
              <button onClick={handleSaveLayout} className="w-full py-2.5 rounded-lg bg-cyan-600 hover:bg-cyan-500 font-bold">Download world</button>
              <button onClick={() => window.location.reload()} className="w-full py-2.5 rounded-lg bg-slate-700 hover:bg-slate-600 font-bold">Back to menu</button>
            </div>
          </div>
        </div>
      )}

      {/* CSS for animations and utility */}
      <style>{`
        @keyframes fade-in { from { opacity: 0; transform: translateX(-10px); } to { opacity: 1; transform: translateX(0); } }
        .animate-fade-in { animation: fade-in 0.4s cubic-bezier(0.16, 1, 0.3, 1) forwards; }
        
        .mask-image-b { -webkit-mask-image: linear-gradient(to bottom, transparent 0%, black 15%); mask-image: linear-gradient(to bottom, transparent 0%, black 15%); }
        
        /* Vertical text for toolbar label */
        .writing-mode-vertical { writing-mode: vertical-rl; text-orientation: mixed; }
        
        /* Custom scrollbar for news */
        ::-webkit-scrollbar { width: 4px; }
        ::-webkit-scrollbar-track { background: rgba(0,0,0,0.2); }
        ::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.2); border-radius: 2px; }
        ::-webkit-scrollbar-thumb:hover { background: rgba(255,255,255,0.3); }
      `}</style>
    </div>
  );
}

export default App;