import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  destinationId,
  destinations,
  filterDestinations,
  findDestination,
} from './destinations.ts';

describe('destinations', () => {
  it('loads curated waters from Fly Finder', () => {
    assert.ok(destinations.length >= 40);
    assert.ok(destinations.some((d) => d.name.includes('Au Sable')));
  });

  it('round-trips ids', () => {
    const d = destinations[0];
    const id = destinationId(d);
    assert.deepEqual(findDestination(id)?.name, d.name);
  });

  it('filters by state and species', () => {
    const miTrout = filterDestinations({ state: 'Michigan', species: 'trout' });
    assert.ok(miTrout.length > 0);
    miTrout.forEach((d) => {
      assert.equal(d.state, 'Michigan');
      assert.ok(d.species.includes('trout'));
    });
  });
});
