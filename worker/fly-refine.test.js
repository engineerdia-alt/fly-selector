import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it, mock } from 'node:test';
import worker, {
  ALLOWED_ORIGINS,
  ASK_DAILY_LIMIT,
  ASK_HISTORY_TURNS,
  MODEL,
  MSG_CONTENT_MAX,
  PLAN_DAILY_LIMIT,
  PLAN_HISTORY_TURNS,
  SMART_MODEL,
  checkRateLimit,
  clientIp,
  corsHeaders,
  normalizeChatMessages,
  parseJsonObject,
  rateLimitKey,
  refineCacheKeyParts,
  textOf,
  utcDay
} from './fly-refine.js';

function memoryKv() {
  const store = new Map();
  return {
    store,
    async get(key) { return store.has(key) ? store.get(key) : null; },
    async put(key, value) { store.set(key, String(value)); },
    async list({ prefix }) {
      const keys = [...store.keys()]
        .filter((k) => !prefix || k.startsWith(prefix))
        .map((name) => ({ name }));
      return { keys };
    }
  };
}

function memoryCache() {
  const store = new Map();
  return {
    async match(req) {
      const key = typeof req === 'string' ? req : req.url;
      const hit = store.get(key);
      return hit ? hit.clone() : undefined;
    },
    async put(req, res) {
      const key = typeof req === 'string' ? req : req.url;
      store.set(key, res.clone());
    }
  };
}

function mockAnthropic(textBlocks, { status = 200, modelEcho } = {}) {
  return mock.method(globalThis, 'fetch', async (url, init) => {
    assert.match(String(url), /api\.anthropic\.com/);
    const payload = JSON.parse(init.body);
    if (modelEcho) modelEcho.push(payload.model);
    assert.equal(payload.thinking.type, 'disabled');
    const content = Array.isArray(textBlocks)
      ? textBlocks
      : [{ type: 'text', text: textBlocks }];
    return {
      ok: status >= 200 && status < 300,
      status,
      async json() {
        return { content, model: payload.model };
      }
    };
  });
}

describe('models and cache contract', () => {
  it('keeps the confirmed Anthropic model IDs', () => {
    assert.equal(SMART_MODEL, 'claude-sonnet-5');
    assert.equal(MODEL, 'claude-haiku-4-5-20251001');
  });

  it('builds stable refine cache keys that snap lat/lon', () => {
    const a = refineCacheKeyParts('Huron River', 'Michigan', 42.281, -83.748, 'river', '');
    const b = refineCacheKeyParts('Huron River', 'Michigan', 42.279, -83.751, 'river', '');
    assert.equal(a, b);
    assert.match(a, /^Huron River\|Michigan\|/);
  });
});

describe('CORS', () => {
  it('allows shop and local origins', () => {
    assert.ok(ALLOWED_ORIGINS.includes('https://flyfishinguniverse.com'));
    assert.ok(ALLOWED_ORIGINS.includes('https://www.flyfishinguniverse.com'));
    assert.ok(ALLOWED_ORIGINS.includes('https://engineerdia-alt.github.io'));
    assert.ok(ALLOWED_ORIGINS.includes('http://localhost:8791'));
    assert.ok(ALLOWED_ORIGINS.includes('http://localhost:8081'));
    assert.ok(ALLOWED_ORIGINS.includes('http://127.0.0.1:8081'));
  });

  it('echoes an allowlisted Origin', () => {
    const h = corsHeaders('https://flyfishinguniverse.com');
    assert.equal(h['Access-Control-Allow-Origin'], 'https://flyfishinguniverse.com');
    assert.equal(corsHeaders('http://localhost:8081')['Access-Control-Allow-Origin'], 'http://localhost:8081');
  });

  it('falls back for unknown Origin so browsers block credentialed misuse', () => {
    const h = corsHeaders('https://evil.example');
    assert.equal(h['Access-Control-Allow-Origin'], ALLOWED_ORIGINS[0]);
  });

  it('answers OPTIONS with allowlisted shop origin', async () => {
    const res = await worker.fetch(new Request('https://api.flyfishingfinder.com/plan', {
      method: 'OPTIONS',
      headers: { Origin: 'https://flyfishinguniverse.com' }
    }), {});
    assert.equal(res.status, 200);
    assert.equal(res.headers.get('Access-Control-Allow-Origin'), 'https://flyfishinguniverse.com');
  });
});

describe('textOf / parseJsonObject', () => {
  it('concatenates text blocks and skips thinking blocks', () => {
    const out = textOf({
      body: {
        content: [
          { type: 'thinking', thinking: '...' },
          { type: 'text', text: '{"reply":"hi","ready":false}' }
        ]
      }
    });
    assert.equal(out, '{"reply":"hi","ready":false}');
  });

  it('parses the first JSON object from model prose', () => {
    const plan = parseJsonObject('Sure.\n{"reply":"Ok","ready":true,"place":"Au Sable, Michigan"}\n');
    assert.equal(plan.place, 'Au Sable, Michigan');
    assert.equal(plan.ready, true);
  });

  it('returns null for unparseable output', () => {
    assert.equal(parseJsonObject('no json here'), null);
  });
});

describe('history caps', () => {
  it('keeps only the last N turns and truncates content', () => {
    const long = 'x'.repeat(MSG_CONTENT_MAX + 50);
    const msgs = [];
    for (let i = 0; i < 12; i++) {
      msgs.push({ role: i % 2 ? 'assistant' : 'user', content: long + i });
    }
    const out = normalizeChatMessages(msgs, ASK_HISTORY_TURNS);
    assert.equal(out.length, ASK_HISTORY_TURNS);
    assert.equal(PLAN_HISTORY_TURNS, 6);
    assert.equal(ASK_HISTORY_TURNS, 6);
    out.forEach((m) => assert.ok(m.content.length <= MSG_CONTENT_MAX));
  });
});

describe('rate limits', () => {
  it('derives IP from CF-Connecting-IP', () => {
    const req = new Request('https://example.com', {
      headers: { 'CF-Connecting-IP': '1.2.3.4', 'X-Forwarded-For': '9.9.9.9' }
    });
    assert.equal(clientIp(req), '1.2.3.4');
    assert.equal(rateLimitKey('ask', '1.2.3.4', '2026-07-18'), 'rl:ask:1.2.3.4:2026-07-18');
    assert.match(utcDay(new Date('2026-07-18T12:00:00Z')), /^2026-07-18$/);
  });

  it('allows under the cap and blocks at the cap', async () => {
    const kv = memoryKv();
    const env = { FEEDBACK: kv };
    const req = new Request('https://api.example/ask', {
      headers: { 'CF-Connecting-IP': '8.8.8.8' }
    });
    for (let i = 0; i < ASK_DAILY_LIMIT; i++) {
      const r = await checkRateLimit(env, req, 'ask', ASK_DAILY_LIMIT);
      assert.equal(r.ok, true);
    }
    const blocked = await checkRateLimit(env, req, 'ask', ASK_DAILY_LIMIT);
    assert.equal(blocked.ok, false);
    assert.equal(blocked.status, 429);
    assert.match(blocked.body, /rate_limit/);
    assert.equal(PLAN_DAILY_LIMIT, 40);
  });

  it('fails open when KV is not bound', async () => {
    const r = await checkRateLimit({}, new Request('https://x'), 'plan', PLAN_DAILY_LIMIT);
    assert.equal(r.ok, true);
  });
});

describe('handler routes', () => {
  let fetchMock;
  let prevCaches;

  beforeEach(() => {
    prevCaches = globalThis.caches;
    globalThis.caches = { default: memoryCache() };
  });

  afterEach(() => {
    if (fetchMock) fetchMock.mock.restore();
    fetchMock = undefined;
    globalThis.caches = prevCaches;
  });

  it('GET /diag fails without API key', async () => {
    const res = await worker.fetch(new Request('https://api.flyfishingfinder.com/diag'), {});
    assert.equal(res.status, 500);
    assert.match(await res.text(), /ANTHROPIC_API_KEY/);
  });

  it('GET /diag succeeds when Anthropic replies', async () => {
    fetchMock = mockAnthropic('ok');
    const res = await worker.fetch(
      new Request('https://api.flyfishingfinder.com/diag', {
        headers: { Origin: 'https://flyfishinguniverse.com' }
      }),
      { ANTHROPIC_API_KEY: 'test-key' }
    );
    assert.equal(res.status, 200);
    assert.match(await res.text(), /DIAG OK/);
    assert.equal(res.headers.get('Access-Control-Allow-Origin'), 'https://flyfishinguniverse.com');
  });

  it('POST /plan returns parsed JSON and uses Haiku', async () => {
    const models = [];
    fetchMock = mockAnthropic(
      '{"reply":"Let\'s look at the Huron.","ready":true,"place":"Huron River, Michigan","species":"bass","method":"wading","water":"river"}',
      { modelEcho: models }
    );
    const res = await worker.fetch(new Request('https://api.flyfishingfinder.com/plan', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Origin: 'https://flyfishinguniverse.com',
        'CF-Connecting-IP': '10.0.0.1'
      },
      body: JSON.stringify({ messages: [{ role: 'user', content: 'smallmouth near Ann Arbor' }] })
    }), { ANTHROPIC_API_KEY: 'test-key', FEEDBACK: memoryKv() });
    assert.equal(res.status, 200);
    const plan = await res.json();
    assert.equal(plan.ready, true);
    assert.equal(plan.place, 'Huron River, Michigan');
    assert.equal(plan.species, 'bass');
    assert.equal(models[0], MODEL);
  });

  it('POST /plan returns 429 when over daily cap', async () => {
    const kv = memoryKv();
    const day = utcDay();
    await kv.put(rateLimitKey('plan', '10.0.0.9', day), String(PLAN_DAILY_LIMIT));
    const res = await worker.fetch(new Request('https://api.flyfishingfinder.com/plan', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'CF-Connecting-IP': '10.0.0.9'
      },
      body: JSON.stringify({ messages: [{ role: 'user', content: 'trout near Boulder' }] })
    }), { ANTHROPIC_API_KEY: 'test-key', FEEDBACK: kv });
    assert.equal(res.status, 429);
  });

  it('POST /ask returns answer with Sonnet and attaches context', async () => {
    const models = [];
    fetchMock = mock.method(globalThis, 'fetch', async (url, init) => {
      const payload = JSON.parse(init.body);
      models.push(payload.model);
      const last = payload.messages[payload.messages.length - 1].content;
      assert.match(last, /Current conditions/);
      assert.match(last, /Angler asks: worth going/);
      assert.match(last, /Huron River/);
      return {
        ok: true,
        status: 200,
        async json() {
          return {
            content: [
              { type: 'thinking', thinking: 'skip me' },
              { type: 'text', text: '**Yes** — gauge is steady. Try the map access points.' }
            ]
          };
        }
      };
    });
    const res = await worker.fetch(new Request('https://api.flyfishingfinder.com/ask', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Origin: 'https://www.flyfishinguniverse.com',
        'CF-Connecting-IP': '10.0.0.2'
      },
      body: JSON.stringify({
        messages: [{ role: 'user', content: 'worth going?' }],
        context: { spot: 'Huron River', nearbyAccessPoints: ['Delhi Metropark'] }
      })
    }), { ANTHROPIC_API_KEY: 'test-key', FEEDBACK: memoryKv() });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.match(body.answer, /Yes/);
    assert.equal(models[0], SMART_MODEL);
    assert.equal(res.headers.get('Access-Control-Allow-Origin'), 'https://www.flyfishinguniverse.com');
  });

  it('POST / refine parses species JSON, uses Sonnet, and caches', async () => {
    let calls = 0;
    fetchMock = mock.method(globalThis, 'fetch', async () => {
      calls += 1;
      return {
        ok: true,
        status: 200,
        async json() {
          return {
            content: [{
              type: 'text',
              text: '{"species":["trout","bass"],"read":"Cool freestone.","regs":""}'
            }]
          };
        }
      };
    });
    const env = { ANTHROPIC_API_KEY: 'test-key' };
    const payload = {
      name: 'Au Sable River',
      state: 'Michigan',
      lat: 44.66,
      lon: -84.71,
      water: 'river',
      candidates: ['trout', 'bass', 'pike']
    };
    const req1 = new Request('https://api.flyfishingfinder.com/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: 'https://flyfishinguniverse.com' },
      body: JSON.stringify(payload)
    });
    const res1 = await worker.fetch(req1, env);
    assert.equal(res1.status, 200);
    const parsed = await res1.json();
    assert.deepEqual(parsed.species, ['trout', 'bass']);
    assert.equal(res1.headers.get('Cache-Control'), 'public, max-age=604800');
    assert.equal(calls, 1);

    const req2 = new Request('https://api.flyfishingfinder.com/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: 'https://flyfishinguniverse.com' },
      body: JSON.stringify(payload)
    });
    const res2 = await worker.fetch(req2, env);
    assert.equal(res2.status, 200);
    assert.deepEqual(await res2.json(), parsed);
    assert.equal(calls, 1, 'second refine should hit edge cache');
  });

  it('POST / refine does not cache unparseable model output', async () => {
    fetchMock = mockAnthropic('sorry, no json');
    const res = await worker.fetch(new Request('https://api.flyfishingfinder.com/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'X', lat: 1, lon: 2, candidates: ['trout'] })
    }), { ANTHROPIC_API_KEY: 'test-key' });
    assert.equal(res.status, 502);
    assert.match(await res.text(), /unparseable/);
  });
});
