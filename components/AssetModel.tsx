/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
*/
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useFrame } from '@react-three/fiber';
import { Billboard } from '@react-three/drei';
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { AssetSpec, SolidPart, expandParts, glbBytes, maxHeight } from '../services/assets/spec';
import { daylight } from '../services/roads';

// Unit shapes: each fills a 1×1×1 box centred on the origin, so a part's `size` is just its scale
const UNIT: Record<SolidPart['shape'], THREE.BufferGeometry> = {
  box: new THREE.BoxGeometry(1, 1, 1),
  cylinder: new THREE.CylinderGeometry(0.5, 0.5, 1, 24),
  cone: new THREE.ConeGeometry(0.5, 1, 24),
  sphere: new THREE.SphereGeometry(0.5, 20, 14),
  // A flat ring 0.3 thick; scaled so its bounding box matches `size`
  torus: (() => { const g = new THREE.TorusGeometry(0.35, 0.15, 12, 32); g.rotateX(Math.PI / 2); g.scale(1, 1 / 0.3, 1); return g; })(),
  pyramid: (() => { const g = new THREE.ConeGeometry(Math.SQRT1_2, 1, 4); g.rotateY(Math.PI / 4); return g; })(),
};
const DEG = Math.PI / 180;
const noRaycast = () => null;

interface AssetModelProps {
  spec: AssetSpec;
  opacity?: number; // Placement ghosts are translucent
  night?: number; // 0-1 to force day/night (Studio preview); otherwise follows the game's clock
}

// Draws an asset at the origin (ground at y = 0, footprint centred)
export const AssetModel = React.memo(({ spec, opacity = 1, night }: AssetModelProps) => {
  const parts = useMemo(() => expandParts(spec.parts), [spec]);

  // One material per distinct look (parts often share colours)
  const { materials, nightGlow } = useMemo(() => {
    const cache = new Map<string, THREE.MeshStandardMaterial>();
    const nightGlow: { mat: THREE.MeshStandardMaterial; glow: number }[] = [];
    const materials = parts.map(p => {
      const key = `${p.color}|${p.metal}|${p.rough}|${p.opacity}|${p.glow}|${p.glowAtNight}`;
      let mat = cache.get(key);
      if (!mat) {
        const alpha = p.opacity * opacity;
        mat = new THREE.MeshStandardMaterial({
          color: p.color, metalness: p.metal, roughness: p.rough,
          transparent: alpha < 1, opacity: alpha, depthWrite: alpha >= 1,
          emissive: p.glow > 0 ? p.color : '#000000', emissiveIntensity: p.glowAtNight ? 0 : p.glow,
          toneMapped: p.glow <= 1.5,
        });
        cache.set(key, mat);
        if (p.glow > 0 && p.glowAtNight) nightGlow.push({ mat, glow: p.glow });
      }
      return mat;
    });
    return { materials, nightGlow };
  }, [parts, opacity]);

  useEffect(() => () => { new Set<THREE.Material>(materials).forEach(m => m.dispose()); }, [materials]);

  // Lamps and windows come on after dark
  const lit = useRef(-1);
  useFrame(({ clock }) => {
    if (nightGlow.length === 0) return;
    const n = night ?? 1 - daylight(clock.elapsedTime);
    if (Math.abs(n - lit.current) < 0.01) return;
    lit.current = n;
    nightGlow.forEach(({ mat, glow }) => { mat.emissiveIntensity = glow * Math.min(1, n * 1.2); });
  });

  const still = parts.filter(p => !p.animate);
  const moving = parts.map((p, i) => ({ p, i })).filter(({ p }) => p.animate);

  return (
    <group>
      {parts.map((p, i) => !p.animate && (
        <mesh
          key={i}
          geometry={UNIT[p.shape]}
          material={materials[i]}
          position={p.position}
          rotation={[p.rotation[0] * DEG, p.rotation[1] * DEG, p.rotation[2] * DEG]}
          scale={p.size}
          castShadow={opacity >= 1}
          receiveShadow
          raycast={noRaycast}
        />
      ))}
      {moving.map(({ p, i }) => <group key={i}><AnimatedPart part={p} material={materials[i]} /></group>)}
      {still.length === 0 && moving.length === 0 && !spec.model && <Placeholder footprint={spec.footprint} />}
      {spec.model && <GlbModel b64={spec.model.glb} footprint={spec.footprint} height={maxHeight(spec.tier, spec.footprint)} opacity={opacity} />}
    </group>
  );
});

// Spins around the asset's vertical axis and/or bobs up and down
const AnimatedPart = ({ part, material }: { part: SolidPart; material: THREE.Material }) => {
  const ref = useRef<THREE.Group>(null);
  useFrame(({ clock }) => {
    if (!ref.current || !part.animate) return;
    const t = clock.elapsedTime;
    ref.current.rotation.y = -part.animate.spin * DEG * t;
    ref.current.position.y = Math.sin(t * 2) * part.animate.bob;
  });
  return (
    <group ref={ref}>
      <mesh
        geometry={UNIT[part.shape]}
        material={material}
        position={part.position}
        rotation={[part.rotation[0] * DEG, part.rotation[1] * DEG, part.rotation[2] * DEG]}
        scale={part.size}
        castShadow
        raycast={noRaycast}
      />
    </group>
  );
};

// --- Imported .glb models ---

const glbCache = new Map<string, Promise<THREE.Group>>();

const loadGlb = (b64: string): Promise<THREE.Group> => {
  const key = `${b64.length}:${b64.slice(0, 48)}:${b64.slice(-48)}`;
  let p = glbCache.get(key);
  if (!p) {
    // Self-contained only: anything that isn't embedded data is never fetched
    const manager = new THREE.LoadingManager();
    manager.setURLModifier(url => (url.startsWith('data:') || url.startsWith('blob:') ? url : 'data:,'));
    const bytes = glbBytes(b64);
    p = new Promise((resolve, reject) => {
      new GLTFLoader(manager).parse(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer, '', gltf => resolve(gltf.scene), reject);
    });
    glbCache.set(key, p);
  }
  return p;
};

const GlbModel = ({ b64, footprint, height, opacity }: { b64: string; footprint: [number, number]; height: number; opacity: number }) => {
  const [scene, setScene] = useState<THREE.Group | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let alive = true;
    loadGlb(b64).then(s => {
      if (!alive) return;
      // Fit inside the footprint and height limit, standing on the ground
      const copy = s.clone(true);
      const box = new THREE.Box3().setFromObject(copy);
      const size = box.getSize(new THREE.Vector3());
      const k = Math.min((footprint[0] * 0.95) / (size.x || 1), (footprint[1] * 0.95) / (size.z || 1), height / (size.y || 1));
      copy.scale.multiplyScalar(k);
      const fitted = new THREE.Box3().setFromObject(copy);
      const centre = fitted.getCenter(new THREE.Vector3());
      copy.position.sub(new THREE.Vector3(centre.x, fitted.min.y, centre.z));
      copy.traverse(o => {
        const m = o as THREE.Mesh;
        if (!m.isMesh) return;
        m.castShadow = true;
        m.receiveShadow = true;
        m.raycast = noRaycast;
        if (opacity < 1) {
          const mats = (Array.isArray(m.material) ? m.material : [m.material]).map(mat => { const c = mat.clone(); c.transparent = true; c.opacity = opacity; return c; });
          m.material = Array.isArray(m.material) ? mats : mats[0];
        }
      });
      setScene(copy);
    }).catch(() => alive && setFailed(true));
    return () => { alive = false; };
  }, [b64, footprint, height, opacity]);

  if (failed) return <Placeholder footprint={footprint} />;
  return scene ? <primitive object={scene} /> : null;
};

// --- Placeholder: scaffolding with a "?" (asset not available yet) ---

const poleMat = new THREE.MeshStandardMaterial({ color: '#a16207', roughness: 0.9 });
const sheetMat = new THREE.MeshStandardMaterial({ color: '#f59e0b', transparent: true, opacity: 0.35, side: THREE.DoubleSide, depthWrite: false });
const markMat = new THREE.MeshBasicMaterial({ color: '#f59e0b', toneMapped: false });

export const Placeholder = ({ footprint }: { footprint: [number, number] }) => {
  const [w, d] = [footprint[0] * 0.8, footprint[1] * 0.8];
  const h = 1;
  const corners: [number, number][] = [[-w / 2, -d / 2], [w / 2, -d / 2], [-w / 2, d / 2], [w / 2, d / 2]];
  return (
    <group>
      {corners.map(([x, z], i) => (
        <mesh key={i} geometry={UNIT.box} material={poleMat} position={[x, h / 2, z]} scale={[0.04, h, 0.04]} castShadow raycast={noRaycast} />
      ))}
      {[0.35, 0.7].map(y => (
        <group key={y}>
          <mesh geometry={UNIT.box} material={poleMat} position={[0, y, -d / 2]} scale={[w, 0.03, 0.03]} raycast={noRaycast} />
          <mesh geometry={UNIT.box} material={poleMat} position={[0, y, d / 2]} scale={[w, 0.03, 0.03]} raycast={noRaycast} />
          <mesh geometry={UNIT.box} material={poleMat} position={[-w / 2, y, 0]} scale={[0.03, 0.03, d]} raycast={noRaycast} />
          <mesh geometry={UNIT.box} material={poleMat} position={[w / 2, y, 0]} scale={[0.03, 0.03, d]} raycast={noRaycast} />
        </group>
      ))}
      <mesh geometry={UNIT.box} material={sheetMat} position={[0, h / 2, 0]} scale={[w * 0.98, h, d * 0.98]} raycast={noRaycast} />
      <Billboard position={[0, h + 0.35, 0]}>
        {/* A "?" drawn from simple shapes */}
        <mesh material={markMat} position={[0, 0.12, 0]} raycast={noRaycast}><torusGeometry args={[0.1, 0.035, 8, 20, Math.PI * 1.5]} /></mesh>
        <mesh material={markMat} position={[0.0, -0.03, 0]} raycast={noRaycast}><boxGeometry args={[0.06, 0.1, 0.02]} /></mesh>
        <mesh material={markMat} position={[0, -0.14, 0]} raycast={noRaycast}><circleGeometry args={[0.04, 12]} /></mesh>
      </Billboard>
    </group>
  );
};
