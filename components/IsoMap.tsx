/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
*/
import React, { useState, useMemo, useRef, useEffect, useCallback } from 'react';
import { Canvas, useFrame, useThree, ThreeElements } from '@react-three/fiber';
import { MapControls, Environment, SoftShadows, Instance, Instances, Float, useTexture, Outlines, OrthographicCamera, PerspectiveCamera } from '@react-three/drei';
import * as THREE from 'three';
import { MathUtils } from 'three';
import { Grid, BuildingType, TileData } from '../types';
import { BUILDINGS } from '../constants';
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

// Deterministic random based on coordinates
const getHash = (x: number, y: number) => Math.abs(Math.sin(x * 12.9898 + y * 78.233) * 43758.5453) % 1;
const getRandomRange = (min: number, max: number) => Math.random() * (max - min) + min;

// Shared Geometries
const boxGeo = new THREE.BoxGeometry(1, 1, 1);
const cylinderGeo = new THREE.CylinderGeometry(1, 1, 1, 8);
const coneGeo = new THREE.ConeGeometry(1, 1, 4);
const sphereGeo = new THREE.SphereGeometry(1, 8, 8);

// --- 1. Advanced Procedural Buildings ---

// FIX: Wrap component in React.memo to ensure TypeScript recognizes it as a component that accepts a 'key' prop.
const WindowBlock = React.memo(({ position, scale }: { position: [number, number, number], scale: [number, number, number] }) => (
  <mesh geometry={boxGeo} position={position} scale={scale}>
    <meshStandardMaterial color="#bfdbfe" emissive="#bfdbfe" emissiveIntensity={0.2} roughness={0.1} metalness={0.8} />
  </mesh>
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
          case BuildingType.Residential:
            if (variant < 33) {
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
            } else if (variant < 66) {
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

const carColors = ['#ef4444', '#3b82f6', '#eab308', '#ffffff', '#1f2937', '#f97316'];

const TrafficSystem = ({ grid }: { grid: Grid }) => {
  const roadTiles = useMemo(() => {
    const roads: {x: number, y: number}[] = [];
    grid.forEach(row => row.forEach(tile => {
      if (tile.buildingType === BuildingType.Road) roads.push({x: tile.x, y: tile.y});
    }));
    return roads;
  }, [grid]);

  const carCount = Math.min(roadTiles.length, 30);
  const carsRef = useRef<THREE.InstancedMesh>(null);
  const carsState = useRef<Float32Array>(new Float32Array(0)); 
  const dummy = useMemo(() => new THREE.Object3D(), []);
  const colors = useMemo(() => new Float32Array(0), []);

  useEffect(() => {
    if (roadTiles.length < 2) return;
    carsState.current = new Float32Array(carCount * 6);
    const newColors = new Float32Array(carCount * 3);

    for (let i = 0; i < carCount; i++) {
      const startNode = roadTiles[Math.floor(Math.random() * roadTiles.length)];
      carsState.current[i*6 + 0] = startNode.x;
      carsState.current[i*6 + 1] = startNode.y;
      carsState.current[i*6 + 2] = startNode.x;
      carsState.current[i*6 + 3] = startNode.y;
      carsState.current[i*6 + 4] = 1; // force pick new target
      carsState.current[i*6 + 5] = getRandomRange(0.01, 0.03); // speed

      const color = new THREE.Color(carColors[Math.floor(Math.random() * carColors.length)]);
      newColors[i*3] = color.r; newColors[i*3+1] = color.g; newColors[i*3+2] = color.b;
    }

    if (carsRef.current) {
        carsRef.current.instanceColor = new THREE.InstancedBufferAttribute(newColors, 3);
    }
  }, [roadTiles, carCount]);

  useFrame(() => {
    if (!carsRef.current || roadTiles.length < 2 || carsState.current.length === 0) return;

    for (let i = 0; i < carCount; i++) {
      const idx = i * 6;
      let curX = carsState.current[idx];
      let curY = carsState.current[idx+1];
      let tarX = carsState.current[idx+2];
      let tarY = carsState.current[idx+3];
      let progress = carsState.current[idx+4];
      const speed = carsState.current[idx+5];

      progress += speed;

      if (progress >= 1) {
        curX = tarX;
        curY = tarY;
        progress = 0;
        
        const neighbors = roadTiles.filter(t => 
          (Math.abs(t.x - curX) === 1 && t.y === curY) || 
          (Math.abs(t.y - curY) === 1 && t.x === curX)
        );

        if (neighbors.length > 0) {
            // Simple pathfinding: avoid going back immediately
            const valid = neighbors.length > 1 
                ? neighbors.filter(n => Math.abs(n.x - carsState.current[idx]) > 0.1 || Math.abs(n.y - carsState.current[idx+1]) > 0.1)
                : neighbors;
            
            const next = valid.length > 0 
                ? valid[Math.floor(Math.random() * valid.length)]
                : neighbors[0];
            
            tarX = next.x;
            tarY = next.y;
        } else {
            const rnd = roadTiles[Math.floor(Math.random() * roadTiles.length)];
            curX = rnd.x; curY = rnd.y; tarX = rnd.x; tarY = rnd.y;
        }
      }

      carsState.current[idx] = curX;
      carsState.current[idx+1] = curY;
      carsState.current[idx+2] = tarX;
      carsState.current[idx+3] = tarY;
      carsState.current[idx+4] = progress;

      // Interpolate position
      const gx = MathUtils.lerp(curX, tarX, progress);
      const gy = MathUtils.lerp(curY, tarY, progress);

      // Determine driving side offset
      const dx = tarX - curX;
      const dy = tarY - curY;
      const angle = Math.atan2(dy, dx);
      
      // Offset to right side relative to movement
      const offsetAmt = 0.15;
      // Normals: (-dy, dx)
      const len = Math.sqrt(dx*dx + dy*dy) || 1;
      const offX = (-dy/len) * offsetAmt;
      const offY = (dx/len) * offsetAmt;

      const [wx, _, wz] = gridToWorld(gx + offX, gy + offY, grid.length);

      // Road surface is approx -0.3. Car height 0.15.
      dummy.position.set(wx, -0.3 + 0.075, wz);
      dummy.rotation.set(0, -angle, 0);
      // Car dimensions (Length(X), Height(Y), Width(Z) assuming 0 rotation aligns with X)
      dummy.scale.set(0.5, 0.15, 0.3); 
      
      dummy.updateMatrix();
      carsRef.current.setMatrixAt(i, dummy.matrix);
    }
    carsRef.current.instanceMatrix.needsUpdate = true;
  });

  if (roadTiles.length < 2) return null;

  return (
    <instancedMesh ref={carsRef} args={[boxGeo, undefined, carCount]} castShadow>
      <meshStandardMaterial roughness={0.5} metalness={0.3} />
    </instancedMesh>
  );
};

const clothesColors = ['#ef4444', '#3b82f6', '#10b981', '#f59e0b', '#8b5cf6', '#ec4899', '#ffffff'];

const PopulationSystem = ({ population, grid }: { population: number, grid: Grid }) => {
    const agentCount = Math.min(Math.floor(population / 2), 300); 
    const meshRef = useRef<THREE.InstancedMesh>(null);
    
    // Find tiles where people can walk (Roads, Parks, empty ground)
    const walkableTiles = useMemo(() => {
        const tiles: {x: number, y: number}[] = [];
        grid.forEach(row => row.forEach(tile => {
          if (tile.buildingType === BuildingType.Road || tile.buildingType === BuildingType.Park || tile.buildingType === BuildingType.None) {
            tiles.push({x: tile.x, y: tile.y});
          }
        }));
        return tiles;
    }, [grid]);
    
    const agentsState = useRef<Float32Array>(new Float32Array(0));
    const dummy = useMemo(() => new THREE.Object3D(), []);
    
    useEffect(() => {
        if (agentCount === 0 || walkableTiles.length === 0) return;
        agentsState.current = new Float32Array(agentCount * 6);
        const newColors = new Float32Array(agentCount * 3);

        for(let i=0; i<agentCount; i++) {
            const t = walkableTiles[Math.floor(Math.random() * walkableTiles.length)];
            // Spawn with random offset in tile
            const x = t.x + getRandomRange(-0.4, 0.4);
            const y = t.y + getRandomRange(-0.4, 0.4);

            agentsState.current[i*6+0] = x;
            agentsState.current[i*6+1] = y;
            
            // Initial target
            const tt = walkableTiles[Math.floor(Math.random() * walkableTiles.length)];
            agentsState.current[i*6+2] = tt.x + getRandomRange(-0.4, 0.4);
            agentsState.current[i*6+3] = tt.y + getRandomRange(-0.4, 0.4);
            
            agentsState.current[i*6+4] = getRandomRange(0.005, 0.015); // speed
            agentsState.current[i*6+5] = Math.random() * Math.PI * 2; // anim

            const c = new THREE.Color(clothesColors[Math.floor(Math.random() * clothesColors.length)]);
            newColors[i*3] = c.r; newColors[i*3+1] = c.g; newColors[i*3+2] = c.b;
        }

        if (meshRef.current) {
            meshRef.current.instanceColor = new THREE.InstancedBufferAttribute(newColors, 3);
        }
    }, [agentCount, walkableTiles]);

    useFrame((state) => {
        if (!meshRef.current || agentCount === 0 || agentsState.current.length === 0) return;
        const time = state.clock.elapsedTime;

        for(let i=0; i<agentCount; i++) {
            const idx = i*6;
            let x = agentsState.current[idx];
            let y = agentsState.current[idx+1];
            let tx = agentsState.current[idx+2];
            let ty = agentsState.current[idx+3];
            const speed = agentsState.current[idx+4];
            const animOffset = agentsState.current[idx+5];

            const dx = tx - x;
            const dy = ty - y;
            const dist = Math.sqrt(dx*dx + dy*dy);

            if (dist < 0.1) {
                // Pick new random target from walkable
                if (walkableTiles.length > 0) {
                    const tt = walkableTiles[Math.floor(Math.random() * walkableTiles.length)];
                    tx = tt.x + getRandomRange(-0.4, 0.4);
                    ty = tt.y + getRandomRange(-0.4, 0.4);
                    agentsState.current[idx+2] = tx;
                    agentsState.current[idx+3] = ty;
                }
            } else {
                x += (dx/dist) * speed;
                y += (dy/dist) * speed;
                agentsState.current[idx] = x;
                agentsState.current[idx+1] = y;
            }

            const [wx, _, wz] = gridToWorld(x, y, grid.length);

            // Walking bounce
            const bounce = Math.abs(Math.sin(time * 10 + animOffset)) * 0.03;

            // Person dimensions
            const height = 0.2;
            const width = 0.08;
            // Ground level approx -0.3 to -0.4
            const groundY = -0.35; 

            dummy.position.set(wx, groundY + height/2 + bounce, wz);
            dummy.rotation.set(0, -Math.atan2(dy, dx), 0);
            dummy.scale.set(width, height, width);
            
            dummy.updateMatrix();
            meshRef.current.setMatrixAt(i, dummy.matrix);
        }
        meshRef.current.instanceMatrix.needsUpdate = true;
    });

    if (agentCount === 0) return null;

    return (
        <instancedMesh ref={meshRef} args={[boxGeo, undefined, agentCount]} castShadow>
            <meshStandardMaterial roughness={0.8} />
        </instancedMesh>
    )
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

const RoadMarkings = React.memo(({ x, y, grid, yOffset }: { x: number; y: number; grid: Grid; yOffset: number }) => {
  const lineMaterial = useMemo(() => new THREE.MeshStandardMaterial({ color: '#fbbf24' }), []);
  const lineGeo = useMemo(() => new THREE.PlaneGeometry(0.1, 0.5), []);

  const hasUp = y > 0 && grid[y - 1][x].buildingType === BuildingType.Road;
  const hasDown = y < grid.length - 1 && grid[y + 1][x].buildingType === BuildingType.Road;
  const hasLeft = x > 0 && grid[y][x - 1].buildingType === BuildingType.Road;
  const hasRight = x < grid.length - 1 && grid[y][x + 1].buildingType === BuildingType.Road;

  const connections = [hasUp, hasDown, hasLeft, hasRight].filter(Boolean).length;
  
  // Isolated road piece: draw a default line
  if (connections === 0) {
    return (
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, yOffset, 0]} geometry={lineGeo} material={lineMaterial} />
    );
  }

  return (
    <group rotation={[-Math.PI / 2, 0, 0]} position={[0, yOffset, 0]}>
      {/* Center point for junctions to fill the gap, lifted slightly to avoid z-fighting */}
      {(hasUp || hasDown) && (hasLeft || hasRight) && (
        <mesh position={[0, 0, 0.005]} material={lineMaterial}>
           <planeGeometry args={[0.12, 0.12]} />
        </mesh>
      )}

      {hasUp && <mesh position={[0, 0.25, 0]} geometry={lineGeo} material={lineMaterial} />}
      {hasDown && <mesh position={[0, -0.25, 0]} geometry={lineGeo} material={lineMaterial} />}
      {hasLeft && <mesh position={[-0.25, 0, 0]} rotation={[0, 0, Math.PI / 2]} geometry={lineGeo} material={lineMaterial} />}
      {hasRight && <mesh position={[0.25, 0, 0]} rotation={[0, 0, Math.PI / 2]} geometry={lineGeo} material={lineMaterial} />}
    </group>
  );
});

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
  } else if (type === BuildingType.Road) {
    color = '#374151';
    topY = -0.29; // slightly higher
  } else {
    color = '#d1d5db'; // concrete base
    topY = -0.28;
  }

  const centerY = topY - thickness/2;

  return (
    <mesh 
        position={[wx, centerY, wz]} 
        receiveShadow castShadow
        onPointerEnter={(e) => { e.stopPropagation(); onHover(x, y); }}
        onPointerOut={(e) => { e.stopPropagation(); onLeave(); }}
        onPointerDown={(e) => {
            e.stopPropagation();
            if (e.button === 0) onClick(x, y);
        }}
    >
      <boxGeometry args={[1, thickness, 1]} />
      <meshStandardMaterial color={color} flatShading roughness={1} />
      {type === BuildingType.Road && <RoadMarkings x={x} y={y} grid={grid} yOffset={thickness / 2 + 0.001} />}
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
  return ix >= 0 && iy >= 0 && ix < grid.length && iy < grid.length && grid[iy][ix].buildingType === BuildingType.Road;
};

// Start on the road nearest the map centre, facing along the road
const findWalkSpawn = (grid: Grid) => {
  const center = (grid.length - 1) / 2;
  let best: { x: number; y: number } | null = null;
  let bestDist = Infinity;
  grid.forEach(row => row.forEach(tile => {
    if (tile.buildingType !== BuildingType.Road) return;
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

interface IsoMapProps {
  grid: Grid;
  onTileClick: (x: number, y: number) => void;
  hoveredTool: BuildingType;
  population: number;
}

const IsoMap: React.FC<IsoMapProps> = ({ grid, onTileClick, hoveredTool, population }) => {
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
  const hasRoads = useMemo(() => grid.some(row => row.some(t => t.buildingType === BuildingType.Road)), [grid]);

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

  // Preview Logic
  const showPreview = hoveredTile && grid[hoveredTile.y][hoveredTile.x].buildingType === BuildingType.None && hoveredTool !== BuildingType.None;
  const previewColor = showPreview ? BUILDINGS[hoveredTool].color : 'white';
  const isBulldoze = hoveredTool === BuildingType.None;
  
  const gridSize = grid.length;
  // Shadow camera covers the whole island at any grid size
  const shadowExtent = Math.max(15, gridSize / 2 + 2);

  const previewPos = hoveredTile ? gridToWorld(hoveredTile.x, hoveredTile.y, gridSize) : [0,0,0];

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
          </>
        )}

        <ambientLight intensity={0.5} color="#cceeff" />
        <directionalLight
          castShadow
          position={[15, 20, 10]}
          intensity={2}
          color="#fffbeb"
          shadow-mapSize={[2048, 2048]}
          shadow-camera-left={-shadowExtent} shadow-camera-right={shadowExtent}
          shadow-camera-top={shadowExtent} shadow-camera-bottom={-shadowExtent}
        >
        </directionalLight>
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
                    {tile.buildingType !== BuildingType.None && tile.buildingType !== BuildingType.Road && (
                      <ProceduralBuilding 
                        type={tile.buildingType} 
                        baseColor={BUILDINGS[tile.buildingType].color} 
                        x={x} y={y} 
                      />
                    )}
                </group>
              </React.Fragment>
            )})
          )}

          {/* Visual Elements - disable pointer events */}
          <group raycast={() => null}>
            <TrafficSystem grid={grid} />
            <PopulationSystem population={population} grid={grid} />

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
            {hoveredTile && (
              <Cursor 
                x={hoveredTile.x} 
                y={hoveredTile.y} 
                size={gridSize}
                color={isBulldoze ? '#ef4444' : (showPreview ? '#ffffff' : '#000000')} 
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