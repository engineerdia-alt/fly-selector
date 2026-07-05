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
  'If an "onWater" field is present, the spot (often a park or access point) sits ON that named water — identify the ' +
  'fishery by that water, not by guessing a different river from the coordinates. ' +
  'Think about that SPECIFIC section — dams, temperature regime, gradient — not the river in general. ' +
  'Reply with STRICT JSON only, no prose before or after: ' +
  '{"species": [subset of the candidate keys that realistically occur and are worth targeting in this exact section], ' +
  '"read": "2-3 sentences of section-specific local knowledge: what actually swims here, the character of this stretch, honest expectations", ' +
  '"regs": "one sentence on special regulations likely to apply here, or an empty string if none come to mind"}';

const PLAN_SYSTEM =
  'You are the friendly front desk of a fly fishing planning app. An angler types a free-form request ' +
  '(e.g. "where can I catch smallmouth near Ann Arbor this weekend?"). Your job is to figure out WHERE they want ' +
  'to fish and, if mentioned, what species, how they are fishing, and the water type — then hand off to the app, ' +
  'which will pull weather, nearby access points, a map, and fly recommendations for that spot. ' +
  'Valid species keys: trout, bass, pike, panfish, carp, steelhead, striper, bluefish, albie, redfish. ' +
  'Valid water: river, lake, pond, ocean. Valid method: shore, wading, boat, kayak. ' +
  'Reply with STRICT JSON only, no prose outside it: ' +
  '{"reply": "one or two friendly sentences to the angler", ' +
  '"ready": true only once you have a usable place (a named water OR a town/city), else false, ' +
  '"place": "the most specific water or town named, exactly as an app map search would want it, or null", ' +
  '"species": one valid species key if clearly implied else null, ' +
  '"method": one valid method if stated else null, ' +
  '"water": one valid water type if clear from the place or words else null}. ' +
  'If they gave no location, set ready=false and ask a short friendly question for the place. ' +
  'Never invent a place they did not mention.';

const GUIDE_SYSTEM =
  'You are a sharp, local fly fishing guide who knows North American waters intimately. An angler is asking about a ' +
  'specific outing, and you are given a JSON conditions context (spot, coordinates, recent rainfall over the last days, ' +
  'water temp, flow and its trend, wind, sky, moon, tide, the actual named access points nearby, and any local knowledge). ' +
  'If an "onWater" field is present, the spot sits ON that named water — treat the outing as fishing that water, not a ' +
  'different river guessed from coordinates. ' +
  'Reason like a local who just checked the gauge and the sky — connect the dots between the facts. ' +
  'Especially: recent rain raises and dirties flow (fish go deep, eat big/dark/high-visibility flies, hold in slack water ' +
  'behind structure; but a blown-out creek is unsafe and unfishable); a dropping, clearing gauge means spooky fish and ' +
  'lighter/smaller presentations; water over 68F is dangerous for trout. ' +
  'Structure your answer to fit what they asked, but a strong full answer flows: ' +
  '(1) a direct verdict first — is it worth going, yes/no and why, referencing the actual numbers; ' +
  '(2) how to fish it today given the conditions (flies, depth, where in the water column); ' +
  '(3) WHERE — name specific access points FROM the provided nearbyAccessPoints list and what each stretch offers; ' +
  '(4) what NOT to do — safety (high/muddy water) and likely regulations (trout streams often restrict bait/gear — tell them to verify with the state agency); ' +
  '(5) a backup plan if the water is blown out. ' +
  'The nearbyAccessPoints in the context are shown as pins on a map directly above this chat, so refer to them by name ' +
  '("on the map above, try...") when the angler asks where to fish. ' +
  'Only use access-point names that appear in the context; never invent specific place names, ratings, or gauge numbers. ' +
  'If waterTempApproxFromGauge is set, the water temperature is from a gauge some miles away, NOT the exact spot — call it ' +
  'approximate, suggest they carry a thermometer, and do not issue an absolute do-not-fish warning on that reading alone. ' +
  'Whenever your answer describes HOW to fish — techniques, flies, presentation, depth, reading water, knots — you MUST ' +
  'append at least one learning link so they can watch it done. Use ONLY these safe URL patterns: a YouTube SEARCH link ' +
  '[▶ Watch: TOPIC](https://www.youtube.com/results?search_query=URL+ENCODED+QUERY) and, when relevant, the shop blog ' +
  'using the shopBlogSearch base from context + a URL-encoded query [Read on our blog](shopBlogSearch+query). ' +
  'Never link a specific youtube.com/watch?v= id or a made-up article URL — only search links, which always resolve. ' +
  'If a fact is not in the context, reason from general knowledge and say it is general. Be honest, practical, concise. ' +
  'Format for a phone card: short paragraphs, "-" bullets for tactics/spots/steps, **bold** for the verdict and key numbers. ' +
  'Aim for 120-220 words unless they asked something small.';

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

    // real product photo of a recommended fly, from the shop's predictive
    // search — fetched server-side to dodge cross-origin, cached a day
    if (request.method === 'GET' && url.pathname === '/fly-image') {
      const q = url.searchParams.get('q');
      if (!q) return new Response(JSON.stringify({}), { headers: { ...cors, 'Content-Type': 'application/json' } });
      const cache = caches.default;
      const ck = new Request('https://cache.fly-finder.internal/img/' + encodeURIComponent(q));
      const hit = await cache.match(ck);
      if (hit) {
        const c = new Response(hit.body, hit);
        Object.entries(cors).forEach(([k, v]) => c.headers.set(k, v));
        return c;
      }
      let out = {};
      try {
        const shopResp = await fetch('https://flyfishinguniverse.com/search/suggest.json?q=' + encodeURIComponent(q) +
          '&resources[type]=product&resources[limit]=5', { headers: { 'Accept': 'application/json' } });
        const data = await shopResp.json();
        const prods = (((data.resources || {}).results || {}).products) || [];
        const p = prods.find(x => x.available) || prods[0];
        if (p) {
          const img = (p.featured_image && p.featured_image.url) || p.image || '';
          out = {
            title: p.title,
            url: 'https://flyfishinguniverse.com' + String(p.url || '').split('?')[0],
            image: img ? img + (img.indexOf('?') >= 0 ? '&' : '?') + 'width=480' : '',
            price: p.price
          };
        }
      } catch (e) { out = {}; }
      const res = new Response(JSON.stringify(out), {
        headers: { ...cors, 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=86400' }
      });
      await cache.put(ck, res.clone());
      return res;
    }

    if (request.method !== 'POST') return new Response('POST only', { status: 405, headers: cors });

    let body;
    try { body = await request.json(); } catch (e) {
      return new Response('bad json', { status: 400, headers: cors });
    }

    if (url.pathname === '/plan') {
      let msgs = Array.isArray(body.messages) ? body.messages : [];
      msgs = msgs.slice(-8).map(function (m) {
        return {
          role: m.role === 'assistant' ? 'assistant' : 'user',
          content: String(m.content || '').slice(0, 600)
        };
      }).filter(function (m) { return m.content; });
      if (!msgs.length || msgs[msgs.length - 1].role !== 'user') {
        return new Response('missing message', { status: 400, headers: cors });
      }
      const pr = await callAnthropic(env, { system: PLAN_SYSTEM, messages: msgs, maxTokens: 300 });
      if (!pr.ok) {
        return new Response(JSON.stringify({ error: 'anthropic ' + pr.status }), {
          status: 502, headers: { ...cors, 'Content-Type': 'application/json' }
        });
      }
      const ptext = textOf(pr);
      const pmatch = ptext.match(/\{[\s\S]*\}/);
      let plan = null;
      if (pmatch) { try { plan = JSON.parse(pmatch[0]); } catch (e) { plan = null; } }
      if (!plan || typeof plan.reply !== 'string') {
        return new Response(JSON.stringify({ reply: 'Tell me a river, lake, or town and what you\'re after.', ready: false }), {
          headers: { ...cors, 'Content-Type': 'application/json' }
        });
      }
      return new Response(JSON.stringify(plan), {
        headers: { ...cors, 'Content-Type': 'application/json' }
      });
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
      const ctx = JSON.stringify(body.context || {}).slice(0, 3000);
      // attach fresh context to the CURRENT question (last user turn) so the
      // model always has the conditions and access points right next to what
      // it's answering — on follow-ups it was losing data buried turns back
      const li = msgs.length - 1;
      msgs[li] = { role: msgs[li].role, content: 'Current conditions & nearby access points (JSON): ' + ctx + '\n\nAngler asks: ' + msgs[li].content };
      const ar = await callAnthropic(env, { system: GUIDE_SYSTEM, messages: msgs, maxTokens: 700 });
      if (!ar.ok) {
        return new Response(JSON.stringify({ error: 'anthropic ' + ar.status }), {
          status: 502, headers: { ...cors, 'Content-Type': 'application/json' }
        });
      }
      return new Response(JSON.stringify({ answer: textOf(ar) }), {
        headers: { ...cors, 'Content-Type': 'application/json' }
      });
    }

    const { name, state, lat, lon, water, candidates, onWater } = body || {};
    if (!name || typeof lat !== 'number' || typeof lon !== 'number') {
      return new Response('missing fields', { status: 400, headers: cors });
    }

    const cache = caches.default;
    const cacheKey = new Request('https://cache.fly-finder.internal/v3/' + encodeURIComponent(
      [name, state || '', Math.round(lat * 20) / 20, Math.round(lon * 20) / 20, water || '', onWater || ''].join('|')
    ));
    const hit = await cache.match(cacheKey);
    if (hit) {
      const cached = new Response(hit.body, hit);
      Object.entries(cors).forEach(([k, v]) => cached.headers.set(k, v));
      return cached;
    }

    const userMsg =
      'Spot: "' + name + '" at ' + lat.toFixed(4) + ',' + lon.toFixed(4) +
      (state ? ' in ' + state : '') + (water ? ' (' + water + ' water)' : '') +
      (onWater ? ' — this spot is ON ' + onWater + '; identify the fishery as ' + onWater : '') + '. ' +
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
