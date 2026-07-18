# Fly Finder refinement worker

A tiny Cloudflare Worker that holds the Anthropic API key server-side and
powers the AI features of the Fly Finder embed. The key never appears in the
page code, the repo, or the browser.

## Routes

| Method | Path | Model | Purpose |
|--------|------|-------|---------|
| `POST` | `/` | Claude Sonnet 5 | Refine which species live in this stretch + short local read (edge-cached 7 days) |
| `POST` | `/plan` | Claude Haiku 4.5 | Parse free-form "where / what" into place + species for the app |
| `POST` | `/ask` | Claude Sonnet 5 | Conditions-grounded guide Q&A (message history) |
| `POST` | `/feedback` | — | Store angler feedback in KV |
| `GET` | `/fly-image?q=` | — | Proxy shop product photo (cached 1 day) |
| `GET` | `/diag` | Haiku | End-to-end Anthropic smoke test |
| `GET` | `/feedback` / `/feedback/view` | — | Owner-only feedback dump (`?key=FEEDBACK_TOKEN`) |

## Allowed browser origins (CORS)

- `https://flyfishinguniverse.com` (live shop embed)
- `https://www.flyfishinguniverse.com`
- `https://engineerdia-alt.github.io` (GitHub Pages)
- `http://localhost:8791` / `http://localhost:8081` (local; also `127.0.0.1`)

## Deploy (one time, ~5 minutes)

1. Create a free account at https://dash.cloudflare.com (no card needed).
2. In the dashboard: **Workers & Pages → Create → Create Worker**.
   Name it `fly-refine`, click **Deploy** (the hello-world is fine).
3. Click **Edit code**, delete the boilerplate, paste the entire contents
   of `fly-refine.js`, then **Save and deploy**.
   Or from this folder: `npx wrangler deploy`.
4. Back on the worker's page: **Settings → Variables and Secrets →
   Add → Secret**. Name: `ANTHROPIC_API_KEY`. Value: paste your key from
   https://console.anthropic.com/settings/keys. Save.
   (This is the only place the key ever goes — never commit it or paste it
   into chat, code, or the site.)
5. Bind a KV namespace as `FEEDBACK` (used for feedback storage **and**
   per-IP rate-limit counters for `/plan` and `/ask`).
6. Optionally set secret `FEEDBACK_TOKEN` for reading `/feedback`.
7. Copy the worker URL, e.g. `https://fly-refine.<your-subdomain>.workers.dev`,
   and set it as `REFINE_URL` / `REFINE_URLS` near the top of the script in
   `fly-finder.html`.

## Cost control

- Refine (`POST /`) responses are cached at the edge for 7 days per water, so
  repeat picks of the same spot make zero API calls. Errors are never cached.
- `/plan` uses Claude Haiku 4.5 with a 300-token cap.
- `/ask` and refine use Claude Sonnet 5; thinking is disabled so answers stay
  text-first and cheap.
- Guide and plan history are capped at 6 turns; each message is truncated.
- Per-IP daily caps (via FEEDBACK KV): **40** `/plan` and **30** `/ask`
  requests. Over-limit returns HTTP 429.
- CORS is locked to the shop, GitHub Pages, and localhost, so other sites
  can't burn your quota from a browser. (Direct curl calls can still reach
  it; the IP caps still apply when KV is bound.)

## Develop / test

```bash
cd worker
npm install
npm test
npm run lint:ci
```
