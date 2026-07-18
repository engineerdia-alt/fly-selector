export type GoNoGoInput = {
  species?: string | null;
  waterTempF?: number | null;
  flowTrend?: 'rising' | 'falling' | 'steady' | null;
  trendPct?: number | null;
  precipIn24h?: number | null;
  windMph?: number | null;
};

export type GoNoGoResult = {
  verdict: 'go' | 'caution' | 'no-go';
  label: string;
  reasons: string[];
};

/**
 * Lightweight outing verdict from live signals.
 * Intentionally conservative for trout thermal stress and blow-outs —
 * this is the differentiator vs map-only apps.
 */
export function evaluateGoNoGo(input: GoNoGoInput): GoNoGoResult {
  const reasons: string[] = [];
  let score = 2; // 0 no-go, 1 caution, 2 go
  const species = (input.species || '').toLowerCase();
  const isTroutish = !species || species === 'trout' || species === 'steelhead';

  if (isTroutish && input.waterTempF != null && input.waterTempF >= 68) {
    score = Math.min(score, 0);
    reasons.push(`Water ~${input.waterTempF}°F — too warm for ethical trout fishing.`);
  } else if (isTroutish && input.waterTempF != null && input.waterTempF >= 64) {
    score = Math.min(score, 1);
    reasons.push(`Water ~${input.waterTempF}°F — fish dawn only and carry a thermometer.`);
  }

  if (input.flowTrend === 'rising' && (input.trendPct ?? 0) > 40) {
    score = Math.min(score, 0);
    reasons.push(`Flow rising hard (${input.trendPct}%) — likely dirty and unsafe to wade.`);
  } else if (input.flowTrend === 'rising' && (input.trendPct ?? 0) > 15) {
    score = Math.min(score, 1);
    reasons.push(`Flow rising (${input.trendPct}%) — expect stained water; bigger/darker flies.`);
  } else if (input.flowTrend === 'falling') {
    reasons.push('Flow falling/clearing — fish get picky; downsize tippet and flies.');
  } else if (input.flowTrend === 'steady') {
    reasons.push('Flow steady — a good baseline window if temp cooperates.');
  }

  if (input.precipIn24h != null && input.precipIn24h >= 0.75) {
    score = Math.min(score, 1);
    reasons.push(`${input.precipIn24h}" rain in 24h — check the gauge before you drive.`);
  }

  if (input.windMph != null && input.windMph >= 20) {
    score = Math.min(score, 1);
    reasons.push(`Wind ~${Math.round(input.windMph)} mph — tough casting; favor bank cover.`);
  }

  if (!reasons.length) {
    reasons.push('No major red flags in the live signals we have — still verify access and regs.');
  }

  if (score <= 0) {
    return { verdict: 'no-go', label: 'Sit it out', reasons };
  }
  if (score === 1) {
    return { verdict: 'caution', label: 'Go with a plan B', reasons };
  }
  return { verdict: 'go', label: 'Worth the drive', reasons };
}
