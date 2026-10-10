/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
*/
import { AssetTier } from '../../types';
import { ASSET_TIERS, LICENCE_DAY_OPTIONS, MAX_FOOTPRINT, MAX_PROFIT_SHARE } from '../../constants';

/**
 * Player-made assets ("shape scripts"). An asset is plain data: a list of simple shapes, plus an
 * optional embedded .glb model. Nothing in it can run code, so assets are safe to share with friends.
 *
 * Coordinates: 1 unit = 1 tile, y is up, y = 0 is the ground. The footprint is centred on the origin,
 * so a [w, d] footprint spans x in [-w/2, w/2] and z in [-d/2, d/2].
 */

export const ASSET_FORMAT = 'skymetro-asset';
export const ASSET_VERSION = 1;
export const MAX_PARTS = 300; // After repeat/radial copies are expanded
export const MAX_GLB_BYTES = 2 * 1024 * 1024;
export const SHAPES = ['box', 'cylinder', 'cone', 'sphere', 'torus', 'pyramid'] as const;
export type ShapeKind = typeof SHAPES[number];
export type Vec3 = [number, number, number];

export interface AssetPart {
  shape: ShapeKind;
  position: Vec3; // Centre of the shape
  size: Vec3; // Width, height, depth of the shape's bounding box
  rotation: Vec3; // Degrees around x, y, z
  color: string; // #rrggbb
  metal: number; // 0-1
  rough: number; // 0-1
  opacity: number; // 0.1-1
  glow: number; // 0-3: the colour shines by itself
  glowAtNight: boolean; // Only glow after dark (lamps, windows)
  animate?: { spin: number; bob: number }; // Degrees per second around y; bob height
  repeat?: { count: number; offset: Vec3; rotate: Vec3 }; // `count` copies, each shifted by `offset`
  radial?: { count: number; radius?: number }; // `count` copies spaced evenly around the vertical axis
}

export interface AssetSpec {
  format: typeof ASSET_FORMAT;
  version: typeof ASSET_VERSION;
  name: string;
  description: string;
  tier: AssetTier;
  footprint: [number, number];
  parts: AssetPart[];
  model?: { glb: string }; // Base64 .glb, fitted to the footprint when drawn
}

// What a creator asks for when licensing an asset to another city
export interface AssetTerms {
  price: number; // Paid once by the buyer
  days: number; // Game days the licence lasts
  share: number; // Percent of each monument's tourism paid to the creator
}
export const DEFAULT_TERMS: AssetTerms = { price: 300, days: 90, share: 0 };

// --- Sizes and stats ---

export const maxHeight = (tier: AssetTier, footprint: [number, number]) =>
  ASSET_TIERS[tier].maxHeight + Math.max(footprint[0], footprint[1]) - 1;

export const area = (footprint: [number, number]) => footprint[0] * footprint[1];

// Build cost and daily effects for a monument (the per-tile tier figures times the footprint area)
export const monumentStats = (tier: AssetTier, footprint: [number, number]) => {
  const t = ASSET_TIERS[tier];
  const a = area(footprint);
  return { cost: t.cost * a, tourism: t.tourism * a, popGen: t.popGen * a, upkeep: t.upkeep * a };
};

// Quarter turns swap width and depth
export const rotateFootprint = (footprint: [number, number], rotation: number): [number, number] =>
  rotation % 2 === 1 ? [footprint[1], footprint[0]] : [footprint[0], footprint[1]];

// --- Copies ---

export type SolidPart = Omit<AssetPart, 'repeat' | 'radial'> & { source: number; copy: number };

const DEG = Math.PI / 180;

// Turn repeat/radial instructions into individual parts (stops early past `limit`)
export const expandParts = (parts: AssetPart[], limit = MAX_PARTS + 1): SolidPart[] => {
  const out: SolidPart[] = [];
  parts.forEach((part, source) => {
    const { repeat, radial, ...base } = part;
    const linear: SolidPart[] = [];
    const n = repeat?.count ?? 1;
    for (let i = 0; i < n; i++) {
      const o = repeat?.offset ?? [0, 0, 0];
      const r = repeat?.rotate ?? [0, 0, 0];
      linear.push({
        ...base, source, copy: i,
        position: [base.position[0] + o[0] * i, base.position[1] + o[1] * i, base.position[2] + o[2] * i],
        rotation: [base.rotation[0] + r[0] * i, base.rotation[1] + r[1] * i, base.rotation[2] + r[2] * i],
      });
    }
    for (const p of linear) {
      if (!radial) { out.push(p); continue; }
      const [x, y, z] = p.position;
      const dist = radial.radius ?? Math.hypot(x, z);
      const start = radial.radius !== undefined ? 0 : Math.atan2(z, x);
      for (let k = 0; k < radial.count; k++) {
        const a = start + (2 * Math.PI * k) / radial.count;
        out.push({
          ...p, copy: p.copy * radial.count + k,
          position: [dist * Math.cos(a), y, dist * Math.sin(a)],
          // Turn each copy to face outward like the first one
          rotation: [p.rotation[0], p.rotation[1] - (a - start) / DEG, p.rotation[2]],
        });
        if (out.length > limit) return;
      }
    }
    if (out.length > limit) return;
  });
  return out.slice(0, limit);
};

// --- Validation ---

export interface ValidationResult {
  asset?: AssetSpec; // Present when there are no errors
  errors: string[];
  warnings: string[];
}

const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const HEX = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i;

const normalizeHex = (c: string) => (c.length === 4 ? `#${c[1]}${c[1]}${c[2]}${c[2]}${c[3]}${c[3]}` : c).toLowerCase();

const base64Bytes = (b64: string) => Math.floor((b64.length * 3) / 4) - (b64.endsWith('==') ? 2 : b64.endsWith('=') ? 1 : 0);

const decodeBase64 = (b64: string): Uint8Array => {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
};

// A .glb must be self-contained: no links to outside files (which would be fetched from the internet)
export const checkGlb = (b64: string): string | null => {
  if (base64Bytes(b64) > MAX_GLB_BYTES) return `model.glb is larger than ${MAX_GLB_BYTES / 1024 / 1024} MB.`;
  let bytes: Uint8Array;
  try { bytes = decodeBase64(b64); } catch { return 'model.glb is not valid base64.'; }
  const view = new DataView(bytes.buffer);
  if (bytes.length < 20 || view.getUint32(0, true) !== 0x46546c67) return 'model.glb is not a .glb file (only binary glTF is supported).';
  const jsonLength = view.getUint32(12, true);
  if (view.getUint32(16, true) !== 0x4e4f534a || 20 + jsonLength > bytes.length) return 'model.glb is damaged.';
  let gltf: any;
  try { gltf = JSON.parse(new TextDecoder().decode(bytes.subarray(20, 20 + jsonLength))); } catch { return 'model.glb is damaged.'; }
  const external = [...(gltf.buffers ?? []), ...(gltf.images ?? [])].some((r: any) => typeof r?.uri === 'string' && !r.uri.startsWith('data:'));
  return external ? 'model.glb links to outside files. Export it with everything embedded (binary .glb).' : null;
};

export const glbBytes = decodeBase64;

const vec3 = (v: unknown): Vec3 | null =>
  Array.isArray(v) && v.length === 3 && v.every(isNum) ? [v[0], v[1], v[2]] : null;

export const validateAsset = (input: unknown): ValidationResult => {
  const errors: string[] = [];
  const warnings: string[] = [];
  const data = input as any;
  if (!data || typeof data !== 'object' || Array.isArray(data)) return { errors: ['The asset must be a JSON object { … }.'], warnings };

  if (data.format !== undefined && data.format !== ASSET_FORMAT) errors.push(`format: should be "${ASSET_FORMAT}".`);
  if (data.version !== undefined && data.version !== ASSET_VERSION) errors.push(`version: only version ${ASSET_VERSION} is supported.`);

  let name = typeof data.name === 'string' ? data.name.trim().slice(0, 40) : '';
  if (!name) { name = 'Untitled landmark'; warnings.push('name: missing, using "Untitled landmark".'); }
  const description = typeof data.description === 'string' ? data.description.trim().slice(0, 200) : '';

  let tier: AssetTier = 'monument';
  if (data.tier === 'grand' || data.tier === 'monument') tier = data.tier;
  else if (data.tier !== undefined) errors.push('tier: must be "monument" or "grand".');

  let footprint: [number, number] = [1, 1];
  if (data.footprint !== undefined) {
    const f = data.footprint;
    if (Array.isArray(f) && f.length === 2 && f.every((n: unknown) => Number.isInteger(n) && (n as number) >= 1 && (n as number) <= MAX_FOOTPRINT)) footprint = [f[0], f[1]];
    else errors.push(`footprint: must be [width, depth] in whole tiles, each 1-${MAX_FOOTPRINT}.`);
  }

  let model: { glb: string } | undefined;
  if (data.model !== undefined && data.model !== null) {
    if (typeof data.model?.glb !== 'string') errors.push('model: must be { "glb": "<base64>" } (import a .glb file in the Studio).');
    else {
      const problem = checkGlb(data.model.glb);
      if (problem) errors.push(problem); else model = { glb: data.model.glb };
    }
  }

  const rawParts: unknown[] = Array.isArray(data.parts) ? data.parts : [];
  if (!Array.isArray(data.parts) && data.parts !== undefined) errors.push('parts: must be a list [ … ] of shapes.');
  if (rawParts.length === 0 && !model) errors.push('parts: add at least one shape (or import a .glb model).');

  const parts: AssetPart[] = [];
  rawParts.forEach((raw: any, i) => {
    const at = `parts[${i}]`;
    if (!raw || typeof raw !== 'object') { errors.push(`${at}: must be an object { "shape": … }.`); return; }
    if (!SHAPES.includes(raw.shape)) { errors.push(`${at}.shape: must be one of ${SHAPES.join(', ')}.`); return; }

    const position = vec3(raw.position);
    if (!position) { errors.push(`${at}.position: needs 3 numbers [x, y, z].`); return; }

    let size: Vec3 | null = null;
    if (isNum(raw.size)) size = [raw.size, raw.size, raw.size];
    else if (Array.isArray(raw.size) && raw.size.length === 1 && isNum(raw.size[0])) size = [raw.size[0], raw.size[0], raw.size[0]];
    else size = vec3(raw.size);
    if (!size) { errors.push(`${at}.size: needs 3 numbers [width, height, depth] (or 1 number for all three).`); return; }
    if (size.some(s => s <= 0 || s > 10)) { errors.push(`${at}.size: each value must be above 0 and at most 10.`); return; }

    let rotation: Vec3 = [0, 0, 0];
    if (raw.rotation !== undefined) {
      const r = vec3(raw.rotation);
      if (!r) { errors.push(`${at}.rotation: needs 3 numbers in degrees [x, y, z].`); return; }
      rotation = r;
    }

    let color = '#cbd5e1';
    if (raw.color !== undefined) {
      if (typeof raw.color === 'string' && HEX.test(raw.color)) color = normalizeHex(raw.color);
      else warnings.push(`${at}.color: "${raw.color}" isn't a hex colour like "#ff8800"; using grey.`);
    }

    const part: AssetPart = {
      shape: raw.shape,
      position,
      size,
      rotation,
      color,
      metal: isNum(raw.metal) ? clamp(raw.metal, 0, 1) : 0.1,
      rough: isNum(raw.rough) ? clamp(raw.rough, 0, 1) : 0.6,
      opacity: isNum(raw.opacity) ? clamp(raw.opacity, 0.1, 1) : 1,
      glow: isNum(raw.glow) ? clamp(raw.glow, 0, 3) : 0,
      glowAtNight: raw.glowAtNight === true,
    };

    if (raw.animate !== undefined) {
      const spin = isNum(raw.animate?.spin) ? clamp(raw.animate.spin, -360, 360) : 0;
      const bob = isNum(raw.animate?.bob) ? clamp(raw.animate.bob, 0, 0.5) : 0;
      if (spin || bob) part.animate = { spin, bob };
    }
    if (raw.repeat !== undefined) {
      const count = raw.repeat?.count;
      const offset = vec3(raw.repeat?.offset);
      if (!Number.isInteger(count) || count < 2 || count > 50 || !offset) { errors.push(`${at}.repeat: needs { "count": 2-50, "offset": [x, y, z] }.`); return; }
      part.repeat = { count, offset, rotate: vec3(raw.repeat.rotate) ?? [0, 0, 0] };
    }
    if (raw.radial !== undefined) {
      const count = raw.radial?.count;
      if (!Number.isInteger(count) || count < 2 || count > 64) { errors.push(`${at}.radial: needs { "count": 2-64 } (and optionally "radius").`); return; }
      if (raw.radial.radius !== undefined && (!isNum(raw.radial.radius) || raw.radial.radius < 0)) { errors.push(`${at}.radial.radius: must be a number of tiles, 0 or more.`); return; }
      part.radial = { count, ...(isNum(raw.radial.radius) ? { radius: raw.radial.radius } : {}) };
    }
    parts.push(part);
  });

  if (errors.length) return { errors, warnings };

  // Size limits, checked on every copy
  const solid = expandParts(parts);
  if (solid.length > MAX_PARTS) return { errors: [`Too many shapes: ${MAX_PARTS} at most after repeat/radial copies. Use fewer copies or bigger shapes.`], warnings };

  const halfW = footprint[0] / 2 + 0.02;
  const halfD = footprint[1] / 2 + 0.02;
  const top = maxHeight(tier, footprint) + 0.02;
  const reported = new Set<number>();
  for (const p of solid) {
    if (reported.has(p.source)) continue;
    const [sx, sy, sz] = p.size;
    const [rx, ry, rz] = p.rotation.map(v => ((v % 360) + 360) % 360);
    const tilted = rx % 180 !== 0 || rz % 180 !== 0;
    const square = ry % 90 === 0;
    // Half extents of the rotated shape: exact for quarter turns; for other turns around y, the
    // horizontal circle that contains it; when tilted, the sphere that contains it
    const full = Math.hypot(sx, sy, sz) / 2;
    const flat = Math.hypot(sx, sz) / 2;
    const hx = tilted ? full : !square ? flat : (ry % 180 === 0 ? sx : sz) / 2;
    const hz = tilted ? full : !square ? flat : (ry % 180 === 0 ? sz : sx) / 2;
    const hy = tilted ? full : sy / 2;
    const [x, y, z] = p.position;
    const where = `parts[${p.source}]${p.copy ? ` (copy ${p.copy + 1})` : ''}`;
    const fail = (msg: string) => { errors.push(`${where}: ${msg}`); reported.add(p.source); };
    const side = (v: number, pos: string, neg: string) => (v > 0 ? `${pos} edge` : v < 0 ? `${neg} edge` : `${pos}/${neg} edges`);
    if (Math.abs(x) + hx > halfW) fail(`sticks out past the ${side(x, 'east', 'west')} (reaches ${(Math.abs(x) + hx).toFixed(2)} from the centre, limit ${footprint[0] / 2}).`);
    else if (Math.abs(z) + hz > halfD) fail(`sticks out past the ${side(z, 'south', 'north')} (reaches ${(Math.abs(z) + hz).toFixed(2)} from the centre, limit ${footprint[1] / 2}).`);
    else if (y - hy < -0.05) fail(`goes below the ground (bottom at y = ${(y - hy).toFixed(2)}).`);
    else if (y + hy > top) fail(`is too tall (top at y = ${(y + hy).toFixed(2)}, limit ${top - 0.02} for a ${footprint[0]}×${footprint[1]} ${tier}).`);
  }
  if (errors.length) return { errors, warnings };

  return {
    asset: { format: ASSET_FORMAT, version: ASSET_VERSION, name, description, tier, footprint, parts, ...(model ? { model } : {}) },
    errors,
    warnings,
  };
};

// --- Identity ---

const canonical = (v: unknown): string => {
  if (Array.isArray(v)) return `[${v.map(canonical).join(',')}]`;
  if (v && typeof v === 'object') return `{${Object.keys(v).sort().map(k => `${JSON.stringify(k)}:${canonical((v as any)[k])}`).join(',')}}`;
  return JSON.stringify(v);
};

// Same content -> same id on every computer (so an asset is stored and sent only once)
export const assetId = async (asset: AssetSpec): Promise<string> => {
  const bytes = new TextEncoder().encode(canonical(asset));
  const hash = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(hash).slice(0, 8)).map(b => b.toString(16).padStart(2, '0')).join('');
};

// --- Helpers for the Studio ---

// Pull the JSON out of an AI reply (handles ```json fences and text around it)
export const extractJson = (text: string): string => {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const body = fenced ? fenced[1] : text;
  const start = body.indexOf('{');
  const end = body.lastIndexOf('}');
  return start >= 0 && end > start ? body.slice(start, end + 1) : body.trim();
};

export const cleanTerms = (t: Partial<AssetTerms> | undefined): AssetTerms => ({
  price: isNum(t?.price) ? Math.max(0, Math.round(t!.price!)) : DEFAULT_TERMS.price,
  days: LICENCE_DAY_OPTIONS.includes(t?.days as number) ? t!.days! : DEFAULT_TERMS.days,
  share: isNum(t?.share) ? clamp(Math.round(t!.share!), 0, MAX_PROFIT_SHARE) : DEFAULT_TERMS.share,
});

export const STARTER_ASSET = {
  format: ASSET_FORMAT,
  version: ASSET_VERSION,
  name: 'Sky Obelisk',
  description: 'A tall stone obelisk with a glowing tip and four lanterns.',
  tier: 'monument',
  footprint: [1, 1],
  parts: [
    { shape: 'box', position: [0, 0.05, 0], size: [0.9, 0.1, 0.9], color: '#94a3b8' },
    { shape: 'box', position: [0, 0.2, 0], size: [0.6, 0.2, 0.6], color: '#cbd5e1' },
    { shape: 'box', position: [0, 1.1, 0], size: [0.3, 1.6, 0.3], color: '#e2e8f0', rough: 0.4 },
    { shape: 'pyramid', position: [0, 2.05, 0], size: [0.3, 0.3, 0.3], color: '#fde047', glow: 2, metal: 0.8 },
    { shape: 'sphere', position: [0.38, 0.25, 0], size: [0.08, 0.08, 0.08], color: '#fef3c7', glow: 3, glowAtNight: true, radial: { count: 4 } },
  ],
};
