// Fly Finder refinement worker.
// Holds the Anthropic API key server-side. Routes:
//   POST /      — which candidate species live in this exact stretch + a short read
//   POST /ask   — conversational guide Q&A with follow-ups (message history)
//   GET  /diag  — end-to-end test of the Anthropic call
// Static instructions live in cached system blocks (prompt caching kicks in
// automatically once the prefix passes the model's minimum cacheable size).
// Valid refine responses are edge-cached 7 days; errors are never cached.

const ALLOWED_ORIGINS = [
  'https://engineerdia-alt.github.io',
  'http://localhost:8791'
];

const MODEL = 'claude-haiku-4-5-20251001';

const REFINE_SYSTEM =
  'You are a fly fishing expert with detailed knowledge of North American fisheries. ' +
  'The user gives you an exact spot (name, coordinates, state, water type) and a list of candidate species keys. ' +
  'Think about that SPECIFIC section — dams, temperature regime, gradient — not the river in general. ' +
  'Reply with STRICT JSON only, no prose before or after: ' +
  '{"species": [subset of the candidate keys that realistically occur and are worth targeting in this exact section], ' +
  '"read": "2-3 sentences of section-specific local knowledge: what actually swims here, the character of this stretch, honest expectations", ' +
  '"regs": "one sentence on special regulations likely to apply here, or an empty string if none come to mind"}';

const GUIDE_SYSTEM =
  'You are a seasoned, safety-conscious fly fishing guide chatting with an angler about a specific outing. ' +
  'Ground every answer in the conditions context you are given. Be practical and honest. ' +
  'If heat or water temperature makes fishing harmful to the fish (e.g. trout in water over 68F) or risky for the angler, ' +
  'say so plainly and suggest concrete alternatives (other species, dawn/dusk, another day). ' +
  'Keep answers under 150 words. Format for a small card: short paragraphs, "-" bullets when listing options or steps, ' +
  'and **bold** for the key numbers or the bottom-line verdict.';

async function callAnthropic(env, opts) {
  const payload = {
    model: MODEL,
    max_tokens: opts.maxTokens,
    messages: opts.messages
  };
  if (opts.system) {
    payload.system = [{ type: 'text', text: opts.system, cache_control: { type: 'ephemeral' } }];
  }
  const resp = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': env.ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json'
    },
    body: JSON.stringify(payload)
  });
  const body = await resp.json().catch(() => ({}));
  return { status: resp.status, ok: resp.ok, body };
}

function textOf(r) {
  return (r.body.content && r.body.content[0] && r.body.content[0].text) || '';
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
      const r = await callAnthropic(env, { messages: [{ role: 'user', content: 'Reply with exactly: ok' }], maxTokens: 10 });
      const detail = r.ok
        ? 'DIAG OK — model ' + MODEL + ' replied: ' + JSON.stringify(textOf(r))
        : 'DIAG FAIL — Anthropic returned HTTP ' + r.status + ': ' + JSON.stringify(r.body.error || r.body).slice(0, 300);
      return new Response(detail, { status: r.ok ? 200 : 502, headers: cors });
    }

    if (request.method !== 'POST') return new Response('POST only', { status: 405, headers: cors });

    let body;
    try { body = await request.json(); } catch (e) {
      return new Response('bad json', { status: 400, headers: cors });
    }

    if (url.pathname === '/ask') {
      let msgs = Array.isArray(body.messages)
        ? body.messages
        : (body.question ? [{ role: 'user', content: body.question }] : []);
      msgs = msgs.slice(-8).map(function (m) {
        return {
          role: m.role === 'assistant' ? 'assistant' : 'user',
          content: String(m.content || '').slice(0, 600)
        };
      }).filter(function (m) { return m.content; });
      if (!msgs.length || msgs[msgs.length - 1].role !== 'user') {
        return new Response('missing question', { status: 400, headers: cors });
      }
      const ctx = JSON.stringify(body.context || {}).slice(0, 1500);
      // context rides in the first user turn so the system block stays
      // identical across spots and stays cache-friendly
      msgs[0] = { role: msgs[0].role, content: 'Conditions context: ' + ctx + '\n\n' + msgs[0].content };
      const ar = await callAnthropic(env, { system: GUIDE_SYSTEM, messages: msgs, maxTokens: 400 });
      if (!ar.ok) {
        return new Response(JSON.stringify({ error: 'anthropic ' + ar.status }), {
          status: 502, headers: { ...cors, 'Content-Type': 'application/json' }
        });
      }
      return new Response(JSON.stringify({ answer: textOf(ar) }), {
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

    const userMsg =
      'Spot: "' + name + '" at ' + lat.toFixed(4) + ',' + lon.toFixed(4) +
      (state ? ' in ' + state : '') + (water ? ' (' + water + ' water)' : '') + '. ' +
      'Candidate species keys: ' + (candidates || []).join(', ') + '.';

    const r = await callAnthropic(env, { system: REFINE_SYSTEM, messages: [{ role: 'user', content: userMsg }], maxTokens: 400 });
    if (!r.ok) {
      return new Response(JSON.stringify({ error: 'anthropic ' + r.status, detail: r.body.error }), {
        status: 502, headers: { ...cors, 'Content-Type': 'application/json' }
      });
    }

    const text = textOf(r);
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
