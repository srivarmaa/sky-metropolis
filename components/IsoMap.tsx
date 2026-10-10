/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
*/
import React, { useState, useMemo, useRef, useEffect, useCallback } from 'react';
import { Canvas, useFrame, useThree, ThreeElements } from '@react-three/fiber';
import { MapControls, Environment, SoftShadows, Instance, Instances, Float, useTexture, Outlines, OrthographicCamera, PerspectiveCamera, Billboard, Html } from '@react-three/drei';
import * as THREE from 'three';
import { MathUtils } from 'three';
import { Grid, BuildingType, TileData, CoopPlayer } from '../types';
import { plotRects, plotCenter } from '../services/coop/world';
import { BUILDINGS } from '../constants';
import { tileHash, getHouseStyle } from '../services/houses';
import {
  isRoadType, isRoadAt, roadConnections, hasSignals, signalLamp, LAMP_RED, LAMP_GREEN, SIDES, SIDE_DIRS, Side,
  daylight, sunHeight, timeOfDay, buildPedestrianGraph, PedEdge,
} from '../services/roads';
import { needsRoad, buildingHasRoad, isPolluted } from '../services/city';
import { placementProblem, footprintTiles } from '../services/build';
import { AssetSpec, rotateFootprint } from '../services/assets/spec';
import { AssetModel, Placeholder } from './AssetModel';
import {
  TopViewIcon, PerspectiveIcon, RotateLeftIcon, RotateRightIcon, WalkIcon, CloseIcon,
  ChevronUpIcon, ChevronDownIcon, ChevronLeftIcon, ChevronRightIcon,
} from './Icons';

// Fix for TypeScript not recognizing R3F elements in JSX
declare global {
  namespace JSX {
    interface IntrinsicElements extends ThreeElements {}
  }
}

// --- Constants & Helpers ---
// The grid is centred on the world origin; `size` is the grid's width (grids are square)
const gridToWorld = (x: number, y: number, size: number) => {
  const offset = size / 2 - 0.5;
  return [x - offset, 0, y - offset] as [number, number, number];
};

// Deterministic random based on coordinates (shared with the game loop, which reads house capacity from it)
const getHash = tileHash;
const getRandomRange = (min: number, max: number) => Math.random() * (max - min) + min;

// Shared Geometries
const boxGeo = new THREE.BoxGeometry(1, 1, 1);
const cylinderGeo = new THREE.CylinderGeometry(1, 1, 1, 8);
const coneGeo = new THREE.ConeGeometry(1, 1, 4);
const sphereGeo = new THREE.SphereGeometry(1, 8, 8);

// Shared materials whose glow follows the day/night cycle (animated in DayNightCycle)
const WINDOW_DAY = new THREE.Color('#bfdbfe');
const WINDOW_NIGHT = new THREE.Color('#fcd34d');
const HEADLIGHT_DAY = new THREE.Color('#9ca3af');
const HEADLIGHT_NIGHT = new THREE.Color('#fffbeb').multiplyScalar(2);
const windowMat = new THREE.MeshStandardMaterial({ color: '#bfdbfe', emissive: WINDOW_DAY, emissiveIntensity: 0.2, roughness: 0.1, metalness: 0.8 });
const streetLampMat = new THREE.MeshStandardMaterial({ color: '#fef3c7', emissive: '#fde68a', emissiveIntensity: 0.3, toneMapped: false });
const lampPoolMat = new THREE.MeshBasicMaterial({ color: '#fde68a', transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending });
const headlightMat = new THREE.MeshBasicMaterial({ color: HEADLIGHT_DAY.clone(), toneMapped: false });
// Co-op river and lake; shimmers gently and darkens at night (see DayNightCycle)
const WATER_DAY = new THREE.Color('#38bdf8');
const WATER_NIGHT = new THREE.Color('#0c1e3a');
const waterMat = new THREE.MeshStandardMaterial({ color: WATER_DAY.clone(), roughness: 0.08, metalness: 0.35, transparent: true, opacity: 0.92 });

// --- 1. Advanced Procedural Buildings ---

// FIX: Wrap component in React.memo to ensure TypeScript recognizes it as a component that accepts a 'key' prop.
const WindowBlock = React.memo(({ position, scale }: { position: [number, number, number], scale: [number, number, number] }) => (
  <mesh geometry={boxGeo} material={windowMat} position={position} scale={scale} />
));

const SmokeStack = ({ position }: { position: [number, number, number] }) => {
  const ref = useRef<THREE.Group>(null);
  useFrame((state) => {
    if (ref.current) {
      ref.current.children.forEach((child, i) => {
        const cloud = child as THREE.Mesh;
        cloud.position.y += 0.01 + i * 0.005;
        cloud.scale.addScalar(0.005);
        
        const material = cloud.material as THREE.MeshStandardMaterial;
        if (material) {
          material.opacity -= 0.005;
          if (cloud.position.y > 1.5) {
            cloud.position.y = 0;
            cloud.scale.setScalar(0.1 + Math.random() * 0.1);
            material.opacity = 0.6;
          }
        }
      });
    }
  });

  return (
    <group position={position}>
      <mesh geometry={cylinderGeo} castShadow receiveShadow position={[0, 0.5, 0]} scale={[0.2, 1, 0.2]}>
        <meshStandardMaterial color="#4b5563" />
      </mesh>
      <group ref={ref} position={[0, 1, 0]}>
        {[0, 1, 2].map(i => (
          <mesh key={i} geometry={sphereGeo} position={[Math.random()*0.1, i*0.4, Math.random()*0.1]} scale={0.2}>
            <meshStandardMaterial color="#d1d5db" transparent opacity={0.6} flatShading />
          </mesh>
        ))}
      </group>
    </group>
  );
};

interface BuildingMeshProps {
  type: BuildingType;
  baseColor: string;
  x: number;
  y: number;
  opacity?: number;
  transparent?: boolean;
}

const ProceduralBuilding = React.memo(({ type, baseColor, x, y, opacity = 1, transparent = false }: BuildingMeshProps) => {
  const hash = getHash(x, y);
  const variant = Math.floor(hash * 100); // 0-99
  const rotation = Math.floor(hash * 4) * (Math.PI / 2);
  
  // Color variation
  const color = useMemo(() => {
    const c = new THREE.Color(baseColor);
    // Shift hue and lightness slightly based on hash
    c.offsetHSL(hash * 0.1 - 0.05, 0, hash * 0.2 - 0.1);
    return c;
  }, [baseColor, hash]);

  const mainMat = useMemo(() => new THREE.MeshStandardMaterial({ color, flatShading: true, opacity, transparent, roughness: 0.8 }), [color, opacity, transparent]);
  const accentMat = useMemo(() => new THREE.MeshStandardMaterial({ color: new THREE.Color(color).multiplyScalar(0.7), flatShading: true, opacity, transparent }), [color, opacity, transparent]);
  const roofMat = useMemo(() => new THREE.MeshStandardMaterial({ color: new THREE.Color(color).multiplyScalar(0.5).offsetHSL(0,0,-0.1), flatShading: true, opacity, transparent }), [color, opacity, transparent]);

  const commonProps = { castShadow: true, receiveShadow: true };

  // Buildings are built assuming y=0 is ground level within their group
  // Adjust vertical position to sit on top of ground tile (approx -0.3)
  const yOffset = -0.3;

  return (
    <group rotation={[0, rotation, 0]} position={[0, yOffset, 0]}>
      {(() => {
        switch (type) {
          case BuildingType.Residential: {
            // Style also sets capacity: Cottage 5, Boxy 8, Townhouse 10 (services/houses.ts)
            const style = getHouseStyle(x, y).name;
            if (style === 'Cozy Cottage') {
              // Cozy Cottage
              return (
                <>
                  <mesh {...commonProps} material={mainMat} geometry={boxGeo} position={[0, 0.3, 0]} scale={[0.7, 0.6, 0.6]} />
                  <mesh {...commonProps} material={roofMat} geometry={coneGeo} position={[0, 0.75, 0]} scale={[0.6, 0.4, 0.6]} rotation={[0, Math.PI/4, 0]} />
                  <WindowBlock position={[0.2, 0.3, 0.31]} scale={[0.15, 0.2, 0.05]} />
                  <WindowBlock position={[-0.2, 0.3, 0.31]} scale={[0.15, 0.2, 0.05]} />
                  <mesh {...commonProps} material={accentMat} geometry={boxGeo} position={[0, 0.1, 0.32]} scale={[0.15, 0.2, 0.05]} />
                </>
              );
            } else if (style === 'Modern Boxy') {
              // Modern Boxy
              return (
                <>
                  <mesh {...commonProps} material={mainMat} geometry={boxGeo} position={[-0.1, 0.35, 0]} scale={[0.6, 0.7, 0.8]} />
                  <mesh {...commonProps} material={accentMat} geometry={boxGeo} position={[0.25, 0.25, 0.1]} scale={[0.4, 0.5, 0.6]} />
                  <WindowBlock position={[-0.1, 0.5, 0.41]} scale={[0.4, 0.2, 0.05]} />
                </>
              );
            } else {
              // Townhouse
              return (
                <>
                  <mesh {...commonProps} material={mainMat} geometry={boxGeo} position={[0, 0.5, 0]} scale={[0.5, 1, 0.6]} />
                  <mesh {...commonProps} material={roofMat} geometry={boxGeo} position={[0, 1.05, 0]} scale={[0.55, 0.1, 0.65]} />
                  <WindowBlock position={[0, 0.7, 0.31]} scale={[0.3, 0.2, 0.05]} />
                  <WindowBlock position={[0, 0.3, 0.31]} scale={[0.3, 0.2, 0.05]} />
                </>
              );
            }
          }

          case BuildingType.Commercial:
            if (variant < 40) {
              // High-rise
              const height = 1.5 + hash * 1.5;
              return (
                <>
                  <mesh {...commonProps} material={mainMat} geometry={boxGeo} position={[0, height/2, 0]} scale={[0.7, height, 0.7]} />
                  {Array.from({ length: Math.floor(height * 3) }).map((_, i) => (
                    <WindowBlock key={i} position={[0, 0.2 + i * 0.3, 0]} scale={[0.72, 0.15, 0.72]} />
                  ))}
                  <mesh {...commonProps} material={accentMat} geometry={boxGeo} position={[0, height + 0.1, 0]} scale={[0.5, 0.2, 0.5]} />
                </>
              );
            } else if (variant < 70) {
              // Shop
              return (
                <>
                  <mesh {...commonProps} material={mainMat} geometry={boxGeo} position={[0, 0.4, 0]} scale={[0.9, 0.8, 0.8]} />
                  <WindowBlock position={[0, 0.3, 0.41]} scale={[0.8, 0.4, 0.05]} />
                  <mesh {...commonProps} material={new THREE.MeshStandardMaterial({ color: hash > 0.5 ? '#ef4444' : '#3b82f6' })} geometry={boxGeo} position={[0, 0.55, 0.5]} scale={[0.9, 0.1, 0.2]} rotation={[Math.PI/6, 0, 0]} />
                </>
              );
            } else {
              // Corner store
               return (
                <>
                  <mesh {...commonProps} material={mainMat} geometry={boxGeo} position={[-0.2, 0.5, -0.2]} scale={[0.5, 1, 0.5]} />
                  <mesh {...commonProps} material={accentMat} geometry={boxGeo} position={[0.1, 0.3, 0.1]} scale={[0.7, 0.6, 0.7]} />
                  <WindowBlock position={[0.1, 0.3, 0.46]} scale={[0.6, 0.3, 0.05]} />
                  <mesh {...commonProps} material={new THREE.MeshStandardMaterial({color: '#9ca3af'})} geometry={boxGeo} position={[0.2, 0.65, 0.2]} scale={[0.2, 0.1, 0.2]} />
                </>
               )
            }

          case BuildingType.Industrial:
            if (variant < 50) {
              // Factory
              return (
                <>
                  <mesh {...commonProps} material={mainMat} geometry={boxGeo} position={[0, 0.4, 0]} scale={[0.9, 0.8, 0.8]} />
                  <mesh {...commonProps} material={roofMat} geometry={boxGeo} position={[-0.2, 0.9, 0]} scale={[0.4, 0.2, 0.8]} rotation={[0,0,Math.PI/4]} />
                  <mesh {...commonProps} material={roofMat} geometry={boxGeo} position={[0.2, 0.9, 0]} scale={[0.4, 0.2, 0.8]} rotation={[0,0,Math.PI/4]} />
                  <SmokeStack position={[0.3, 0.4, 0.3]} />
                </>
              );
            } else {
              // Warehouse
              return (
                <>
                  <mesh {...commonProps} material={mainMat} geometry={boxGeo} position={[-0.2, 0.3, 0]} scale={[0.5, 0.6, 0.9]} />
                  <mesh {...commonProps} material={accentMat} geometry={cylinderGeo} position={[0.25, 0.4, -0.2]} scale={[0.2, 0.8, 0.2]} />
                  <mesh {...commonProps} material={accentMat} geometry={cylinderGeo} position={[0.25, 0.4, 0.25]} scale={[0.2, 0.8, 0.2]} />
                  <mesh {...commonProps} material={new THREE.MeshStandardMaterial({color: '#6b7280'})} geometry={boxGeo} position={[0.25, 0.7, 0]} scale={[0.05, 0.05, 0.5]} />
                </>
              );
            }

          case BuildingType.Park:
            const treeCount = 1 + Math.floor(hash * 3);
            const positions = [[-0.2, -0.2], [0.2, 0.2], [-0.2, 0.2], [0.2, -0.2]];
            
            return (
              <group position={[0, -yOffset - 0.29, 0]}> {/* Adjust park base to sit exactly on top of ground tile */}
                <mesh receiveShadow rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.01, 0]}>
                    <planeGeometry args={[0.9, 0.9]} />
                    <meshStandardMaterial color="#86efac" />
                </mesh>
                
                {variant < 30 && (
                    <group position={[0,0.05,0]}>
                        <mesh material={new THREE.MeshStandardMaterial({color: '#cbd5e1'})} geometry={cylinderGeo} scale={[0.4, 0.1, 0.4]} castShadow receiveShadow />
                        <mesh material={new THREE.MeshStandardMaterial({color: '#3b82f6', roughness: 0.1})} geometry={cylinderGeo} position={[0, 0.06, 0]} scale={[0.3, 0.05, 0.3]} />
                    </group>
                )}

                {Array.from({length: treeCount}).map((_, i) => {
                    const pos = positions[i % positions.length];
                    const scale = 0.5 + getHash(x+i, y-i) * 0.5;
                    const treeColor = new THREE.Color("#166534").offsetHSL(0, 0, getHash(x,y+i)*0.2);
                    return (
                    <group key={i} position={[pos[0], 0, pos[1]]} scale={scale} rotation={[0, getHash(i,x)*Math.PI, 0]}>
                        <mesh castShadow receiveShadow material={new THREE.MeshStandardMaterial({ color: '#78350f' })} geometry={cylinderGeo} position={[0, 0.15, 0]} scale={[0.1, 0.3, 0.1]} />
                        <mesh castShadow receiveShadow material={new THREE.MeshStandardMaterial({ color: treeColor, flatShading: true })} geometry={coneGeo} position={[0, 0.4, 0]} scale={[0.4, 0.5, 0.4]} />
                        <mesh castShadow receiveShadow material={new THREE.MeshStandardMaterial({ color: treeColor, flatShading: true })} geometry={coneGeo} position={[0, 0.65, 0]} scale={[0.3, 0.4, 0.3]} />
                    </group>
                    )
                })}
              </group>
            );
          case BuildingType.Road:
             return null;
          default:
            return null;
        }
      })()}
    </group>
  );
});

// --- 2. Dynamic Systems (Traffic, Citizens, Environment) ---

const ROAD_TOP_Y = -0.289; // Top of a road GroundTile (see GroundTile/RoadDetails)

const carColors = ['#ef4444', '#3b82f6', '#eab308', '#ffffff', '#1f2937', '#f97316'];
const MAX_CARS = 60;
const CAR_STOP_AT = 0.48; // Progress towards the next tile where a car waits at a red light (just before the tile edge)
const CAR_GAP = 0.6; // Minimum progress between queued cars (car length is 0.5)
const CAR_LEN = 0.5;
const CAR_H = 0.15;
const CAR_W = 0.3;
const LANE_OFFSET = 0.15; // Cars keep to the right of the centre line
const ROUNDABOUT_RADIUS = 0.3; // Cars circle the island at this radius
const ROUNDABOUT_ARC = 0.35; // Share of the leaving trip spent circling (the rest drives out to the tile edge)
const AMBULANCE_MIN_CARS = 6; // With this many cars, one of them is an ambulance

const carCabinMat = new THREE.MeshStandardMaterial({ color: '#1e293b', roughness: 0.2, metalness: 0.6 });
const taillightMat = new THREE.MeshBasicMaterial({ color: '#ffffff', toneMapped: false });
const sirenMat = new THREE.MeshBasicMaterial({ color: '#ef4444', toneMapped: false });
const SIREN_RED = new THREE.Color('#ff2d2d').multiplyScalar(2);
const SIREN_BLUE = new THREE.Color('#3b82ff').multiplyScalar(2);

interface Car {
  px: number; py: number; // Previous tile (to know where a car entered a roundabout)
  cx: number; cy: number; // Tile the car is leaving
  tx: number; ty: number; // Tile the car is driving to
  progress: number; // 0..1 from the current tile centre to the target tile centre
  speed: number;
  angle: number; // Last heading, kept while standing still
  braking: boolean;
}

// Point on the right-hand lane of the straight road from tile a to tile b
const lanePoint = (ax: number, ay: number, bx: number, by: number, p: number): [number, number] => {
  const dx = bx - ax;
  const dy = by - ay;
  const len = Math.hypot(dx, dy) || 1;
  return [ax + dx * p + (-dy / len) * LANE_OFFSET, ay + dy * p + (dx / len) * LANE_OFFSET];
};

const lerp2 = (a: [number, number], b: [number, number], k: number): [number, number] =>
  [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k];

// Where a car is at progress p; around roundabouts it circles the island (counter-clockwise seen from above)
const carPoint = (car: Car, p: number, roundabouts: Set<string>): [number, number] => {
  const { px, py, cx, cy, tx, ty } = car;
  const moving = cx !== tx || cy !== ty;

  if (moving && p > 0.5 && roundabouts.has(`${tx},${ty}`)) {
    // Entering: from the tile edge to the circle, on the side the car comes from
    const inAngle = Math.atan2(cy - ty, cx - tx);
    const entry: [number, number] = [tx + Math.cos(inAngle) * ROUNDABOUT_RADIUS, ty + Math.sin(inAngle) * ROUNDABOUT_RADIUS];
    return lerp2(lanePoint(cx, cy, tx, ty, 0.5), entry, (p - 0.5) / 0.5);
  }
  if (moving && p < 0.5 && roundabouts.has(`${cx},${cy}`)) {
    // Leaving: circle from the entry side to the exit side, then drive out to the tile edge
    const outAngle = Math.atan2(ty - cy, tx - cx);
    const inAngle = px === cx && py === cy ? outAngle - Math.PI : Math.atan2(py - cy, px - cx);
    let sweep = ((inAngle - outAngle) % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2);
    if (sweep < 0.01) sweep = Math.PI * 2; // U-turn: go all the way round
    if (p < ROUNDABOUT_ARC) {
      const a = inAngle - sweep * (p / ROUNDABOUT_ARC);
      return [cx + Math.cos(a) * ROUNDABOUT_RADIUS, cy + Math.sin(a) * ROUNDABOUT_RADIUS];
    }
    const exit: [number, number] = [cx + Math.cos(outAngle) * ROUNDABOUT_RADIUS, cy + Math.sin(outAngle) * ROUNDABOUT_RADIUS];
    return lerp2(exit, lanePoint(cx, cy, tx, ty, 0.5), (p - ROUNDABOUT_ARC) / (0.5 - ROUNDABOUT_ARC));
  }
  return lanePoint(cx, cy, tx, ty, p);
};

const TrafficSystem = ({ grid, carCount }: { grid: Grid; carCount: number }) => {
  const roadTiles = useMemo(() => {
    const roads: {x: number, y: number}[] = [];
    grid.forEach(row => row.forEach(tile => {
      if (isRoadType(tile.buildingType)) roads.push({x: tile.x, y: tile.y});
    }));
    return roads;
  }, [grid]);

  const roadKeys = useMemo(() => new Set(roadTiles.map(t => `${t.x},${t.y}`)), [roadTiles]);
  const signalised = useMemo(() => new Set(roadTiles.filter(t => hasSignals(grid, t.x, t.y)).map(t => `${t.x},${t.y}`)), [grid, roadTiles]);
  const roundabouts = useMemo(() => new Set(roadTiles.filter(t => grid[t.y][t.x].buildingType === BuildingType.Roundabout).map(t => `${t.x},${t.y}`)), [grid, roadTiles]);

  const bodyRef = useRef<THREE.InstancedMesh>(null);
  const cabinRef = useRef<THREE.InstancedMesh>(null);
  const headRef = useRef<THREE.InstancedMesh>(null);
  const tailRef = useRef<THREE.InstancedMesh>(null);
  const sirenRef = useRef<THREE.Mesh>(null);
  const cars = useRef<Car[]>([]);
  const dummy = useMemo(() => new THREE.Object3D(), []);
  const color = useMemo(() => new THREE.Color(), []);

  const spawnCar = useCallback((): Car => {
    const t = roadTiles[Math.floor(Math.random() * roadTiles.length)];
    return { px: t.x, py: t.y, cx: t.x, cy: t.y, tx: t.x, ty: t.y, progress: 1, speed: getRandomRange(0.01, 0.03), angle: 0, braking: false };
  }, [roadTiles]);

  const ambulanceShown = useRef(false);
  const paintCar = useCallback((i: number) => {
    if (!bodyRef.current) return;
    color.set(i === 0 && ambulanceShown.current ? '#f8fafc' : carColors[Math.floor(Math.random() * carColors.length)]);
    bodyRef.current.setColorAt(i, color);
    if (bodyRef.current.instanceColor) bodyRef.current.instanceColor.needsUpdate = true;
  }, [color]);

  // Keep cars that are still on a road when the map changes; respawn the rest
  useEffect(() => {
    cars.current = cars.current.map((car, i) => {
      if (roadKeys.has(`${car.cx},${car.cy}`) && roadKeys.has(`${car.tx},${car.ty}`)) return car;
      if (roadTiles.length === 0) return car;
      paintCar(i);
      return spawnCar();
    });
  }, [roadKeys, roadTiles, spawnCar, paintCar]);

  useFrame(({ clock }) => {
    const body = bodyRef.current;
    if (!body || !cabinRef.current || !headRef.current || !tailRef.current || roadTiles.length < 2) return;
    const t = clock.elapsedTime;
    const night = 1 - daylight(t);

    // Grow or shrink the fleet with the number of commuters
    const n = Math.min(carCount, MAX_CARS);
    while (cars.current.length < n) {
      paintCar(cars.current.length);
      cars.current.push(spawnCar());
    }
    cars.current.length = n;
    const hasAmbulance = n >= AMBULANCE_MIN_CARS;
    if (hasAmbulance !== ambulanceShown.current) {
      ambulanceShown.current = hasAmbulance; // Car 0 becomes (or stops being) the white ambulance
      if (n > 0) paintCar(0);
    }
    const list = cars.current;

    for (let i = 0; i < n; i++) {
      const car = list[i];
      const ambulance = hasAmbulance && i === 0;
      const speed = ambulance ? 0.035 : car.speed;
      let next = car.progress + speed;

      // Stop at the junction's edge (before its zebra crossing) unless the light for this arm is green.
      // The ambulance runs red lights.
      const towardsTile = car.tx !== car.cx || car.ty !== car.cy;
      if (!ambulance && towardsTile && signalised.has(`${car.tx},${car.ty}`) && car.progress <= CAR_STOP_AT && next > CAR_STOP_AT) {
        if (signalLamp(t, car.tx, car.ty, car.tx === car.cx) !== LAMP_GREEN) next = CAR_STOP_AT;
      }

      // Queue behind the car ahead on the same stretch of road
      for (let j = 0; j < n; j++) {
        const o = list[j];
        if (j === i || o.cx !== car.cx || o.cy !== car.cy || o.tx !== car.tx || o.ty !== car.ty) continue;
        if (o.progress > car.progress || (o.progress === car.progress && j < i)) next = Math.min(next, Math.max(car.progress, o.progress - CAR_GAP));
      }

      car.braking = next < car.progress + speed * 0.5;
      car.progress = next;

      if (car.progress >= 1) {
        car.px = car.cx; car.py = car.cy;
        car.cx = car.tx; car.cy = car.ty;
        car.progress = 0;

        const neighbors = roadTiles.filter(r =>
          (Math.abs(r.x - car.cx) === 1 && r.y === car.cy) || (Math.abs(r.y - car.cy) === 1 && r.x === car.cx));
        if (neighbors.length > 0) {
          // Avoid turning straight back unless it's a dead end
          const valid = neighbors.length > 1 ? neighbors.filter(r => r.x !== car.px || r.y !== car.py) : neighbors;
          const pick = valid[Math.floor(Math.random() * valid.length)];
          car.tx = pick.x; car.ty = pick.y;
        } else {
          Object.assign(car, spawnCar());
        }
      }

      // Position and heading along the path
      const [gx, gy] = carPoint(car, car.progress, roundabouts);
      const [ax, ay] = car.progress > 0.98 ? carPoint(car, car.progress - 0.02, roundabouts) : [gx, gy];
      const [bx, by] = car.progress > 0.98 ? [gx, gy] : carPoint(car, car.progress + 0.02, roundabouts);
      if (Math.hypot(bx - ax, by - ay) > 1e-4) car.angle = Math.atan2(by - ay, bx - ax);
      const a = car.angle;
      const fx = Math.cos(a), fz = Math.sin(a); // Forward, in world x/z
      const sx = -Math.sin(a), sz = Math.cos(a); // Right-hand side

      const [wx, , wz] = gridToWorld(gx, gy, grid.length);
      const y = ROAD_TOP_Y + CAR_H / 2;

      dummy.rotation.set(0, -a, 0);
      dummy.position.set(wx, y, wz);
      dummy.scale.set(CAR_LEN, CAR_H, CAR_W);
      dummy.updateMatrix();
      body.setMatrixAt(i, dummy.matrix);

      dummy.position.set(wx - fx * 0.04, y + CAR_H * 0.75, wz - fz * 0.04);
      dummy.scale.set(0.26, 0.09, 0.24);
      dummy.updateMatrix();
      cabinRef.current.setMatrixAt(i, dummy.matrix);

      // Head- and taillights (taillights glow bright red when braking)
      dummy.scale.set(0.012, 0.035, 0.06);
      if (car.braking) color.setRGB(1.6, 0.1, 0.1); else color.setRGB(0.3 + 0.35 * night, 0.02, 0.02);
      for (let s = 0; s < 2; s++) {
        const side = s === 0 ? -0.09 : 0.09;
        dummy.position.set(wx + fx * (CAR_LEN / 2 + 0.004) + sx * side, y, wz + fz * (CAR_LEN / 2 + 0.004) + sz * side);
        dummy.updateMatrix();
        headRef.current.setMatrixAt(i * 2 + s, dummy.matrix);
        dummy.position.set(wx - fx * (CAR_LEN / 2 + 0.004) + sx * side, y, wz - fz * (CAR_LEN / 2 + 0.004) + sz * side);
        dummy.updateMatrix();
        tailRef.current.setMatrixAt(i * 2 + s, dummy.matrix);
        tailRef.current.setColorAt(i * 2 + s, color);
      }

      if (ambulance && sirenRef.current) {
        sirenRef.current.position.set(wx, y + CAR_H / 2 + 0.03, wz);
        sirenRef.current.rotation.set(0, -a, 0);
        sirenMat.color.copy(Math.floor(t * 6) % 2 ? SIREN_RED : SIREN_BLUE);
      }
    }

    if (sirenRef.current) sirenRef.current.visible = hasAmbulance;
    body.count = n;
    cabinRef.current.count = n;
    headRef.current.count = n * 2;
    tailRef.current.count = n * 2;
    for (const m of [body, cabinRef.current, headRef.current, tailRef.current]) m.instanceMatrix.needsUpdate = true;
    if (tailRef.current.instanceColor) tailRef.current.instanceColor.needsUpdate = true;
  });

  if (roadTiles.length < 2) return null;

  return (
    <group raycast={noRaycast}>
      <instancedMesh ref={bodyRef} args={[boxGeo, undefined, MAX_CARS]} castShadow raycast={noRaycast}>
        <meshStandardMaterial roughness={0.5} metalness={0.3} />
      </instancedMesh>
      <instancedMesh ref={cabinRef} args={[boxGeo, carCabinMat, MAX_CARS]} castShadow raycast={noRaycast} />
      <instancedMesh ref={headRef} args={[boxGeo, headlightMat, MAX_CARS * 2]} raycast={noRaycast} />
      <instancedMesh ref={tailRef} args={[boxGeo, taillightMat, MAX_CARS * 2]} raycast={noRaycast} />
      <mesh ref={sirenRef} geometry={boxGeo} material={sirenMat} scale={[0.08, 0.04, 0.2]} visible={false} raycast={noRaycast} />
    </group>
  );
};

const clothesColors = ['#ef4444', '#3b82f6', '#10b981', '#f59e0b', '#8b5cf6', '#ec4899', '#ffffff'];
const MAX_PEOPLE = 300;
const PERSON_H = 0.2;
const PERSON_W = 0.08;

interface Walker {
  from: number; // Graph node the walker is leaving
  prev: number; // Node before that (to avoid turning straight back)
  edge: PedEdge | null; // Edge being walked (or waited at, for a crossing on red)
  progress: number;
  speed: number; // Tiles per frame
  jitter: number; // Sideways offset so people don't walk in single file
  anim: number;
}

// Citizens walk along the pavements and cross on zebra crossings, waiting for cars to stop at signals
const PopulationSystem = ({ population, grid }: { population: number, grid: Grid }) => {
  const graph = useMemo(() => buildPedestrianGraph(grid), [grid]);
  const meshRef = useRef<THREE.InstancedMesh>(null);
  const walkers = useRef<Walker[]>([]);
  const dummy = useMemo(() => new THREE.Object3D(), []);

  // Paths change with the map: start everyone afresh
  useEffect(() => { walkers.current = []; }, [graph]);

  useEffect(() => {
    if (!meshRef.current) return;
    const c = new THREE.Color();
    for (let i = 0; i < MAX_PEOPLE; i++) {
      c.set(clothesColors[Math.floor(Math.random() * clothesColors.length)]);
      meshRef.current.setColorAt(i, c);
    }
    if (meshRef.current.instanceColor) meshRef.current.instanceColor.needsUpdate = true;
  }, []);

  useFrame(({ clock }) => {
    const mesh = meshRef.current;
    if (!mesh) return;
    const t = clock.elapsedTime;
    const n = graph.nodes.length > 0 ? Math.min(Math.floor(population / 2), MAX_PEOPLE) : 0;

    while (walkers.current.length < n) {
      const start = Math.floor(Math.random() * graph.nodes.length);
      walkers.current.push({
        from: start, prev: -1, edge: null, progress: 0,
        speed: getRandomRange(0.004, 0.009), jitter: getRandomRange(-0.035, 0.035), anim: Math.random() * Math.PI * 2,
      });
    }
    walkers.current.length = n;

    for (let i = 0; i < n; i++) {
      const w = walkers.current[i];
      const options = graph.edges[w.from];

      if (!w.edge && options.length > 0) {
        const onward = options.length > 1 ? options.filter(e => e.to !== w.prev) : options;
        w.edge = onward[Math.floor(Math.random() * onward.length)];
        w.progress = 0;
      }

      const a = graph.nodes[w.from];
      const b = w.edge ? graph.nodes[w.edge.to] : a;
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const len = Math.hypot(dx, dy) || 1;

      // At a signalised crossing, step off the kerb only while cars on that arm have red
      const crossing = w.edge?.crossing;
      const waiting = !!crossing?.signal && w.progress === 0 && signalLamp(t, crossing.x, crossing.y, crossing.northSouth) !== LAMP_RED;

      if (w.edge && !waiting) {
        w.progress += w.speed / len;
        if (w.progress >= 1) {
          w.prev = w.from;
          w.from = w.edge.to;
          w.edge = null;
          w.progress = 0;
        }
      }

      const k = Math.min(w.progress, 1);
      const gx = a.x + dx * k + (-dy / len) * w.jitter;
      const gy = a.y + dy * k + (dx / len) * w.jitter;
      const [wx, , wz] = gridToWorld(gx, gy, grid.length);
      const ground = crossing && w.progress > 0 ? ROAD_TOP_Y : ROAD_TOP_Y + PAVEMENT_H;
      const bounce = waiting || !w.edge ? 0 : Math.abs(Math.sin(t * 10 + w.anim)) * 0.03;

      dummy.position.set(wx, ground + PERSON_H / 2 + bounce, wz);
      dummy.rotation.set(0, -Math.atan2(dy, dx), 0);
      dummy.scale.set(PERSON_W, PERSON_H, PERSON_W);
      dummy.updateMatrix();
      mesh.setMatrixAt(i, dummy.matrix);
    }
    mesh.count = n;
    mesh.instanceMatrix.needsUpdate = true;
  });

  return (
    <instancedMesh ref={meshRef} args={[boxGeo, undefined, MAX_PEOPLE]} castShadow raycast={noRaycast}>
      <meshStandardMaterial roughness={0.8} />
    </instancedMesh>
  );
};

// Sky, sun/moon and ambient light follow a day/night cycle; windows, street lamps and headlights glow at night
const SKY_DAY = new THREE.Color('#0c4a6e');
const SKY_DUSK = new THREE.Color('#9a3412');
const SKY_NIGHT = new THREE.Color('#020617');
const SUN_DAY = new THREE.Color('#fffbeb');
const SUN_LOW = new THREE.Color('#fb923c');
const MOONLIGHT = new THREE.Color('#93c5fd');
const AMBIENT_DAY = new THREE.Color('#cceeff');
const AMBIENT_NIGHT = new THREE.Color('#1e3a8a');

const DayNightCycle = ({ shadowExtent }: { shadowExtent: number }) => {
  const sun = useRef<THREE.DirectionalLight>(null);
  const ambient = useRef<THREE.AmbientLight>(null);
  const scene = useThree(state => state.scene);
  const sky = useMemo(() => new THREE.Color(SKY_DAY), []);

  useEffect(() => {
    scene.background = sky;
    return () => { scene.background = null; };
  }, [scene, sky]);

  useFrame(({ clock }) => {
    const t = clock.elapsedTime;
    const day = daylight(t);
    const night = 1 - day;
    const height = sunHeight(t);
    const dusk = Math.max(0, 1 - Math.abs(height) / 0.3); // 1 with the sun on the horizon

    sky.copy(SKY_NIGHT).lerp(SKY_DAY, day).lerp(SKY_DUSK, dusk * 0.45);
    scene.environmentIntensity = 0.2 + 0.8 * day;

    if (ambient.current) {
      ambient.current.intensity = 0.2 + 0.3 * day;
      ambient.current.color.copy(AMBIENT_NIGHT).lerp(AMBIENT_DAY, day);
    }
    if (sun.current) {
      // The sun arcs across the sky by day; the moon lights the city from the opposite side at night
      const angle = 2 * Math.PI * (timeOfDay(t) - 0.25);
      const dir = height >= 0 ? 1 : -1;
      sun.current.position.set(Math.cos(angle) * 20 * dir, Math.max(4, Math.abs(Math.sin(angle)) * 25), 10);
      sun.current.intensity = height >= 0 ? 0.4 + 1.6 * day : 0.35;
      sun.current.color.copy(MOONLIGHT).lerp(SUN_LOW, day).lerp(SUN_DAY, day * (1 - dusk));
    }

    windowMat.emissive.copy(WINDOW_DAY).lerp(WINDOW_NIGHT, night);
    windowMat.emissiveIntensity = 0.2 + 1.3 * night;
    streetLampMat.emissiveIntensity = 0.3 + 3 * night;
    lampPoolMat.opacity = 0.3 * night;
    headlightMat.color.copy(HEADLIGHT_DAY).lerp(HEADLIGHT_NIGHT, night);
    waterMat.color.copy(WATER_NIGHT).lerp(WATER_DAY, day).offsetHSL(0, 0, Math.sin(t * 1.3) * 0.02);
  });

  return (
    <>
      <ambientLight ref={ambient} intensity={0.5} color="#cceeff" />
      <directionalLight
        ref={sun}
        castShadow
        position={[15, 20, 10]}
        intensity={2}
        color="#fffbeb"
        shadow-mapSize={[2048, 2048]}
        shadow-camera-left={-shadowExtent} shadow-camera-right={shadowExtent}
        shadow-camera-top={shadowExtent} shadow-camera-bottom={-shadowExtent}
      />
    </>
  );
};

// Clouds & Birds
const Cloud = ({ position, scale, speed, size }: { position: [number, number, number], scale: number, speed: number, size: number }) => {
    const group = useRef<THREE.Group>(null);
    useFrame((state, delta) => {
        if (group.current) {
            group.current.position.x += speed * delta;
            if (group.current.position.x > size * 1.5) group.current.position.x = -size * 1.5;
        }
    });

    const bubbles = useMemo(() => Array.from({length: 5 + Math.random() * 5}).map(() => ({
        pos: [getRandomRange(-1,1), getRandomRange(-0.5, 0.5), getRandomRange(-1,1)] as [number, number, number],
        scale: getRandomRange(0.5, 1.2)
    })), []);

    return (
        <group ref={group} position={position} scale={scale}>
            {bubbles.map((b, i) => (
                <mesh key={i} geometry={sphereGeo} position={b.pos} scale={b.scale} castShadow>
                    <meshStandardMaterial color="white" flatShading opacity={0.9} transparent />
                </mesh>
            ))}
        </group>
    )
}

const Bird = ({ position, speed, offset, size }: { position: [number, number, number], speed: number, offset: number, size: number }) => {
    const ref = useRef<THREE.Group>(null);
    useFrame((state) => {
        if(ref.current) {
            const time = state.clock.elapsedTime + offset;
            ref.current.position.x = position[0] + Math.sin(time * speed) * size;
            ref.current.position.z = position[1] + Math.cos(time * speed) * size/2;
            ref.current.rotation.y = -time * speed + Math.PI;
            ref.current.scale.y = 1 + Math.sin(time * 15) * 0.3;
        }
    });

    return (
        <group ref={ref} position={[position[0], position[2], position[1]]}>
            <mesh geometry={boxGeo} scale={[0.2, 0.05, 0.05]} position={[0.1,0,0]} rotation={[0, Math.PI/4, 0]}><meshBasicMaterial color="#333" /></mesh>
            <mesh geometry={boxGeo} scale={[0.2, 0.05, 0.05]} position={[-0.1,0,0]} rotation={[0, -Math.PI/4, 0]}><meshBasicMaterial color="#333" /></mesh>
        </group>
    )
}

const EnvironmentEffects = ({ size }: { size: number }) => {
    return (
        <group raycast={() => null}>
             {/* Clouds */}
            <Cloud position={[-12, 8, 4]} scale={1.5} speed={0.3} size={size} />
            <Cloud position={[5, 9, -8]} scale={1.2} speed={0.5} size={size} />
            <Cloud position={[15, 7, 10]} scale={1.8} speed={0.2} size={size} />
            
            {/* Birds */}
            <group position={[0, 0, 0]} scale={0.8}>
                <Bird position={[0, 0, 10]} speed={0.6} offset={0} size={size} />
                <Bird position={[0, 0, 10]} speed={0.6} offset={1.2} size={size} />
                <Bird position={[0, 0, 10]} speed={0.6} offset={2.5} size={size} />
            </group>

            {/* Water */}
            <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.6, 0]} receiveShadow>
                <planeGeometry args={[size * 4, size * 4]} />
                <meshStandardMaterial color="#3b82f6" roughness={0.1} metalness={0.5} opacity={0.8} transparent />
            </mesh>
        </group>
    )
};


// --- 3. Main Map Component ---

// Road details: pavements with white curbs on unconnected sides, centre lines, street lamps and furniture,
// zebra crossings + traffic signals at junctions (3+ connected roads), and roundabout islands
const PAVEMENT_W = 0.15; // Pavement width; the carriageway between pavements is 1 - 2 * PAVEMENT_W
const PAVEMENT_H = 0.04;
const CURB_W = 0.03;
const noRaycast = () => null; // Decorations let clicks/hover fall through to the tile

const roundGeo = new THREE.CylinderGeometry(1, 1, 1, 24);
const lineMat = new THREE.MeshStandardMaterial({ color: '#fbbf24' });
const pavementMat = new THREE.MeshStandardMaterial({ color: '#cbd5e1', roughness: 0.95, flatShading: true });
const curbMat = new THREE.MeshStandardMaterial({ color: '#f8fafc', roughness: 0.6 });
const zebraMat = new THREE.MeshStandardMaterial({ color: '#f8fafc', roughness: 0.7 });
const signalPoleMat = new THREE.MeshStandardMaterial({ color: '#374151', metalness: 0.6, roughness: 0.4 });
const signalHeadMat = new THREE.MeshStandardMaterial({ color: '#111827', roughness: 0.5 });
const LAMP_COLORS = ['#ef4444', '#f59e0b', '#22c55e'] as const; // red, amber, green (same order as LAMP_RED..LAMP_GREEN)
const lampOnMats = LAMP_COLORS.map(c => new THREE.MeshStandardMaterial({ color: c, emissive: c, emissiveIntensity: 2.5, toneMapped: false }));
const lampOffMats = LAMP_COLORS.map(c => new THREE.MeshStandardMaterial({ color: new THREE.Color(c).multiplyScalar(0.18), roughness: 0.4 }));
const lampPostMat = new THREE.MeshStandardMaterial({ color: '#475569', metalness: 0.5, roughness: 0.5 });
const trunkMat = new THREE.MeshStandardMaterial({ color: '#78350f' });
const leafMat = new THREE.MeshStandardMaterial({ color: '#15803d', flatShading: true });
const benchMat = new THREE.MeshStandardMaterial({ color: '#a16207', roughness: 0.9 });
const shelterGlassMat = new THREE.MeshStandardMaterial({ color: '#bae6fd', transparent: true, opacity: 0.45, roughness: 0.1 });
const busSignMat = new THREE.MeshStandardMaterial({ color: '#2563eb' });
const islandGrassMat = new THREE.MeshStandardMaterial({ color: '#4ade80', flatShading: true });
const bridgePierMat = new THREE.MeshStandardMaterial({ color: '#94a3b8', roughness: 0.8 });
const railingMat = new THREE.MeshStandardMaterial({ color: '#e2e8f0', metalness: 0.4, roughness: 0.4 });
const ghostDeckMat = new THREE.MeshBasicMaterial({ color: '#e2e8f0', transparent: true, opacity: 0.45, depthWrite: false });

const TrafficSignal = ({ dir, x, y }: { dir: [number, number]; x: number; y: number }) => {
  const lampRefs = useRef<(THREE.Mesh | null)[]>([]);
  const lit = useRef(-1);
  const northSouth = dir[0] === 0;
  // Stand on the pavement corner to the right of this arm, facing traffic coming in along it
  const corner = 0.5 - PAVEMENT_W / 2;
  const px = (dir[0] - dir[1]) * corner;
  const pz = (dir[1] + dir[0]) * corner;
  const yaw = Math.atan2(dir[0], dir[1]);

  useFrame(({ clock }) => {
    const on = signalLamp(clock.elapsedTime, x, y, northSouth);
    if (on === lit.current) return;
    lit.current = on;
    lampRefs.current.forEach((lamp, i) => { if (lamp) lamp.material = i === on ? lampOnMats[i] : lampOffMats[i]; });
  });

  return (
    <group position={[px, PAVEMENT_H, pz]} rotation={[0, yaw, 0]}>
      <mesh geometry={cylinderGeo} material={signalPoleMat} position={[0, 0.3, 0]} scale={[0.018, 0.6, 0.018]} castShadow raycast={noRaycast} />
      <mesh geometry={boxGeo} material={signalHeadMat} position={[0, 0.66, 0.02]} scale={[0.08, 0.22, 0.06]} castShadow raycast={noRaycast} />
      {LAMP_COLORS.map((_, i) => (
        <mesh
          key={i}
          ref={el => { lampRefs.current[i] = el; }}
          geometry={boxGeo}
          material={lampOffMats[i]}
          position={[0, 0.73 - i * 0.065, 0.052]} // Red on top, green at the bottom
          scale={[0.045, 0.045, 0.01]}
          raycast={noRaycast}
        />
      ))}
    </group>
  );
};

// Zebra crossing across one arm of a junction, just inside the tile edge
const ZebraCrossing = ({ dir }: { dir: [number, number] }) => {
  const along = 0.34; // Distance of the crossing's centre from the tile centre
  const depth = 0.18;
  const carriageway = 1 - 2 * PAVEMENT_W;
  const stripes = 5;
  const pitch = carriageway / stripes;
  const alongX = dir[0] !== 0;
  return (
    <>
      {Array.from({ length: stripes }, (_, i) => {
        const lateral = -carriageway / 2 + pitch * (i + 0.5);
        return (
          <mesh
            key={i}
            geometry={boxGeo}
            material={zebraMat}
            position={alongX ? [dir[0] * along, 0.003, lateral] : [lateral, 0.003, dir[1] * along]}
            scale={alongX ? [depth, 0.004, pitch * 0.55] : [pitch * 0.55, 0.004, depth]}
            receiveShadow
            raycast={noRaycast}
          />
        );
      })}
    </>
  );
};

// A spot on a pavement strip; `along` runs parallel to the strip, local +z points into the road, y = 0 is the pavement top
const PavementSpot = ({ side, along, children }: { side: Side; along: number; children: React.ReactNode }) => {
  const [dx, dz] = SIDE_DIRS[side];
  const edge = 0.5 - PAVEMENT_W / 2;
  return (
    <group position={[dx !== 0 ? dx * edge : along, PAVEMENT_H, dz !== 0 ? dz * edge : along]} rotation={[0, Math.atan2(-dx, -dz), 0]}>
      {children}
    </group>
  );
};

// Street lamp leaning over the road, with a pool of light on the asphalt at night
const StreetLamp = () => (
  <>
    <mesh geometry={cylinderGeo} material={lampPostMat} position={[0, 0.25, 0]} scale={[0.012, 0.5, 0.012]} castShadow raycast={noRaycast} />
    <mesh geometry={boxGeo} material={lampPostMat} position={[0, 0.5, 0.06]} scale={[0.015, 0.015, 0.13]} raycast={noRaycast} />
    <mesh geometry={boxGeo} material={streetLampMat} position={[0, 0.49, 0.12]} scale={[0.05, 0.02, 0.05]} raycast={noRaycast} />
    <mesh material={lampPoolMat} position={[0, -PAVEMENT_H + 0.005, 0.2]} rotation={[-Math.PI / 2, 0, 0]} raycast={noRaycast}>
      <circleGeometry args={[0.2, 20]} />
    </mesh>
  </>
);

const StreetTree = ({ scale = 1 }: { scale?: number }) => (
  <group scale={scale}>
    <mesh geometry={cylinderGeo} material={trunkMat} position={[0, 0.07, 0]} scale={[0.012, 0.14, 0.012]} castShadow raycast={noRaycast} />
    <mesh geometry={sphereGeo} material={leafMat} position={[0, 0.19, 0]} scale={0.07} castShadow raycast={noRaycast} />
  </group>
);

const Bench = () => (
  <>
    <mesh geometry={boxGeo} material={benchMat} position={[0, 0.035, -0.01]} scale={[0.16, 0.012, 0.05]} castShadow raycast={noRaycast} />
    <mesh geometry={boxGeo} material={benchMat} position={[0, 0.065, -0.035]} scale={[0.16, 0.05, 0.01]} castShadow raycast={noRaycast} />
    <mesh geometry={boxGeo} material={lampPostMat} position={[-0.065, 0.015, -0.01]} scale={[0.01, 0.03, 0.05]} raycast={noRaycast} />
    <mesh geometry={boxGeo} material={lampPostMat} position={[0.065, 0.015, -0.01]} scale={[0.01, 0.03, 0.05]} raycast={noRaycast} />
  </>
);

const BusStop = () => (
  <>
    <mesh geometry={boxGeo} material={lampPostMat} position={[0, 0.2, -0.01]} scale={[0.26, 0.012, 0.09]} castShadow raycast={noRaycast} />
    <mesh geometry={boxGeo} material={shelterGlassMat} position={[0, 0.1, -0.05]} scale={[0.26, 0.19, 0.006]} raycast={noRaycast} />
    <mesh geometry={boxGeo} material={lampPostMat} position={[-0.12, 0.1, 0.03]} scale={[0.008, 0.2, 0.008]} raycast={noRaycast} />
    <mesh geometry={boxGeo} material={lampPostMat} position={[0.12, 0.1, 0.03]} scale={[0.008, 0.2, 0.008]} raycast={noRaycast} />
    <Bench />
    <mesh geometry={cylinderGeo} material={lampPostMat} position={[0.17, 0.13, 0.04]} scale={[0.006, 0.26, 0.006]} raycast={noRaycast} />
    <mesh geometry={boxGeo} material={busSignMat} position={[0.17, 0.25, 0.04]} scale={[0.05, 0.05, 0.008]} raycast={noRaycast} />
  </>
);

const RoadDetails = React.memo(({ x, y, grid, yOffset }: { x: number; y: number; grid: Grid; yOffset: number }) => {
  const connected = roadConnections(grid, x, y);
  const roundabout = grid[y][x].buildingType === BuildingType.Roundabout;
  const bridge = grid[y][x].buildingType === BuildingType.Bridge;
  const signals = hasSignals(grid, x, y);
  const pavementSides = SIDES.filter(s => !connected[s]);
  const straight = (connected.up && connected.down && !connected.left && !connected.right)
    || (connected.left && connected.right && !connected.up && !connected.down);

  const edge = 0.5 - PAVEMENT_W / 2;
  const curbOffset = 0.5 - PAVEMENT_W + CURB_W / 2;

  // Corner pavement where both neighbouring sides are road (the inner corner of a junction or bend),
  // unless the diagonal tile is road too (an open paved area)
  const corners: [number, number][] = ([[-1, -1], [1, -1], [-1, 1], [1, 1]] as [number, number][]).filter(([cx, cz]) =>
    connected[cx < 0 ? 'left' : 'right'] && connected[cz < 0 ? 'up' : 'down'] && !isRoadAt(grid, x + cx, y + cz));

  // Street furniture on quiet road tiles: a lamp on one pavement, and a tree, bench or bus stop on the other
  const furniture = tileHash(x + 7.3, y + 3.1);
  const lampSide = pavementSides[0];
  const extraSide = pavementSides[1] ?? pavementSides[0];
  const extraAlong = pavementSides[1] ? -0.2 : -0.25;

  return (
    <group position={[0, yOffset, 0]}>
      {/* Pavements with a white curb along each side that doesn't continue into another road */}
      {pavementSides.map(s => {
        const [dx, dz] = SIDE_DIRS[s];
        const alongX = dz !== 0; // Up/down pavements run along x
        // Curb ends meet the perpendicular curb, or run to the tile edge where the road continues
        const [startOpen, endOpen] = alongX ? [connected.left, connected.right] : [connected.up, connected.down];
        const curbStart = startOpen ? -0.5 : -0.5 + PAVEMENT_W;
        const curbEnd = endOpen ? 0.5 : 0.5 - PAVEMENT_W;
        const curbMid = (curbStart + curbEnd) / 2;
        const curbLen = curbEnd - curbStart;
        return (
          <group key={s}>
            <mesh
              geometry={boxGeo} material={pavementMat} receiveShadow castShadow raycast={noRaycast}
              position={[dx * edge, PAVEMENT_H / 2, dz * edge]}
              scale={alongX ? [1, PAVEMENT_H, PAVEMENT_W] : [PAVEMENT_W, PAVEMENT_H, 1]}
            />
            <mesh
              geometry={boxGeo} material={curbMat} receiveShadow raycast={noRaycast}
              position={alongX ? [curbMid, PAVEMENT_H / 2 + 0.003, dz * curbOffset] : [dx * curbOffset, PAVEMENT_H / 2 + 0.003, curbMid]}
              scale={alongX ? [curbLen, PAVEMENT_H + 0.006, CURB_W] : [CURB_W, PAVEMENT_H + 0.006, curbLen]}
            />
            {bridge && (
              // Railing along the outer edge of a bridge walkway
              <mesh
                geometry={boxGeo} material={railingMat} castShadow raycast={noRaycast}
                position={[dx * 0.485, PAVEMENT_H + 0.05, dz * 0.485]}
                scale={alongX ? [1, 0.1, 0.02] : [0.02, 0.1, 1]}
              />
            )}
          </group>
        );
      })}
      {corners.map(([cx, cz]) => (
        <mesh
          key={`${cx},${cz}`}
          geometry={boxGeo} material={pavementMat} receiveShadow castShadow raycast={noRaycast}
          position={[cx * edge, PAVEMENT_H / 2, cz * edge]}
          scale={[PAVEMENT_W, PAVEMENT_H, PAVEMENT_W]}
        />
      ))}

      {roundabout ? (
        // Roundabout: planted island inside a white kerb, zebra crossings on every arm, no signals
        <>
          <mesh geometry={roundGeo} material={curbMat} position={[0, 0.02, 0]} scale={[0.19, 0.04, 0.19]} receiveShadow raycast={noRaycast} />
          <mesh geometry={roundGeo} material={islandGrassMat} position={[0, 0.025, 0]} scale={[0.17, 0.05, 0.17]} receiveShadow raycast={noRaycast} />
          <group position={[0, 0.05, 0]}><StreetTree scale={1.4} /></group>
          {SIDES.filter(s => connected[s]).map(s => <group key={s}><ZebraCrossing dir={SIDE_DIRS[s]} /></group>)}
        </>
      ) : signals ? (
        // Junction: zebra crossing and a signal on every connected arm
        SIDES.filter(s => connected[s]).map(s => (
          <group key={s}>
            <ZebraCrossing dir={SIDE_DIRS[s]} />
            <TrafficSignal dir={SIDE_DIRS[s]} x={x} y={y} />
          </group>
        ))
      ) : (
        <>
          {/* Centre line towards each connected neighbour (meets in the middle on bends) */}
          <group rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.001, 0]}>
            {SIDES.filter(s => connected[s]).map(s => {
              const [dx, dz] = SIDE_DIRS[s];
              return (
                <mesh key={s} material={lineMat} position={[dx * 0.25, -dz * 0.25, 0]} rotation={[0, 0, dx !== 0 ? Math.PI / 2 : 0]} raycast={noRaycast}>
                  <planeGeometry args={[0.06, 0.5]} />
                </mesh>
              );
            })}
            {connected.up !== connected.down && connected.left !== connected.right && (
              <mesh material={lineMat} position={[0, 0, 0.001]} raycast={noRaycast}>
                <planeGeometry args={[0.06, 0.06]} />
              </mesh>
            )}
          </group>

          {lampSide && <PavementSpot side={lampSide} along={0.25}><StreetLamp /></PavementSpot>}
          {extraSide && !bridge && furniture < 0.35 && <PavementSpot side={extraSide} along={extraAlong}><StreetTree /></PavementSpot>}
          {extraSide && !bridge && furniture >= 0.35 && furniture < 0.5 && <PavementSpot side={extraSide} along={extraAlong}><Bench /></PavementSpot>}
          {extraSide && !bridge && straight && furniture >= 0.5 && furniture < 0.62 && <PavementSpot side={extraSide} along={-0.15}><BusStop /></PavementSpot>}
        </>
      )}
    </group>
  );
});

// Floating warning sign: red "no road" over buildings without a road; amber over monuments whose licence ran out
const NoRoadSign = ({ color = '#dc2626' }: { color?: string }) => {
  const ref = useRef<THREE.Group>(null);
  useFrame(({ clock }) => {
    if (ref.current) ref.current.position.y = 1.5 + Math.sin(clock.elapsedTime * 3) * 0.06;
  });
  return (
    <group ref={ref} position={[0, 1.5, 0]}>
      <Billboard>
        <mesh renderOrder={10} raycast={noRaycast}>
          <circleGeometry args={[0.17, 24]} />
          <meshBasicMaterial color={color} depthTest={false} transparent />
        </mesh>
        <mesh renderOrder={11} position={[0, 0, 0.001]} raycast={noRaycast}>
          <planeGeometry args={[0.22, 0.06]} />
          <meshBasicMaterial color="#ffffff" depthTest={false} transparent />
        </mesh>
      </Billboard>
    </group>
  );
};

// Grey smog drifting over houses polluted by a nearby factory
const smogMat = new THREE.MeshStandardMaterial({ color: '#6b7280', transparent: true, opacity: 0.5, depthWrite: false, flatShading: true });
const Smog = () => {
  const ref = useRef<THREE.Group>(null);
  useFrame(({ clock }) => {
    if (!ref.current) return;
    const t = clock.elapsedTime;
    ref.current.rotation.y = t * 0.3;
    ref.current.position.y = 1.15 + Math.sin(t * 0.8) * 0.05;
  });
  return (
    <group ref={ref} position={[0, 1.15, 0]}>
      <mesh geometry={sphereGeo} material={smogMat} position={[-0.15, 0, 0.05]} scale={0.16} raycast={noRaycast} />
      <mesh geometry={sphereGeo} material={smogMat} position={[0.12, 0.05, -0.05]} scale={0.2} raycast={noRaycast} />
      <mesh geometry={sphereGeo} material={smogMat} position={[0.02, 0.12, 0.12]} scale={0.13} raycast={noRaycast} />
    </group>
  );
};

interface GroundTileProps {
    type: BuildingType;
    x: number;
    y: number;
    grid: Grid;
    onHover: (x: number, y: number) => void;
    onLeave: () => void;
    onClick: (x: number, y: number) => void;
}

// Ground Tile: Handles pointer events and forms base terrain
const GroundTile = React.memo(({ type, x, y, grid, onHover, onLeave, onClick }: GroundTileProps) => {
  const [wx, _, wz] = gridToWorld(x, y, grid.length);
  
  let color = '#10b981';
  // Base level for tiles, slightly varying
  let topY = -0.3; 
  let thickness = 0.5;
  
  if (type === BuildingType.None) {
    const noise = getHash(x, y);
    color = noise > 0.7 ? '#059669' : noise > 0.3 ? '#10b981' : '#34d399';
    topY = -0.3 - noise * 0.1; // Slight height variation for grass
  } else if (isRoadType(type)) {
    color = '#374151';
    topY = -0.29; // slightly higher
  } else if (type === BuildingType.Water) {
    topY = -0.42; // River and lake sit below the banks
  } else {
    color = '#d1d5db'; // concrete base
    topY = -0.28;
  }

  const centerY = topY - thickness/2;

  const pointer = {
    onPointerEnter: (e: any) => { e.stopPropagation(); onHover(x, y); },
    onPointerOut: (e: any) => { e.stopPropagation(); onLeave(); },
    onPointerDown: (e: any) => { e.stopPropagation(); if (e.button === 0) onClick(x, y); },
  };

  // Bridge: water below, a road deck on piers at street level
  if (type === BuildingType.Bridge) {
    const deckH = 0.1;
    return (
      <group position={[wx, 0, wz]}>
        <mesh position={[0, -0.42 - thickness / 2, 0]} material={waterMat} receiveShadow {...pointer}>
          <boxGeometry args={[1, thickness, 1]} />
        </mesh>
        <mesh geometry={cylinderGeo} material={bridgePierMat} position={[0, -0.5, 0]} scale={[0.07, 0.3, 0.07]} castShadow raycast={noRaycast} />
        <mesh position={[0, -0.29 - deckH / 2, 0]} castShadow receiveShadow {...pointer}>
          <boxGeometry args={[1, deckH, 1]} />
          <meshStandardMaterial color="#374151" flatShading roughness={1} />
          <RoadDetails x={x} y={y} grid={grid} yOffset={deckH / 2 + 0.001} />
        </mesh>
      </group>
    );
  }

  return (
    <mesh
        position={[wx, centerY, wz]}
        receiveShadow castShadow={type !== BuildingType.Water}
        material={type === BuildingType.Water ? waterMat : undefined}
        onPointerEnter={(e) => { e.stopPropagation(); onHover(x, y); }}
        onPointerOut={(e) => { e.stopPropagation(); onLeave(); }}
        onPointerDown={(e) => {
            e.stopPropagation();
            if (e.button === 0) onClick(x, y);
        }}
    >
      <boxGeometry args={[1, thickness, 1]} />
      {type !== BuildingType.Water && <meshStandardMaterial color={color} flatShading roughness={1} />}
      {isRoadType(type) && <RoadDetails x={x} y={y} grid={grid} yOffset={thickness / 2 + 0.001} />}
    </mesh>
  );
});

// Selection/Hover Cursor
const Cursor = ({ x, y, color, size }: { x: number, y: number, color: string, size: number }) => {
  const [wx, _, wz] = gridToWorld(x, y, size);
  return (
    <mesh position={[wx, -0.25, wz]} rotation={[-Math.PI / 2, 0, 0]} raycast={() => null}>
      <planeGeometry args={[1, 1]} />
      <meshBasicMaterial color={color} transparent opacity={0.4} side={THREE.DoubleSide} depthTest={false} />
      <Outlines thickness={0.05} color="white" />
    </mesh>
  );
};


// --- Camera Views ---

type CameraView = '3d' | 'top';

const ISO_POLAR = 0.955; // Matches the initial [20, 20, 20] camera angle
const TOP_POLAR = 0.0001; // Straight down (exactly 0 breaks azimuth rotation)
const MIN_TILT_POLAR = 0.1;
const MAX_TILT_POLAR = Math.PI / 2.2;
const ROTATE_STEP = Math.PI / 4;

// Shortest signed difference between two angles
const angleDelta = (from: number, to: number) => {
  const d = (to - from) % (Math.PI * 2);
  return d > Math.PI ? d - Math.PI * 2 : d < -Math.PI ? d + Math.PI * 2 : d;
};

interface CameraRigProps {
  view: CameraView;
  rotateRequest: { id: number; step: number };
}

// Smoothly animates the orbit controls between 3D/top views and in 45° rotation steps.
const CameraRig = ({ view, rotateRequest }: CameraRigProps) => {
  const camera = useThree(state => state.camera);
  const controls = useThree(state => state.controls) as any;
  const target = useRef<{ polar: number | null; azimuth: number | null }>({ polar: null, azimuth: null });
  const spherical = useMemo(() => new THREE.Spherical(), []);
  const offset = useMemo(() => new THREE.Vector3(), []);

  useEffect(() => {
    if (!controls) return;
    target.current.polar = view === 'top' ? TOP_POLAR : ISO_POLAR;
    // Allow the full range while animating; limits are re-applied when it settles
    controls.minPolarAngle = 0;
    controls.maxPolarAngle = MAX_TILT_POLAR;
  }, [view, controls]);

  useEffect(() => {
    if (!controls || rotateRequest.id === 0) return;
    const base = target.current.azimuth ?? controls.getAzimuthalAngle();
    target.current.azimuth = base + rotateRequest.step;
  }, [rotateRequest, controls]);

  useFrame((_, delta) => {
    const t = target.current;
    if (!controls || (t.polar === null && t.azimuth === null)) return;

    offset.copy(camera.position).sub(controls.target);
    spherical.setFromVector3(offset);

    const ease = 1 - Math.exp(-10 * delta);
    let settled = true;

    if (t.polar !== null) {
      const d = t.polar - spherical.phi;
      if (Math.abs(d) < 0.001) {
        spherical.phi = t.polar;
      } else {
        spherical.phi += d * ease;
        settled = false;
      }
    }
    if (t.azimuth !== null) {
      const d = angleDelta(spherical.theta, t.azimuth);
      if (Math.abs(d) < 0.001) {
        spherical.theta += d;
      } else {
        spherical.theta += d * ease;
        settled = false;
      }
    }

    offset.setFromSpherical(spherical);
    camera.position.copy(controls.target).add(offset);
    camera.lookAt(controls.target);

    if (settled) {
      // Top view locks the tilt; drag-rotate still spins the map
      controls.minPolarAngle = view === 'top' ? TOP_POLAR : MIN_TILT_POLAR;
      controls.maxPolarAngle = view === 'top' ? TOP_POLAR : MAX_TILT_POLAR;
      t.polar = null;
      t.azimuth = null;
    }
    controls.update();
  });

  return null;
};

// --- Walk View ---

const ROAD_SURFACE_Y = -0.29; // Matches the road GroundTile top
const EYE_HEIGHT = 0.17; // Just above the 0.2-tall citizens
const WALK_SPEED = 1.2; // Tiles per second
const RUN_MULTIPLIER = 2.2;
const TURN_SPEED = 2; // Radians per second (keyboard / touch)
const LOOK_SENSITIVITY = 0.005;
const BODY_RADIUS = 0.12; // Keeps the camera from clipping into buildings beside the road
const MAX_PITCH = 1.2;

const isRoad = (grid: Grid, gx: number, gy: number) => {
  const ix = Math.round(gx);
  const iy = Math.round(gy);
  return ix >= 0 && iy >= 0 && ix < grid.length && iy < grid.length && isRoadType(grid[iy][ix].buildingType);
};

// Start on the road nearest the map centre, facing along the road
const findWalkSpawn = (grid: Grid) => {
  const center = (grid.length - 1) / 2;
  let best: { x: number; y: number } | null = null;
  let bestDist = Infinity;
  grid.forEach(row => row.forEach(tile => {
    if (!isRoadType(tile.buildingType)) return;
    const d = (tile.x - center) ** 2 + (tile.y - center) ** 2;
    if (d < bestDist) { bestDist = d; best = { x: tile.x, y: tile.y }; }
  }));
  if (!best) return null;
  const { x, y } = best;
  // Yaw 0 looks toward -y; the forward vector is (-sin(yaw), -cos(yaw)) in grid space
  const yaw = isRoad(grid, x + 1, y) ? -Math.PI / 2
    : isRoad(grid, x - 1, y) ? Math.PI / 2
    : isRoad(grid, x, y + 1) ? Math.PI
    : 0;
  return { x, y, yaw };
};

export interface WalkInput { forward: number; turn: number }

interface WalkControllerProps {
  grid: Grid;
  touchInput: React.MutableRefObject<WalkInput>;
}

// First-person camera constrained to road tiles: WASD / arrows to move, drag to look, Shift to run.
const WalkController = ({ grid, touchInput }: WalkControllerProps) => {
  const cameraRef = useRef<THREE.PerspectiveCamera>(null);
  const gl = useThree(state => state.gl);
  const gridRef = useRef(grid);
  useEffect(() => { gridRef.current = grid; }, [grid]);

  const spawn = useMemo(() => findWalkSpawn(grid), []); // eslint-disable-line react-hooks/exhaustive-deps
  const pos = useRef({ x: spawn?.x ?? 0, y: spawn?.y ?? 0 });
  const look = useRef({ yaw: spawn?.yaw ?? 0, pitch: 0 });
  const keys = useRef(new Set<string>());
  const bobTime = useRef(0);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      keys.current.add(e.key.toLowerCase());
    };
    const onKeyUp = (e: KeyboardEvent) => keys.current.delete(e.key.toLowerCase());
    const onBlur = () => keys.current.clear();

    const el = gl.domElement;
    let dragging = false;
    let lastX = 0;
    let lastY = 0;
    const onPointerDown = (e: PointerEvent) => {
      dragging = true;
      lastX = e.clientX;
      lastY = e.clientY;
      el.setPointerCapture(e.pointerId);
    };
    const onPointerMove = (e: PointerEvent) => {
      if (!dragging) return;
      look.current.yaw -= (e.clientX - lastX) * LOOK_SENSITIVITY;
      look.current.pitch = MathUtils.clamp(look.current.pitch - (e.clientY - lastY) * LOOK_SENSITIVITY, -MAX_PITCH, MAX_PITCH);
      lastX = e.clientX;
      lastY = e.clientY;
    };
    const onPointerUp = () => { dragging = false; };

    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('blur', onBlur);
    el.addEventListener('pointerdown', onPointerDown);
    el.addEventListener('pointermove', onPointerMove);
    el.addEventListener('pointerup', onPointerUp);
    el.addEventListener('pointercancel', onPointerUp);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('blur', onBlur);
      el.removeEventListener('pointerdown', onPointerDown);
      el.removeEventListener('pointermove', onPointerMove);
      el.removeEventListener('pointerup', onPointerUp);
      el.removeEventListener('pointercancel', onPointerUp);
    };
  }, [gl]);

  useFrame((_, delta) => {
    const cam = cameraRef.current;
    if (!cam) return;
    const k = keys.current;
    const dt = Math.min(delta, 0.1);

    const turn = (k.has('arrowleft') ? 1 : 0) - (k.has('arrowright') ? 1 : 0) + touchInput.current.turn;
    look.current.yaw += turn * TURN_SPEED * dt;

    const forward = (k.has('w') || k.has('arrowup') ? 1 : 0) - (k.has('s') || k.has('arrowdown') ? 1 : 0) + touchInput.current.forward;
    const strafe = (k.has('d') ? 1 : 0) - (k.has('a') ? 1 : 0);

    const { yaw } = look.current;
    let mx = -Math.sin(yaw) * forward + Math.cos(yaw) * strafe;
    let my = -Math.cos(yaw) * forward - Math.sin(yaw) * strafe;
    const len = Math.hypot(mx, my);
    const moving = len > 0.01;

    if (moving) {
      const speed = WALK_SPEED * (k.has('shift') ? RUN_MULTIPLIER : 1) * dt / Math.max(len, 1);
      mx *= speed;
      my *= speed;
      const p = pos.current;
      const g = gridRef.current;
      // Move each axis separately so you slide along road edges instead of sticking
      if (mx !== 0 && isRoad(g, p.x + mx + Math.sign(mx) * BODY_RADIUS, p.y)) p.x += mx;
      if (my !== 0 && isRoad(g, p.x, p.y + my + Math.sign(my) * BODY_RADIUS)) p.y += my;
      bobTime.current += dt * (k.has('shift') ? 14 : 9);
    }

    const bob = moving ? Math.sin(bobTime.current) * 0.008 : 0;
    const [wx, , wz] = gridToWorld(pos.current.x, pos.current.y, gridRef.current.length);
    cam.position.set(wx, ROAD_SURFACE_Y + EYE_HEIGHT + bob, wz);
    cam.rotation.set(look.current.pitch, look.current.yaw, 0, 'YXZ');
  });

  return <PerspectiveCamera ref={cameraRef} makeDefault fov={70} near={0.01} far={200} />;
};

// Styled to match the toolbar's ToolButton: icon over a small uppercase label
const CameraButton = ({ onClick, title, label, icon, active = false, disabled = false }: { onClick: () => void; title: string; label: string; icon: React.ReactNode; active?: boolean; disabled?: boolean }) => (
  <button
    onClick={onClick}
    title={title}
    aria-label={title}
    aria-pressed={active}
    disabled={disabled}
    className={`
      w-12 h-12 md:w-14 md:h-14 flex flex-col items-center justify-center gap-1 rounded-lg border-2 transition-all
      focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400/60
      ${active ? 'border-cyan-400 bg-cyan-500/20 text-cyan-100' : 'border-gray-600 bg-gray-900/80 text-gray-200'}
      ${disabled ? 'opacity-40 cursor-not-allowed' : active ? 'hover:bg-cyan-500/30' : 'hover:bg-gray-800 hover:border-gray-500'}
    `}
  >
    {icon}
    <span className="text-[8px] md:text-[9px] font-bold uppercase tracking-wider leading-none">{label}</span>
  </button>
);

// Hold-to-move button for touch screens in walk view
const HoldButton = ({ input, field, value, icon, title }: { input: React.MutableRefObject<WalkInput>; field: keyof WalkInput; value: number; icon: React.ReactNode; title: string }) => {
  const release = () => { input.current[field] = 0; };
  return (
    <button
      title={title}
      aria-label={title}
      onPointerDown={(e) => { e.currentTarget.setPointerCapture(e.pointerId); input.current[field] = value; }}
      onPointerUp={release}
      onPointerCancel={release}
      onPointerLeave={release}
      className="w-11 h-11 md:w-12 md:h-12 flex items-center justify-center rounded-lg border-2 border-gray-600 bg-gray-900/80 text-gray-200 hover:bg-gray-800 active:border-cyan-400 active:bg-cyan-500/20 active:text-cyan-100 transition-colors select-none touch-none"
    >
      {icon}
    </button>
  );
};

const Kbd = ({ children }: { children: React.ReactNode }) => (
  <kbd className="px-1.5 py-0.5 rounded border border-gray-600 bg-gray-800 text-[10px] font-mono font-bold text-gray-100 leading-none">{children}</kbd>
);

// --- Co-op overlays ---

export interface CoopMapInfo {
  mySlot: number;
  plotSize: number;
  players: CoopPlayer[];
  cursors: Record<number, { x: number; y: number }>;
  pendingBridges: { x: number; y: number }[][]; // Proposed bridges waiting for an answer (shown as ghosts)
  closedMonuments: string[]; // "x,y" of monument anchors whose licence has run out
}

// A translucent deck where a bridge has been proposed
const GhostBridge = ({ tiles, size }: { tiles: { x: number; y: number }[]; size: number }) => (
  <group raycast={noRaycast}>
    {tiles.map(t => {
      const [wx, , wz] = gridToWorld(t.x, t.y, size);
      return <mesh key={`${t.x},${t.y}`} geometry={boxGeo} material={ghostDeckMat} position={[wx, -0.33, wz]} scale={[1, 0.08, 0.7]} raycast={noRaycast} />;
    })}
  </group>
);

const BORDER_Y = -0.265; // Just above building bases and roads

// A coloured outline around each player's plot (yours is thicker), with their name at the corner
const PlotBorders = ({ coop, size }: { coop: CoopMapInfo; size: number }) => (
  <group raycast={noRaycast}>
    {plotRects(coop.plotSize).map(plot => {
      const player = coop.players.find(p => p.slot === plot.slot);
      const color = player ? player.color : '#64748b';
      const width = plot.slot === coop.mySlot ? 0.1 : 0.05;
      const [cx, , cz] = gridToWorld(plot.x0 + (plot.size - 1) / 2, plot.y0 + (plot.size - 1) / 2, size);
      const half = plot.size / 2;
      const [lx, , lz] = gridToWorld(plot.x0, plot.y0, size);
      return (
        <group key={plot.slot}>
          {[[0, -half, plot.size, width], [0, half, plot.size, width], [-half, 0, width, plot.size], [half, 0, width, plot.size]].map(([dx, dz, sx, sz], i) => (
            <mesh key={i} geometry={boxGeo} position={[cx + dx, BORDER_Y, cz + dz]} scale={[sx, 0.02, sz]} raycast={noRaycast}>
              <meshBasicMaterial color={color} toneMapped={false} transparent opacity={player?.online === false ? 0.4 : 0.9} />
            </mesh>
          ))}
          <Html position={[lx - 0.3, 0.2, lz - 0.3]} style={{ pointerEvents: 'none' }} zIndexRange={[5, 0]}>
            <div
              className="px-2 py-0.5 rounded-full text-[11px] font-bold whitespace-nowrap shadow-lg border border-black/20"
              style={{ backgroundColor: color, color: '#0f172a', opacity: player?.online === false ? 0.6 : 1 }}
            >
              {player ? `${player.name}${plot.slot === coop.mySlot ? ' (you)' : ''}${player.online ? '' : ' · offline'}` : 'Open plot'}
            </div>
          </Html>
        </group>
      );
    })}
  </group>
);

// Where another player is pointing, with their name
const RemoteCursor = ({ x, y, size, color, name }: { x: number; y: number; size: number; color: string; name: string }) => {
  const [wx, , wz] = gridToWorld(x, y, size);
  return (
    <group position={[wx, -0.24, wz]}>
      <mesh rotation={[-Math.PI / 2, 0, Math.PI / 4]} raycast={noRaycast}>
        <ringGeometry args={[0.6, 0.7, 4]} />
        <meshBasicMaterial color={color} toneMapped={false} side={THREE.DoubleSide} depthTest={false} transparent />
      </mesh>
      <Html position={[0, 0.5, 0]} center style={{ pointerEvents: 'none' }} zIndexRange={[6, 0]}>
        <div className="px-1.5 py-0.5 rounded text-[10px] font-bold whitespace-nowrap shadow" style={{ backgroundColor: color, color: '#0f172a' }}>{name}</div>
      </Html>
    </group>
  );
};

// Point the camera at your own plot when a co-op game starts
const FocusOnPlot = ({ target }: { target: [number, number, number] | null }) => {
  const controls = useThree(state => state.controls) as any;
  const camera = useThree(state => state.camera);
  const tx = target?.[0];
  const tz = target?.[2];
  useEffect(() => {
    if (!controls || tx === undefined || tz === undefined) return;
    const offset = camera.position.clone().sub(controls.target);
    controls.target.set(tx, -0.5, tz);
    camera.position.copy(controls.target).add(offset);
    controls.update();
  }, [controls, camera, tx, tz]);
  return null;
};

interface IsoMapProps {
  grid: Grid;
  onTileClick: (x: number, y: number) => void;
  hoveredTool: BuildingType;
  population: number;
  commuters: number; // Employed citizens; each one adds to traffic
  coop?: CoopMapInfo; // Co-op game: plot borders, friends' cursors, build only on your own plot
  onHoverTile?: (tile: { x: number; y: number } | null) => void;
  assets: Record<string, AssetSpec>; // Assets this player can draw, by content id
  placing?: { spec: AssetSpec; rotation: number }; // Monument tool: the asset being placed
}

// A placed monument, drawn once over its whole footprint (a placeholder until its asset is available)
const MonumentOnMap = React.memo(({ tile, spec, size }: { tile: TileData; spec?: AssetSpec; size: number }) => {
  const m = tile.monument!;
  const [fw, fd] = m.footprint;
  const [wx, , wz] = gridToWorld(tile.x + (fw - 1) / 2, tile.y + (fd - 1) / 2, size);
  return (
    <group position={[wx, -0.28, wz]}>
      {spec
        ? <group rotation={[0, -m.rotation * Math.PI / 2, 0]}><AssetModel spec={spec} /></group>
        : <Placeholder footprint={m.footprint} />}
    </group>
  );
});

const footprintOkMat = new THREE.MeshBasicMaterial({ color: '#22c55e', transparent: true, opacity: 0.45, depthWrite: false, toneMapped: false });
const footprintBadMat = new THREE.MeshBasicMaterial({ color: '#ef4444', transparent: true, opacity: 0.45, depthWrite: false, toneMapped: false });

// Monument tool: the footprint under the cursor (green if it fits, red if not) and a ghost of the asset
const MonumentGhost = ({ x, y, spec, rotation, grid, slot }: { x: number; y: number; spec: AssetSpec; rotation: number; grid: Grid; slot: number | null }) => {
  const footprint = rotateFootprint(spec.footprint, rotation);
  const fits = placementProblem(grid, x, y, footprint, slot) === null;
  const size = grid.length;
  const [cx, , cz] = gridToWorld(x + (footprint[0] - 1) / 2, y + (footprint[1] - 1) / 2, size);
  return (
    <group raycast={noRaycast}>
      {footprintTiles(x, y, footprint).map(t => {
        const [wx, , wz] = gridToWorld(t.x, t.y, size);
        const ok = fits || (grid[t.y]?.[t.x]?.buildingType === BuildingType.None && (slot === null || grid[t.y][t.x].owner === slot));
        return <mesh key={`${t.x},${t.y}`} geometry={boxGeo} material={ok ? footprintOkMat : footprintBadMat} position={[wx, -0.25, wz]} scale={[0.96, 0.02, 0.96]} raycast={noRaycast} />;
      })}
      <group position={[cx, -0.28, cz]} rotation={[0, -rotation * Math.PI / 2, 0]}>
        <AssetModel spec={spec} opacity={fits ? 0.7 : 0.35} />
      </group>
    </group>
  );
};

const IsoMap: React.FC<IsoMapProps> = ({ grid, onTileClick, hoveredTool, population, commuters, coop, onHoverTile, assets, placing }) => {
  const [hoveredTile, setHoveredTile] = useState<{x: number, y: number} | null>(null);
  const [cameraView, setCameraView] = useState<CameraView>('3d');
  const [rotateRequest, setRotateRequest] = useState({ id: 0, step: 0 });

  const rotateView = useCallback((step: number) => {
    setRotateRequest(prev => ({ id: prev.id + 1, step }));
  }, []);

  const toggleView = useCallback(() => {
    setCameraView(v => (v === 'top' ? '3d' : 'top'));
  }, []);

  const [walking, setWalking] = useState(false);
  const walkTouchInput = useRef<WalkInput>({ forward: 0, turn: 0 });
  const hasRoads = useMemo(() => grid.some(row => row.some(t => isRoadType(t.buildingType))), [grid]);

  const toggleWalk = useCallback(() => {
    walkTouchInput.current = { forward: 0, turn: 0 };
    setHoveredTile(null);
    setWalking(w => !w);
  }, []);

  // Leave walk view if the last road is removed
  useEffect(() => {
    if (walking && !hasRoads) setWalking(false);
  }, [walking, hasRoads]);

  // Keyboard shortcuts: Q / E rotate, T toggles top view, V toggles walk view, Esc exits walk view
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      const key = e.key.toLowerCase();
      if (key === 'v' && (walking || hasRoads)) toggleWalk();
      else if (walking) { if (key === 'escape') toggleWalk(); }
      else if (key === 'q') rotateView(ROTATE_STEP);
      else if (key === 'e') rotateView(-ROTATE_STEP);
      else if (key === 't') toggleView();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [rotateView, toggleView, toggleWalk, walking, hasRoads]);

  const handleHover = useCallback((x: number, y: number) => {
    setHoveredTile({ x, y });
  }, []);

  const handleLeave = useCallback(() => {
    setHoveredTile(null);
  }, []);

  // Building placement is paused in walk view so drag-to-look doesn't place tiles
  const noop = useCallback(() => {}, []);
  const tileHover = walking ? noop : handleHover;
  const tileLeave = walking ? noop : handleLeave;
  const tileClick = walking ? noop : onTileClick;

  // Co-op: share where you point, and only allow building on your own plot
  const onHoverTileRef = useRef(onHoverTile);
  onHoverTileRef.current = onHoverTile;
  const hoverX = hoveredTile?.x;
  const hoverY = hoveredTile?.y;
  useEffect(() => {
    onHoverTileRef.current?.(hoverX === undefined || hoverY === undefined ? null : { x: hoverX, y: hoverY });
  }, [hoverX, hoverY]);

  const hoveredData = hoveredTile ? grid[hoveredTile.y]?.[hoveredTile.x] : undefined;
  // In co-op: your own land; the river for the Bridge tool; a bridge for bulldozing (both become proposals)
  const canEditHovered = !!hoveredData && (
    hoveredTool === BuildingType.Bridge ? hoveredData.buildingType === BuildingType.Water
    : hoveredData.buildingType === BuildingType.Bridge ? hoveredTool === BuildingType.None
    : hoveredData.buildingType !== BuildingType.Water && (!coop || hoveredData.owner === coop.mySlot)
  );

  const focusTarget = useMemo(() => {
    if (!coop) return null;
    const [gx, gy] = plotCenter(coop.plotSize, coop.mySlot);
    return gridToWorld(gx, gy, grid.length);
  }, [coop?.plotSize, coop?.mySlot, grid.length]); // eslint-disable-line react-hooks/exhaustive-deps

  // Preview Logic
  const showPreview = hoveredTile && canEditHovered && grid[hoveredTile.y][hoveredTile.x].buildingType === BuildingType.None && hoveredTool !== BuildingType.None;
  const previewColor = showPreview ? BUILDINGS[hoveredTool].color : 'white';
  const isBulldoze = hoveredTool === BuildingType.None;
  
  const gridSize = grid.length;
  // Shadow camera covers the whole island at any grid size
  const shadowExtent = Math.max(15, gridSize / 2 + 2);

  const previewPos = hoveredTile ? gridToWorld(hoveredTile.x, hoveredTile.y, gridSize) : [0,0,0];

  // Warning markers: buildings without a road, and houses under factory smog
  const monumentAnchors = useMemo(() => grid.flat().filter(t => t.monument), [grid]);

  const closedKey = coop?.closedMonuments.join('|') ?? '';
  const closedSet = useMemo(() => new Set(closedKey ? closedKey.split('|') : []), [closedKey]);
  const tileStatus = useMemo(() => grid.map(row => row.map(t => ({
    // A monument shows its sign once, over its anchor tile
    noRoad: needsRoad(t.buildingType) && !t.anchor && !buildingHasRoad(grid, t),
    closed: !!t.monument && closedSet.has(`${t.x},${t.y}`),
    smog: isPolluted(grid, t.x, t.y),
  }))), [grid, closedSet]);

  // A few cars always drive around; more join as commuters fill the roads (so jams show up as queues)
  const roadCount = useMemo(() => grid.reduce((n, row) => n + row.filter(t => isRoadType(t.buildingType)).length, 0), [grid]);
  const carCount = roadCount < 2 ? 0 : Math.min(MAX_CARS, roadCount * 3, Math.min(roadCount, 4) + Math.round(commuters / 3));

  return (
    <div className="absolute inset-0 bg-sky-900 touch-none">
      <Canvas shadows dpr={[1, 1.5]} gl={{ antialias: true }}>
        <OrthographicCamera makeDefault zoom={45} position={[20, 20, 20]} near={-100} far={200} />
        
        {walking ? (
          <WalkController grid={grid} touchInput={walkTouchInput} />
        ) : (
          <>
            <MapControls
              makeDefault
              enableRotate={true}
              enableZoom={true}
              minZoom={20}
              maxZoom={120}
              maxPolarAngle={Math.PI / 2.2}
              minPolarAngle={0.1}
              target={[0,-0.5,0]}
            />
            <CameraRig view={cameraView} rotateRequest={rotateRequest} />
            <FocusOnPlot target={focusTarget} />
          </>
        )}

        <DayNightCycle shadowExtent={shadowExtent} />
        <Environment preset="city" />

        <EnvironmentEffects size={gridSize} />

        <group>
          {grid.map((row, y) =>
            row.map((tile, x) => {
              // Calculate world position once per tile
              const [wx, _, wz] = gridToWorld(x, y, gridSize);
              
              return (
              <React.Fragment key={`${x}-${y}`}>
                <GroundTile 
                    type={tile.buildingType} 
                    x={x} y={y} 
                    grid={grid}
                    onHover={tileHover}
                    onLeave={tileLeave}
                    onClick={tileClick}
                />
                
                {/* Building visual - apply world position to group to align with ground tile */}
                <group position={[wx, 0, wz]} raycast={() => null}>
                    {tile.buildingType !== BuildingType.None && tile.buildingType !== BuildingType.Water && !isRoadType(tile.buildingType) && (
                      <ProceduralBuilding 
                        type={tile.buildingType} 
                        baseColor={BUILDINGS[tile.buildingType].color} 
                        x={x} y={y}
                      />
                    )}
                    {tileStatus[y][x].noRoad && <NoRoadSign />}
                    {tileStatus[y][x].closed && !tileStatus[y][x].noRoad && <NoRoadSign color="#f59e0b" />}
                    {tileStatus[y][x].smog && <Smog />}
                </group>
              </React.Fragment>
            )})
          )}

          {/* Visual Elements - disable pointer events */}
          <group raycast={() => null}>
            <TrafficSystem grid={grid} carCount={carCount} />
            <PopulationSystem population={population} grid={grid} />

            {monumentAnchors.map(t => (
              <group key={`m${t.x},${t.y}`}><MonumentOnMap tile={t} spec={assets[t.monument!.assetId]} size={gridSize} /></group>
            ))}
            {placing && hoveredTool === BuildingType.Monument && hoveredTile && (
              <MonumentGhost x={hoveredTile.x} y={hoveredTile.y} spec={placing.spec} rotation={placing.rotation} grid={grid} slot={coop ? coop.mySlot : null} />
            )}

            {coop && <PlotBorders coop={coop} size={gridSize} />}
            {coop && coop.pendingBridges.map((tiles: { x: number; y: number }[], i: number) => (
              <group key={i}><GhostBridge tiles={tiles} size={gridSize} /></group>
            ))}
            {coop && (Object.entries(coop.cursors) as [string, { x: number; y: number }][]).map(([slot, tile]) => {
              const player = coop.players.find((p: CoopPlayer) => p.slot === Number(slot));
              if (!player || Number(slot) === coop.mySlot) return null;
              return (
                <group key={slot}>
                  <RemoteCursor x={tile.x} y={tile.y} size={gridSize} color={player.color} name={player.name} />
                </group>
              );
            })}

            {/* Placement Preview */}
            {showPreview && hoveredTile && (
              <group position={[previewPos[0], 0, previewPos[2]]}>
                <Float speed={3} rotationIntensity={0} floatIntensity={0.1} floatingRange={[0, 0.1]}>
                  <ProceduralBuilding 
                    type={hoveredTool} 
                    baseColor={previewColor} 
                    x={hoveredTile.x} 
                    y={hoveredTile.y} 
                    transparent 
                    opacity={0.7} 
                  />
                </Float>
              </group>
            )}

            {/* Highlight */}
            {hoveredTile && !(placing && hoveredTool === BuildingType.Monument) && (
              <Cursor 
                x={hoveredTile.x} 
                y={hoveredTile.y} 
                size={gridSize}
                color={!canEditHovered ? '#64748b' : isBulldoze ? '#ef4444' : (showPreview ? '#ffffff' : '#000000')}
              />
            )}
          </group>
        </group>
        
        <SoftShadows size={10} samples={8} />
      </Canvas>

      {/* Camera Controls */}
      <div className="absolute right-2 md:right-4 top-1/2 -translate-y-1/2 z-20 flex flex-col gap-1.5 p-1.5 bg-gray-900/90 border border-gray-700 rounded-xl shadow-2xl backdrop-blur-md">
        {walking ? (
          <CameraButton onClick={toggleWalk} title="Exit walk view (Esc)" label="Exit" icon={<CloseIcon />} />
        ) : (
          <>
            <CameraButton
              onClick={toggleView}
              title={cameraView === 'top' ? 'Switch to 3D view (T)' : 'Switch to top view (T)'}
              label={cameraView === 'top' ? '3D' : 'Top'}
              icon={cameraView === 'top' ? <PerspectiveIcon /> : <TopViewIcon />}
            />
            <CameraButton onClick={() => rotateView(ROTATE_STEP)} title="Rotate left (Q)" label="Left" icon={<RotateLeftIcon />} />
            <CameraButton onClick={() => rotateView(-ROTATE_STEP)} title="Rotate right (E)" label="Right" icon={<RotateRightIcon />} />
            <div className="h-px bg-gray-700 mx-1" />
            <CameraButton
              onClick={toggleWalk}
              title={hasRoads ? 'Walk the streets (V)' : 'Build a road to walk the streets'}
              label="Walk"
              icon={<WalkIcon />}
              disabled={!hasRoads}
            />
          </>
        )}
      </div>

      {/* Walk View: hint + touch controls */}
      {walking && (
        <div className="absolute left-2 md:left-4 top-1/2 -translate-y-1/2 z-20 flex flex-col items-center gap-2">
          <div className="hidden md:flex flex-col gap-1.5 text-[10px] text-gray-300 bg-gray-900/90 border border-gray-700 rounded-xl px-3 py-2.5 shadow-2xl backdrop-blur-md">
            <span className="text-[9px] text-gray-400 uppercase font-bold tracking-widest mb-0.5">Walk Controls</span>
            <span className="flex items-center gap-1"><Kbd>W</Kbd><Kbd>A</Kbd><Kbd>S</Kbd><Kbd>D</Kbd><span className="ml-1">Move</span></span>
            <span className="flex items-center gap-1"><Kbd>Shift</Kbd><span className="ml-1">Run</span></span>
            <span className="flex items-center gap-1"><Kbd>Drag</Kbd><span className="ml-1">Look</span></span>
            <span className="flex items-center gap-1"><Kbd>Esc</Kbd><span className="ml-1">Exit</span></span>
          </div>
          <div className="grid grid-cols-3 gap-1 p-1.5 bg-gray-900/90 border border-gray-700 rounded-xl shadow-2xl backdrop-blur-md">
            <span />
            <HoldButton input={walkTouchInput} field="forward" value={1} icon={<ChevronUpIcon className="w-5 h-5" />} title="Walk forward" />
            <span />
            <HoldButton input={walkTouchInput} field="turn" value={1} icon={<ChevronLeftIcon className="w-5 h-5" />} title="Turn left" />
            <HoldButton input={walkTouchInput} field="forward" value={-1} icon={<ChevronDownIcon className="w-5 h-5" />} title="Walk back" />
            <HoldButton input={walkTouchInput} field="turn" value={-1} icon={<ChevronRightIcon className="w-5 h-5" />} title="Turn right" />
          </div>
        </div>
      )}
    </div>
  );
};

export default IsoMap;