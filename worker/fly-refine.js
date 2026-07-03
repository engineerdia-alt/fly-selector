// Fly Finder refinement worker.
// Holds the Anthropic API key server-side and answers one question per
// location pick: which candidate species realistically live in this exact
// stretch of water, plus a short section-specific read.
// Valid responses are cached for 7 days per water; errors are never cached.
// GET /diag runs a tiny end-to-end test of the Anthropic call.

const ALLOWED_ORIGINS = [
  'https://engineerdia-alt.github.io',
  'http://localhost:8791'
];

const MODEL = 'claude-haiku-4-5-20251001';

async function callAnthropic(env, prompt, maxTokens) {
  const resp = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': env.ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json'
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: maxTokens,
      messages: [{ role: 'user', content: prompt }]
    })
  });
  const body = await resp.json().catch(() => ({}));
  return { status: resp.status, ok: resp.ok, body };
}

export default {
  async fetch(request, env) {
    const origin = request.headers.get('Origin') || '';
    const cors = {
      'Access-Control-Allow-Origin': ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0],
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type'
    };
    if (request.method === 'OPTIONS') return new Response(null, { headers: cors });

    const url = new URL(request.url);
    if (request.method === 'GET' && url.pathname === '/diag') {
      if (!env.ANTHROPIC_API_KEY) {
        return new Response('DIAG FAIL: ANTHROPIC_API_KEY secret is not set', { status: 500, headers: cors });
      }
      const r = await callAnthropic(env, 'Reply with exactly: ok', 10);
      const detail = r.ok
        ? 'DIAG OK — model ' + MODEL + ' replied: ' + JSON.stringify((r.body.content || [{}])[0].text || '')
        : 'DIAG FAIL — Anthropic returned HTTP ' + r.status + ': ' + JSON.stringify(r.body.error || r.body).slice(0, 300);
      return new Response(detail, { status: r.ok ? 200 : 502, headers: cors });
    }

    if (request.method !== 'POST') return new Response('POST only', { status: 405, headers: cors });

    let body;
    try { body = await request.json(); } catch (e) {
      return new Response('bad json', { status: 400, headers: cors });
    }

    if (url.pathname === '/ask') {
      const question = (body.question || '').slice(0, 500);
      if (!question) return new Response('missing question', { status: 400, headers: cors });
      const ctx = JSON.stringify(body.context || {}).slice(0, 1500);
      const askPrompt =
        'You are a seasoned, safety-conscious fly fishing guide. Current conditions for the angler: ' + ctx + '. ' +
        'The angler asks: "' + question.replace(/"/g, "'") + '". ' +
        'Answer in under 120 words, practical and honest, grounded in the conditions given. ' +
        'If heat or water temperature makes fishing harmful to the fish (e.g. trout in water over 68F) or risky ' +
        'for the angler, say so plainly and suggest concrete alternatives (other species, dawn/dusk, another day).';
      const ar = await callAnthropic(env, askPrompt, 350);
      if (!ar.ok) {
        return new Response(JSON.stringify({ error: 'anthropic ' + ar.status }), {
          status: 502, headers: { ...cors, 'Content-Type': 'application/json' }
        });
      }
      const answer = (ar.body.content && ar.body.content[0] && ar.body.content[0].text) || '';
      return new Response(JSON.stringify({ answer: answer }), {
        headers: { ...cors, 'Content-Type': 'application/json' }
      });
    }
    const { name, state, lat, lon, water, candidates } = body || {};
    if (!name || typeof lat !== 'number' || typeof lon !== 'number') {
      return new Response('missing fields', { status: 400, headers: cors });
    }

    const cache = caches.default;
    const cacheKey = new Request('https://cache.fly-finder.internal/v2/' + encodeURIComponent(
      [name, state || '', Math.round(lat * 20) / 20, Math.round(lon * 20) / 20, water || ''].join('|')
    ));
    const hit = await cache.match(cacheKey);
    if (hit) {
      const cached = new Response(hit.body, hit);
      Object.entries(cors).forEach(([k, v]) => cached.headers.set(k, v));
      return cached;
    }

    const prompt =
      'You are a fly fishing expert with detailed knowledge of North American fisheries. ' +
      'The angler picked this exact spot: "' + name + '" at ' + lat.toFixed(4) + ',' + lon.toFixed(4) +
      (state ? ' in ' + state : '') + (water ? ' (' + water + ' water)' : '') + '. ' +
      'Candidate species keys: ' + (candidates || []).join(', ') + '. ' +
      'Think about this SPECIFIC section (dams, temperature regime, gradient), not the river in general. ' +
      'Reply with STRICT JSON only, no prose before or after: ' +
      '{"species": [subset of the candidate keys that realistically occur and are worth targeting in this exact section], ' +
      '"read": "2-3 sentences of section-specific local knowledge: what actually swims here, the character of this stretch, honest expectations", ' +
      '"regs": "one sentence on special regulations likely to apply here, or an empty string if none come to mind"}';

    const r = await callAnthropic(env, prompt, 400);
    if (!r.ok) {
      return new Response(JSON.stringify({ error: 'anthropic ' + r.status, detail: r.body.error }), {
        status: 502, headers: { ...cors, 'Content-Type': 'application/json' }
      });
    }

    let text = (r.body.content && r.body.content[0] && r.body.content[0].text) || '';
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    let parsed = null;
    if (jsonMatch) {
      try { parsed = JSON.parse(jsonMatch[0]); } catch (e) { parsed = null; }
    }
    // never cache an unusable answer — a bad response would stick for a week
    if (!parsed || !Array.isArray(parsed.species)) {
      return new Response(JSON.stringify({ error: 'unparseable model output' }), {
        status: 502, headers: { ...cors, 'Content-Type': 'application/json' }
      });
    }

    const out = new Response(JSON.stringify(parsed), {
      headers: { ...cors, 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=604800' }
    });
    await cache.put(cacheKey, out.clone());
    return out;
  }
};
