/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
*/
// Deterministic 0..1 value per tile; picks each building's look (and a house's capacity)
export const tileHash = (x: number, y: number) => Math.abs(Math.sin(x * 12.9898 + y * 78.233) * 43758.5453) % 1;

export type HouseStyleName = 'Cozy Cottage' | 'Modern Boxy' | 'Townhouse';

export interface HouseStyle {
  name: HouseStyleName;
  maxVariant: number; // Used when the tile's variant (hash * 100) is below this
  housing: number; // Citizens this house can hold
}

export const HOUSE_STYLES: HouseStyle[] = [
  { name: 'Cozy Cottage', maxVariant: 33, housing: 5 },
  { name: 'Modern Boxy', maxVariant: 66, housing: 8 },
  { name: 'Townhouse', maxVariant: 100, housing: 10 },
];

export const getHouseStyle = (x: number, y: number): HouseStyle => {
  const variant = Math.floor(tileHash(x, y) * 100);
  return HOUSE_STYLES.find(s => variant < s.maxVariant) || HOUSE_STYLES[HOUSE_STYLES.length - 1];
};
