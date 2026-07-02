// Fly Finder refinement worker.
// Holds the Anthropic API key server-side and answers one question per
// location pick: which candidate species realistically live in this exact
// stretch of water, plus a short section-specific read.
// Responses are cached for 7 days per water so repeat lookups cost nothing.

const ALLOWED_ORIGINS = [
  'https://engineerdia-alt.github.io',
  'http://localhost:8791'
];

export default {
  async fetch(request, env) {
    const origin = request.headers.get('Origin') || '';
    const cors = {
      'Access-Control-Allow-Origin': ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0],
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type'
    };
    if (request.method === 'OPTIONS') return new Response(null, { headers: cors });
    if (request.method !== 'POST') return new Response('POST only', { status: 405, headers: cors });

    let body;
    try { body = await request.json(); } catch (e) {
      return new Response('bad json', { status: 400, headers: cors });
    }
    const { name, state, lat, lon, water, candidates } = body || {};
    if (!name || typeof lat !== 'number' || typeof lon !== 'number') {
      return new Response('missing fields', { status: 400, headers: cors });
    }

    const cache = caches.default;
    const cacheKey = new Request('https://cache.fly-finder.internal/' + encodeURIComponent(
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

    const resp = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json'
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 400,
        messages: [{ role: 'user', content: prompt }]
      })
    });
    if (!resp.ok) return new Response('upstream error', { status: 502, headers: cors });

    const data = await resp.json();
    let text = (data.content && data.content[0] && data.content[0].text) || '{}';
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    text = jsonMatch ? jsonMatch[0] : '{}';
    try { JSON.parse(text); } catch (e) { text = '{}'; }

    const out = new Response(text, {
      headers: { ...cors, 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=604800' }
    });
    await cache.put(cacheKey, out.clone());
    return out;
  }
};
