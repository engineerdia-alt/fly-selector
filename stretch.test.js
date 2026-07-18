const assert = require('node:assert/strict');
const { describe, it } = require('node:test');
const {
  filterReachesForSpecies,
  parseStretchesProse,
  pickDefaultReach,
  reachesForNotes
} = require('./stretch.js');

describe('parseStretchesProse', () => {
  it('splits semicolon stretches', () => {
    const parts = parseStretchesProse('Upper Yates for trout; Middle park for bass; Lower spillway.');
    assert.equal(parts.length, 3);
    assert.match(parts[0].label, /Yates/i);
  });
});

describe('filterReachesForSpecies', () => {
  const clinton = [
    { id: 'yates', label: 'Upper / Yates', species: ['trout'], hint: 'stocked trout' },
    {
      id: 'middle',
      label: 'Middle / Clinton River Park',
      species: ['bass', 'pike', 'panfish', 'carp'],
      hint: 'smallmouth & pike'
    },
    {
      id: 'lower',
      label: 'Lower river & spillway',
      species: ['bass', 'pike', 'steelhead', 'panfish'],
      hint: 'warmwater & run fish'
    }
  ];

  it('hides trout-only Yates when targeting bass', () => {
    const bass = filterReachesForSpecies(clinton, 'bass');
    assert.equal(bass.length, 2);
    assert.ok(bass.every((r) => r.id !== 'yates'));
  });

  it('defaults to the first bass-capable stretch', () => {
    const d = pickDefaultReach(clinton, 'bass');
    assert.equal(d.id, 'middle');
  });

  it('keeps Yates for trout', () => {
    const trout = filterReachesForSpecies(clinton, 'trout');
    assert.equal(trout.length, 1);
    assert.equal(trout[0].id, 'yates');
  });
});

describe('reachesForNotes', () => {
  it('prefers structured reaches over prose', () => {
    const notes = {
      stretches: 'Ignore this prose',
      reaches: [{ id: 'a', label: 'A section', species: ['trout'] }]
    };
    assert.equal(reachesForNotes(notes)[0].id, 'a');
  });

  it('Clinton River bass default skips Yates trout water', () => {
    const notes = {
      reaches: [
        { id: 'yates', label: 'Upper / Yates', species: ['trout'] },
        { id: 'middle', label: 'Middle / Clinton River Park', species: ['bass', 'pike'] },
        { id: 'lower', label: 'Lower river & spillway', species: ['bass', 'pike', 'steelhead'] }
      ]
    };
    const picked = pickDefaultReach(reachesForNotes(notes), 'bass');
    assert.equal(picked.id, 'middle');
  });

  it('Huron River bass defaults to Hudson Mills float, not Proud Lake trout', () => {
    const notes = {
      reaches: [
        { id: 'proud', label: 'Upper / Proud Lake–Milford', species: ['trout'] },
        { id: 'hudson', label: 'Hudson Mills to Delhi', species: ['bass', 'pike', 'panfish', 'carp'] },
        { id: 'flatrock', label: 'Flat Rock to South Rockwood', species: ['bass', 'pike', 'panfish', 'carp'] }
      ]
    };
    const picked = pickDefaultReach(reachesForNotes(notes), 'bass');
    assert.equal(picked.id, 'hudson');
    const bass = filterReachesForSpecies(reachesForNotes(notes), 'bass');
    assert.ok(bass.every((r) => r.id !== 'proud'));
  });
});
