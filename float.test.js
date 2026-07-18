const assert = require('node:assert/strict');
const { describe, it } = require('node:test');
const {
  accessPointsKml,
  buildFloatLegs,
  estimateFloatHours,
  formatFloatDuration,
  googleMapsDirUrl,
  googleMapsKayakSearchUrl,
  isLaunchKind,
  sortLaunchesDownstream
} = require('./float.js');

describe('isLaunchKind', () => {
  it('recognizes slipway and kayak labels', () => {
    assert.equal(isLaunchKind('Boat / canoe launch'), true);
    assert.equal(isLaunchKind('Kayak put-in'), true);
    assert.equal(isLaunchKind('Park / river access'), false);
  });
});

describe('float estimates', () => {
  it('estimates hours at ~3 mph', () => {
    assert.equal(estimateFloatHours(6), 2);
    assert.match(formatFloatDuration(1.5), /1 hr/);
  });
});

describe('buildFloatLegs', () => {
  const spots = [
    { name: 'Flat Rock Boat Launch', kind: 'Boat / canoe launch', lat: 42.096, lon: -83.292, dist: 0.2 },
    { name: 'South Rockwood Boat Launch', kind: 'Boat / canoe launch', lat: 42.063, lon: -83.261, dist: 2.8 },
    { name: 'Random park', kind: 'Park / river access', lat: 42.08, lon: -83.27, dist: 1.0 }
  ];

  it('builds a paddle leg between launches only', () => {
    const legs = buildFloatLegs(spots);
    assert.equal(legs.length, 1);
    assert.equal(legs[0].from.name, 'Flat Rock Boat Launch');
    assert.equal(legs[0].to.name, 'South Rockwood Boat Launch');
    assert.ok(legs[0].miles > 1);
    assert.ok(legs[0].mapsDirUrl.includes('google.com/maps/dir'));
  });

  it('sorts north launch before south take-out', () => {
    const sorted = sortLaunchesDownstream(spots);
    assert.equal(sorted[0].name, 'Flat Rock Boat Launch');
  });
});

describe('maps + kml', () => {
  it('builds a driving shuttle URL', () => {
    const u = googleMapsDirUrl(42.1, -83.3, 42.06, -83.26);
    assert.match(u, /origin=42\.1/);
    assert.match(u, /destination=42\.06/);
  });

  it('builds a kayak search URL', () => {
    assert.match(googleMapsKayakSearchUrl('Huron River', 'Michigan'), /Huron/);
  });

  it('emits KML placemarks', () => {
    const kml = accessPointsKml([
      { name: 'Flat Rock Boat Launch', kind: 'Boat / canoe launch', lat: 42.096, lon: -83.292 }
    ]);
    assert.match(kml, /<kml/);
    assert.match(kml, /Flat Rock/);
    assert.match(kml, /-83\.292,42\.096/);
  });
});
