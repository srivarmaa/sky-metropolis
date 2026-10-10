/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
*/
import React, { useState, useEffect, useCallback, useRef } from 'react';
import { Grid, BuildingType, CityStats, AIGoal, NewsItem, EconomyReport } from './types';
import { GRID_SIZE, BUILDINGS, TICK_RATE_MS, INITIAL_MONEY } from './constants';
import IsoMap from './components/IsoMap';
import UIOverlay from './components/UIOverlay';
import StartScreen from './components/StartScreen';
import { generateCityGoal, generateNewsEvent, isAiAvailable } from './services/geminiService';
import { createEmptyGrid, downloadLayout } from './services/layoutFile';
import { computeEconomy, computePopulation, findEconomyProblems, EconomyProblem, EMPTY_ECONOMY } from './services/economy';
import { analyzeCity } from './services/city';

type CityProblem = EconomyProblem | 'treasury_empty';

const ECONOMY_PROBLEM_NEWS: Record<CityProblem, string> = {
  idle_factories: 'Factories are idle: no workers. Build houses to bring in citizens.',
  shops_no_customers: 'Shops have no paying customers. Citizens need jobs before they can spend.',
  no_road_access: 'Some buildings have no road next to them and sit empty. Connect them with a road.',
  traffic_jam: 'Traffic jams! Commuters are clogging the roads and factory deliveries are slowing down. Build more roads.',
  pollution: 'Factory smog is driving families out of nearby houses. A park next to those homes cleans the air.',
  treasury_empty: 'The treasury is empty: road and signal upkeep is going unpaid. Grow income or bulldoze unused roads.',
};

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
      // 1. Analyse the city (road access, pollution) and update population (limited by homes and jobs)
      const city = analyzeCity(gridRef.current);
      const buildingCounts = city.counts;

      // Population only changes here, so the ref is current
      const newPop = computePopulation(city, statsRef.current.population);

      // 2. Economy: income depends on workers, paying customers and traffic, minus road upkeep
      const report = computeEconomy(city, newPop);
      setEconomy(report);

      // Announce economy problems once, when they first appear
      const problems: CityProblem[] = findEconomyProblems(city, report);
      if (statsRef.current.money + report.income <= 0 && report.income < 0) problems.push('treasury_empty');
      problems.filter(p => !economyProblemsRef.current.includes(p)).forEach(p => {
        addNewsItem({ id: Date.now().toString() + Math.random(), text: ECONOMY_PROBLEM_NEWS[p], type: 'negative' });
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

    const currentGrid = gridRef.current;
    const currentStats = statsRef.current;
    const tool = selectedTool; // Capture current tool
    
    if (y < 0 || y >= currentGrid.length || x < 0 || x >= currentGrid[y].length) return;

    const currentTile = currentGrid[y][x];
    const buildingConfig = BUILDINGS[tool];

    // Bulldoze logic
    if (tool === BuildingType.None) {
      if (currentTile.buildingType !== BuildingType.None) {
        const demolishCost = 5;
        if (currentStats.money >= demolishCost) {
            const newGrid = currentGrid.map(row => [...row]);
            newGrid[y][x] = { ...currentTile, buildingType: BuildingType.None };
            setGrid(newGrid);
            setStats(prev => ({ ...prev, money: prev.money - demolishCost }));
            // Sound effect here
        } else {
            addNewsItem({id: Date.now().toString(), text: "Cannot afford demolition costs.", type: 'negative'});
        }
      }
      return;
    }

    // Upgrade an existing road to a roundabout, paying only the difference
    if (tool === BuildingType.Roundabout && currentTile.buildingType === BuildingType.Road) {
      const upgradeCost = buildingConfig.cost - BUILDINGS[BuildingType.Road].cost;
      if (currentStats.money >= upgradeCost) {
        setStats(prev => ({ ...prev, money: prev.money - upgradeCost }));
        const newGrid = currentGrid.map(row => [...row]);
        newGrid[y][x] = { ...currentTile, buildingType: tool };
        setGrid(newGrid);
      } else {
        addNewsItem({id: Date.now().toString() + Math.random(), text: `Treasury insufficient for a roundabout upgrade ($${upgradeCost}).`, type: 'negative'});
      }
      return;
    }

    // Placement Logic
    if (currentTile.buildingType === BuildingType.None) {
      if (currentStats.money >= buildingConfig.cost) {
        // Deduct cost
        setStats(prev => ({ ...prev, money: prev.money - buildingConfig.cost }));
        
        // Place building
        const newGrid = currentGrid.map(row => [...row]);
        newGrid[y][x] = { ...currentTile, buildingType: tool };
        setGrid(newGrid);
        // Sound effect here
      } else {
        // Not enough money feedback
        addNewsItem({id: Date.now().toString() + Math.random(), text: `Treasury insufficient for ${buildingConfig.name}.`, type: 'negative'});
      }
    }
  }, [selectedTool, addNewsItem, gameStarted]);

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

  const handleSaveLayout = useCallback(() => {
    downloadLayout(gridRef.current, statsRef.current);
  }, []);

  return (
    <div className="relative w-screen h-screen overflow-hidden selection:bg-transparent selection:text-transparent bg-sky-900">
      {/* 3D Rendering Layer - Always visible now, providing background for start screen */}
      <IsoMap 
        grid={grid} 
        onTileClick={handleTileClick} 
        hoveredTool={selectedTool}
        population={stats.population}
        commuters={economy.workers}
      />
      
      {/* Start Screen Overlay */}
      {!gameStarted && (
        <StartScreen onStart={handleStart} aiAvailable={isAiAvailable} defaultGridSize={GRID_SIZE} onPreviewGrid={setGrid} />
      )}

      {/* UI Layer */}
      {gameStarted && (
        <UIOverlay
          stats={stats}
          selectedTool={selectedTool}
          onSelectTool={setSelectedTool}
          currentGoal={currentGoal}
          newsFeed={newsFeed}
          onClaimReward={handleClaimReward}
          isGeneratingGoal={isGeneratingGoal}
          aiEnabled={aiEnabled}
          onSaveLayout={handleSaveLayout}
          economy={economy}
        />
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