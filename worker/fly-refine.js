// Fly Finder refinement worker.
// Holds the Anthropic API key server-side. Routes:
//   POST /        — which candidate species live in this exact stretch + a short read
//   POST /plan    — free-form place/species intent extraction (Haiku)
//   POST /ask     — conversational guide Q&A with follow-ups (Sonnet)
//   POST /feedback — store angler feedback in KV
//   GET  /fly-image — shop product photo proxy
//   GET  /diag    — end-to-end test of the Anthropic call
//   GET  /feedback[/view] — owner-only feedback dump
// Static instructions live in cached system blocks (prompt caching kicks in
// automatically once the prefix passes the model's minimum cacheable size).
// Valid refine responses are edge-cached 7 days; errors are never cached.
// /plan and /ask are rate-limited per client IP via the FEEDBACK KV binding.

export const ALLOWED_ORIGINS = [
  'https://engineerdia-alt.github.io',
  'https://flyfishinguniverse.com',
  'https://www.flyfishinguniverse.com',
  'http://localhost:8791',
  'http://localhost:8081',
  'http://127.0.0.1:8791',
  'http://127.0.0.1:8081'
];

// Sonnet for the reasoning-heavy guide + section reads; Haiku for cheap,
// high-volume intent extraction. Model IDs confirmed against Anthropic docs
// (claude-sonnet-5 is the current Sonnet API id).
export const MODEL = 'claude-haiku-4-5-20251001';
export const SMART_MODEL = 'claude-sonnet-5';

// Cost guardrails for uncached chat endpoints
export const PLAN_DAILY_LIMIT = 40;
export const ASK_DAILY_LIMIT = 30;
export const PLAN_HISTORY_TURNS = 6;
export const ASK_HISTORY_TURNS = 6;
export const MSG_CONTENT_MAX = 600;

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
  '"place": "the most specific water or town named. If the angler names a STATE (or it is obvious), you MUST include it, e.g. \\"Huron River, Ohio\\" — never drop the state, it disambiguates same-named rivers across states. null if no place given", ' +
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

export function corsHeaders(origin) {
  return {
    'Access-Control-Allow-Origin': ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0],
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type'
  };
}

export function clientIp(request) {
  return (
    request.headers.get('CF-Connecting-IP') ||
    request.headers.get('X-Forwarded-For')?.split(',')[0]?.trim() ||
    'unknown'
  );
}

export function rateLimitKey(route, ip, day) {
  return 'rl:' + route + ':' + ip + ':' + day;
}

export function utcDay(d) {
  return (d || new Date()).toISOString().slice(0, 10);
}

/** Returns { ok:true } or { ok:false, status, body } when over the daily cap. */
export async function checkRateLimit(env, request, route, limit) {
  if (!env.FEEDBACK || !limit) return { ok: true };
  const ip = clientIp(request);
  const key = rateLimitKey(route, ip, utcDay());
  const raw = await env.FEEDBACK.get(key);
  const count = raw ? parseInt(raw, 10) || 0 : 0;
  if (count >= limit) {
    return {
      ok: false,
      status: 429,
      body: JSON.stringify({
        error: 'rate_limit',
        message: 'Daily limit reached for this feature. Try again tomorrow, or use search / the wizard.'
      })
    };
  }
  // expire mid-next-UTC-day so the key does not linger forever
  await env.FEEDBACK.put(key, String(count + 1), { expirationTtl: 60 * 60 * 36 });
  return { ok: true };
}

export function normalizeChatMessages(messages, maxTurns) {
  const turns = maxTurns || PLAN_HISTORY_TURNS;
  return (Array.isArray(messages) ? messages : [])
    .slice(-turns)
    .map(function (m) {
      return {
        role: m.role === 'assistant' ? 'assistant' : 'user',
        content: String(m.content || '').slice(0, MSG_CONTENT_MAX)
      };
    })
    .filter(function (m) { return m.content; });
}

export function parseJsonObject(text) {
  const match = String(text || '').match(/\{[\s\S]*\}/);
  if (!match) return null;
  try { return JSON.parse(match[0]); } catch (e) { return null; }
}

export function textOf(r) {
  // Belt-and-suspenders: even with thinking disabled, don't assume the
  // answer is content[0] — concatenate every text block in order. This is
  // what actually broke follow-up questions in the Ask chat: Sonnet 5's
  // adaptive thinking put a `thinking` block (no `text` field) at
  // content[0], so grabbing content[0].text returned undefined and the
  // app showed "No answer came back" even though Claude had answered.
  const blocks = (r.body.content || []).filter(function (b) { return b.type === 'text' && b.text; });
  return blocks.map(function (b) { return b.text; }).join('\n\n');
}

export function refineCacheKeyParts(name, state, lat, lon, water, onWater) {
  return [name, state || '', Math.round(lat * 20) / 20, Math.round(lon * 20) / 20, water || '', onWater || ''].join('|');
}

async function callAnthropic(env, opts) {
  const payload = {
    model: opts.model || MODEL,
    max_tokens: opts.maxTokens,
    messages: opts.messages,
    // Claude Sonnet 5 runs adaptive thinking by default (unlike Haiku 4.5).
    // None of our prompts need multi-step reasoning — they're strict-JSON
    // extraction or a short synthesis of facts we already hand it in the
    // prompt — so thinking only ate into max_tokens and, worse, pushed a
    // leading `thinking` content block in front of the actual answer.
    // Disabling it keeps responses fast, cheap, and text-first.
    thinking: { type: 'disabled' }
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

export default {
  async fetch(request, env) {
    const origin = request.headers.get('Origin') || '';
    const cors = corsHeaders(origin);
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

    // read collected feedback (owner only, via ?key=FEEDBACK_TOKEN — a
    // separate password so the Anthropic key never rides in a URL).
    // /feedback -> JSON, /feedback/view -> a formatted HTML table
    if (request.method === 'GET' && (url.pathname === '/feedback' || url.pathname === '/feedback/view')) {
      if (!env.FEEDBACK) return new Response('feedback store not configured', { status: 500, headers: cors });
      if (!env.FEEDBACK_TOKEN || url.searchParams.get('key') !== env.FEEDBACK_TOKEN) {
        return new Response('Unauthorized. Set the FEEDBACK_TOKEN secret (npx wrangler secret put FEEDBACK_TOKEN) and use ?key=that', { status: 401, headers: cors });
      }
      const list = await env.FEEDBACK.list({ prefix: 'fb:', limit: 1000 });
      const items = [];
      for (const k of list.keys) {
        const v = await env.FEEDBACK.get(k.name);
        if (v) items.push(JSON.parse(v));
      }
      items.sort((a, b) => (b.ts || '').localeCompare(a.ts || ''));

      if (url.pathname === '/feedback') {
        return new Response(JSON.stringify({ count: items.length, items }, null, 2), {
          headers: { ...cors, 'Content-Type': 'application/json' }
        });
      }
      const esc = (s) => String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
      const rows = items.map((it) => {
        const when = it.ts ? new Date(it.ts).toLocaleString() : '';
        return '<tr><td class="d">' + esc(when) + '</td><td class="s">' + esc(it.spot || '—') + '</td><td>' + esc(it.message) + '</td></tr>';
      }).join('');
      const html = '<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">' +
        '<title>Fly Finder — Feedback</title><style>' +
        'body{font-family:-apple-system,Segoe UI,Roboto,sans-serif;background:#F2ECDD;color:#141C18;margin:0;padding:24px;}' +
        'h1{font-size:20px;margin:0 0 4px;}p.sub{color:#4B5750;margin:0 0 18px;font-size:13px;}' +
        'table{width:100%;border-collapse:collapse;background:#fff;border-radius:10px;overflow:hidden;box-shadow:0 1px 4px rgba(0,0,0,.08);}' +
        'th,td{text-align:left;padding:11px 13px;border-bottom:1px solid #E7DFC9;font-size:14px;vertical-align:top;}' +
        'th{background:#0F322C;color:#F2ECDD;font-size:12px;letter-spacing:.04em;text-transform:uppercase;}' +
        'td.d{white-space:nowrap;color:#4B5750;font-size:12px;}td.s{white-space:nowrap;color:#8C6A38;font-weight:600;}' +
        'tr:last-child td{border-bottom:none;}.empty{padding:24px;color:#4B5750;}</style></head><body>' +
        '<h1>Fly Finder — Feedback</h1><p class="sub">' + items.length + ' message' + (items.length === 1 ? '' : 's') + ' · newest first</p>' +
        (items.length ? '<table><thead><tr><th>When</th><th>Spot</th><th>Message</th></tr></thead><tbody>' + rows + '</tbody></table>' : '<p class="empty">No feedback yet.</p>') +
        '</body></html>';
      return new Response(html, { headers: { ...cors, 'Content-Type': 'text/html; charset=utf-8' } });
    }

    if (request.method !== 'POST') return new Response('POST only', { status: 405, headers: cors });

    // collect angler feedback
    if (url.pathname === '/feedback') {
      if (!env.FEEDBACK) return new Response('feedback store not configured', { status: 500, headers: cors });
      let fb;
      try { fb = await request.json(); } catch (e) { return new Response('bad json', { status: 400, headers: cors }); }
      const message = String((fb && fb.message) || '').slice(0, 2000).trim();
      if (!message) return new Response('empty', { status: 400, headers: cors });
      const rec = { message, spot: String((fb && fb.spot) || '').slice(0, 120), ts: new Date().toISOString() };
      await env.FEEDBACK.put('fb:' + Date.now() + ':' + Math.random().toString(36).slice(2, 8), JSON.stringify(rec));
      return new Response(JSON.stringify({ ok: true }), { headers: { ...cors, 'Content-Type': 'application/json' } });
    }

    let body;
    try { body = await request.json(); } catch (e) {
      return new Response('bad json', { status: 400, headers: cors });
    }

    if (url.pathname === '/plan') {
      const rl = await checkRateLimit(env, request, 'plan', PLAN_DAILY_LIMIT);
      if (!rl.ok) {
        return new Response(rl.body, {
          status: rl.status,
          headers: { ...cors, 'Content-Type': 'application/json', 'Retry-After': '86400' }
        });
      }
      const msgs = normalizeChatMessages(body.messages, PLAN_HISTORY_TURNS);
      if (!msgs.length || msgs[msgs.length - 1].role !== 'user') {
        return new Response('missing message', { status: 400, headers: cors });
      }
      const pr = await callAnthropic(env, { system: PLAN_SYSTEM, messages: msgs, maxTokens: 300 });
      if (!pr.ok) {
        return new Response(JSON.stringify({ error: 'anthropic ' + pr.status }), {
          status: 502, headers: { ...cors, 'Content-Type': 'application/json' }
        });
      }
      const plan = parseJsonObject(textOf(pr));
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
      const rl = await checkRateLimit(env, request, 'ask', ASK_DAILY_LIMIT);
      if (!rl.ok) {
        return new Response(rl.body, {
          status: rl.status,
          headers: { ...cors, 'Content-Type': 'application/json', 'Retry-After': '86400' }
        });
      }
      let msgs = Array.isArray(body.messages)
        ? body.messages
        : (body.question ? [{ role: 'user', content: body.question }] : []);
      msgs = normalizeChatMessages(msgs, ASK_HISTORY_TURNS);
      if (!msgs.length || msgs[msgs.length - 1].role !== 'user') {
        return new Response('missing question', { status: 400, headers: cors });
      }
      const ctx = JSON.stringify(body.context || {}).slice(0, 3000);
      // attach fresh context to the CURRENT question (last user turn) so the
      // model always has the conditions and access points right next to what
      // it's answering — on follow-ups it was losing data buried turns back
      const li = msgs.length - 1;
      msgs[li] = { role: msgs[li].role, content: 'Current conditions & nearby access points (JSON): ' + ctx + '\n\nAngler asks: ' + msgs[li].content };
      const ar = await callAnthropic(env, { model: SMART_MODEL, system: GUIDE_SYSTEM, messages: msgs, maxTokens: 900 });
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
    const cacheKey = new Request('https://cache.fly-finder.internal/v4/' + encodeURIComponent(
      refineCacheKeyParts(name, state, lat, lon, water, onWater)
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

    const r = await callAnthropic(env, { model: SMART_MODEL, system: REFINE_SYSTEM, messages: [{ role: 'user', content: userMsg }], maxTokens: 400 });
    if (!r.ok) {
      return new Response(JSON.stringify({ error: 'anthropic ' + r.status, detail: r.body.error }), {
        status: 502, headers: { ...cors, 'Content-Type': 'application/json' }
      });
    }

    const parsed = parseJsonObject(textOf(r));
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
