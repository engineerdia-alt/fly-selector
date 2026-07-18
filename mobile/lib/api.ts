const REFINE_URLS = [
  'https://api.flyfishingfinder.com',
  'https://fly-refine.flyfishingfinder.workers.dev',
];

export type PlanResult = {
  reply: string;
  ready: boolean;
  place?: string | null;
  species?: string | null;
  method?: string | null;
  water?: string | null;
};

export type AskResult = {
  answer: string;
};

export type ChatMessage = {
  role: 'user' | 'assistant';
  content: string;
};

async function postJson<T>(path: string, body: unknown): Promise<T> {
  let lastError: Error | null = null;
  for (const base of REFINE_URLS) {
    try {
      const res = await fetch(`${base}${path}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (res.status === 429) {
        const data = await res.json().catch(() => ({}));
        throw new Error(
          (data as { message?: string }).message ||
            'Daily AI limit reached. Try again tomorrow or use Explore.'
        );
      }
      if (!res.ok) throw new Error(`Request failed (${res.status})`);
      return (await res.json()) as T;
    } catch (e) {
      lastError = e instanceof Error ? e : new Error(String(e));
    }
  }
  throw lastError || new Error('Could not reach Fly Finder AI');
}

export function planTrip(messages: ChatMessage[]) {
  return postJson<PlanResult>('/plan', { messages });
}

export function askGuide(messages: ChatMessage[], context: Record<string, unknown>) {
  return postJson<AskResult>('/ask', { messages, context });
}

export type WeatherSnapshot = {
  tempF: number | null;
  windMph: number | null;
  sky: 'bright' | 'overcast' | 'lowlight' | null;
  precipIn24h: number | null;
};

export async function fetchWeather(lat: number, lon: number): Promise<WeatherSnapshot> {
  const url =
    `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}` +
    '&current=temperature_2m,precipitation,cloud_cover,wind_speed_10m' +
    '&hourly=precipitation&past_days=1&timezone=auto&temperature_unit=fahrenheit' +
    '&wind_speed_unit=mph&precipitation_unit=inch';
  const res = await fetch(url);
  if (!res.ok) throw new Error('Weather unavailable');
  const data = await res.json();
  const cur = data.current || {};
  const hourly = data.hourly?.precipitation || [];
  const precipIn24h = hourly.slice(-24).reduce((a: number, b: number) => a + (b || 0), 0);
  const cloud = cur.cloud_cover;
  let sky: WeatherSnapshot['sky'] = null;
  if (typeof cloud === 'number') {
    sky = cloud < 35 ? 'bright' : cloud > 70 ? 'overcast' : 'lowlight';
  }
  return {
    tempF: typeof cur.temperature_2m === 'number' ? cur.temperature_2m : null,
    windMph: typeof cur.wind_speed_10m === 'number' ? cur.wind_speed_10m : null,
    sky,
    precipIn24h: Number.isFinite(precipIn24h) ? Math.round(precipIn24h * 100) / 100 : null,
  };
}

export type GaugeSnapshot = {
  flowCfs: number | null;
  waterTempF: number | null;
  siteName: string | null;
  trend: 'rising' | 'falling' | 'steady' | null;
  trendPct: number | null;
};

export async function fetchNearestGauge(lat: number, lon: number): Promise<GaugeSnapshot | null> {
  const bbox = [
    (lon - 0.35).toFixed(4),
    (lat - 0.35).toFixed(4),
    (lon + 0.35).toFixed(4),
    (lat + 0.35).toFixed(4),
  ].join(',');
  const listUrl =
    'https://waterservices.usgs.gov/nwis/site/?format=rdb&bBox=' +
    bbox +
    '&siteType=ST&hasDataTypeCd=iv&parameterCd=00060,00010';
  const listRes = await fetch(listUrl);
  if (!listRes.ok) return null;
  const text = await listRes.text();
  const sites: { code: string; name: string; lat: number; lon: number }[] = [];
  text.split('\n').forEach((line) => {
    if (!line || line.startsWith('#') || line.startsWith('agency_cd')) return;
    const parts = line.split('\t');
    if (parts.length < 8) return;
    const code = parts[1];
    const name = parts[2];
    const slat = parseFloat(parts[4]);
    const slon = parseFloat(parts[5]);
    if (!code || isNaN(slat) || isNaN(slon)) return;
    sites.push({ code, name, lat: slat, lon: slon });
  });
  if (!sites.length) return null;
  sites.sort((a, b) => {
    const da = (a.lat - lat) ** 2 + (a.lon - lon) ** 2;
    const db = (b.lat - lat) ** 2 + (b.lon - lon) ** 2;
    return da - db;
  });
  const site = sites[0];
  const ivUrl =
    'https://waterservices.usgs.gov/nwis/iv/?format=json&sites=' +
    site.code +
    '&parameterCd=00060,00010&period=P2D';
  const ivRes = await fetch(ivUrl);
  if (!ivRes.ok) return { flowCfs: null, waterTempF: null, siteName: site.name, trend: null, trendPct: null };
  const iv = await ivRes.json();
  const series = iv?.value?.timeSeries || [];
  let flowCfs: number | null = null;
  let waterTempF: number | null = null;
  let trend: GaugeSnapshot['trend'] = null;
  let trendPct: number | null = null;
  for (const ts of series) {
    const pcode = ts?.variable?.variableCode?.[0]?.value;
    const vals = ts?.values?.[0]?.value || [];
    if (!vals.length) continue;
    const last = parseFloat(vals[vals.length - 1].value);
    if (isNaN(last) || last === -999999) continue;
    if (pcode === '00060') {
      flowCfs = last;
      const nums = vals
        .map((v: { value: string }) => parseFloat(v.value))
        .filter((n: number) => !isNaN(n) && n !== -999999);
      if (nums.length > 8) {
        const dayAgo = nums[Math.max(0, nums.length - 1 - Math.round(nums.length / 2))];
        if (dayAgo > 0) {
          const pct = ((last - dayAgo) / dayAgo) * 100;
          trendPct = Math.round(pct);
          trend = pct > 15 ? 'rising' : pct < -15 ? 'falling' : 'steady';
        }
      }
    }
    if (pcode === '00010') {
      // USGS water temp is Celsius in IV
      waterTempF = Math.round((last * 9) / 5 + 32);
    }
  }
  return { flowCfs, waterTempF, siteName: site.name, trend, trendPct };
}
