// Pure stretch-picker helpers for Fly Finder (browser + Node tests).
// Reaches may be structured on a water note, or parsed from prose.

function parseStretchesProse(text) {
  if (!text || typeof text !== 'string') return [];
  return text
    .split(/;\s*/)
    .map(function (part) {
      return part.trim();
    })
    .filter(Boolean)
    .map(function (label, i) {
      return {
        id: 'prose-' + i,
        label: label.length > 72 ? label.slice(0, 69) + '…' : label,
        hint: '',
        species: null, // null = any species
        blurb: label
      };
    });
}

function reachesForNotes(notes) {
  if (!notes) return [];
  if (Array.isArray(notes.reaches) && notes.reaches.length) {
    return notes.reaches.map(function (r, i) {
      return {
        id: r.id || 'r-' + i,
        label: r.label,
        hint: r.hint || '',
        species: Array.isArray(r.species) ? r.species : null,
        blurb: r.blurb || r.hint || r.label
      };
    });
  }
  return parseStretchesProse(notes.stretches);
}

function filterReachesForSpecies(reaches, species) {
  if (!reaches || !reaches.length) return [];
  if (!species) return reaches.slice();
  var matched = reaches.filter(function (r) {
    return !r.species || r.species.indexOf(species) !== -1;
  });
  // If every reach is species-tagged and none match, fall back to all
  // so the angler can still pick — but prefer matched when any exist.
  return matched.length ? matched : reaches.slice();
}

function pickDefaultReach(reaches, species) {
  var list = filterReachesForSpecies(reaches, species);
  return list[0] || null;
}

var api = {
  parseStretchesProse: parseStretchesProse,
  reachesForNotes: reachesForNotes,
  filterReachesForSpecies: filterReachesForSpecies,
  pickDefaultReach: pickDefaultReach
};

if (typeof module !== 'undefined' && module.exports) {
  module.exports = api;
}
if (typeof window !== 'undefined') {
  window.FFStretch = api;
}
