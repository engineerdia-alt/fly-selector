import { createRequire } from 'node:module';

import type { Destination } from './destinationTypes';

export type { Destination };

const require = createRequire(import.meta.url);
export const destinations: Destination[] = require('../data/destinations.json');

export function destinationId(d: Destination): string {
  return encodeURIComponent(`${d.name}|${d.state}`);
}

export function findDestination(id: string): Destination | undefined {
  const decoded = decodeURIComponent(id);
  return destinations.find((d) => `${d.name}|${d.state}` === decoded);
}

export function destinationsNear(
  lat: number,
  lon: number,
  limit = 8
): (Destination & { miles: number })[] {
  return destinations
    .map((d) => ({
      ...d,
      miles: haversineMiles(lat, lon, d.lat, d.lon),
    }))
    .sort((a, b) => a.miles - b.miles)
    .slice(0, limit);
}

export function filterDestinations(opts: {
  query?: string;
  state?: string;
  species?: string;
}): Destination[] {
  const q = (opts.query || '').trim().toLowerCase();
  return destinations.filter((d) => {
    if (opts.state && d.state !== opts.state) return false;
    if (opts.species && !d.species.includes(opts.species)) return false;
    if (!q) return true;
    return (
      d.name.toLowerCase().includes(q) ||
      d.state.toLowerCase().includes(q) ||
      d.hook.toLowerCase().includes(q)
    );
  });
}

function haversineMiles(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 3958.8;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return Math.round(R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)));
}
