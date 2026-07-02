# Fly Finder refinement worker

A tiny Cloudflare Worker that holds the Anthropic API key server-side and
answers "which species actually live in this exact stretch?" for the app.
The key never appears in the page code, the repo, or the browser.

## Deploy (one time, ~5 minutes)

1. Create a free account at https://dash.cloudflare.com (no card needed).
2. In the dashboard: **Workers & Pages → Create → Create Worker**.
   Name it `fly-refine`, click **Deploy** (the hello-world is fine).
3. Click **Edit code**, delete the boilerplate, paste the entire contents
   of `fly-refine.js`, then **Save and deploy**.
4. Back on the worker's page: **Settings → Variables and Secrets →
   Add → Secret**. Name: `ANTHROPIC_API_KEY`. Value: paste your key from
   https://console.anthropic.com/settings/keys. Save.
   (This is the only place the key ever goes — never commit it or paste it
   into chat, code, or the site.)
5. Copy the worker URL, e.g. `https://fly-refine.<your-subdomain>.workers.dev`,
   and set it as `REFINE_URL` near the top of the script in `fly-finder.html`.

## Cost control

- Responses are cached at the edge for 7 days per water, so repeat picks of
  the same spot make zero API calls.
- Uses Claude Haiku 4.5 with a 400-token cap — roughly a tenth of a cent
  per uncached lookup.
- CORS is locked to `engineerdia-alt.github.io` and `localhost:8791`, so
  other sites can't burn your quota. (Direct curl calls can still reach it;
  if usage ever looks odd, add rate limiting or rotate the key.)
