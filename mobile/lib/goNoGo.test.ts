import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { evaluateGoNoGo } from './goNoGo.ts';

describe('evaluateGoNoGo', () => {
  it('flags warm trout water as no-go', () => {
    const r = evaluateGoNoGo({ species: 'trout', waterTempF: 70, flowTrend: 'steady' });
    assert.equal(r.verdict, 'no-go');
    assert.match(r.reasons.join(' '), /warm/i);
  });

  it('treats hard rising flow as no-go', () => {
    const r = evaluateGoNoGo({
      species: 'trout',
      waterTempF: 55,
      flowTrend: 'rising',
      trendPct: 55,
    });
    assert.equal(r.verdict, 'no-go');
  });

  it('returns go when signals are calm', () => {
    const r = evaluateGoNoGo({
      species: 'trout',
      waterTempF: 52,
      flowTrend: 'steady',
      precipIn24h: 0.1,
      windMph: 6,
    });
    assert.equal(r.verdict, 'go');
    assert.equal(r.label, 'Worth the drive');
  });

  it('cautions on windy days', () => {
    const r = evaluateGoNoGo({
      species: 'bass',
      waterTempF: 68,
      windMph: 22,
      flowTrend: 'steady',
    });
    assert.equal(r.verdict, 'caution');
  });
});
