/**
 * Cloudflare Worker for 80degrees Install URL Router
 *
 * Directs incoming HTTP/HTTPS requests to the appropriate installer:
 * - Windows PowerShell (irm ... | iex) -> scripts/install.ps1
 * - macOS / Linux (curl ... | sh)      -> scripts/install.sh
 *
 * Deploy to Cloudflare Workers and route to get.80degrees.dev/* or install.80degrees.dev/*
 */

const DEFAULT_POSTHOG_KEY = 'REDACTED_SECRET';
const DEFAULT_POSTHOG_HOST = 'https://us.i.posthog.com';

const REPO_OWNER = 'aniasusual';
const REPO_NAME = 'crbn';
const BRANCH = 'main';

const RAW_BASE = `https://raw.githubusercontent.com/${REPO_OWNER}/${REPO_NAME}/${BRANCH}/scripts`;

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, X-Device-ID',
};

async function forwardToPostHog(batch, host, apiKey) {
  const url = `${host.replace(/\/$/, '')}/batch/`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      api_key: apiKey,
      batch,
    }),
  });
  if (!res.ok) {
    const errText = await res.text().catch(() => '');
    console.error(`[PostHog Ingest Error ${res.status}]`, errText);
    throw new Error(`PostHog rejected batch with status ${res.status}: ${errText.slice(0, 200)}`);
  }
  return res;
}

export default {
  async fetch(request, env = {}, ctx = null) {
    const url = new URL(request.url);
    const userAgent = (request.headers.get('user-agent') || '').toLowerCase();
    const pathname = url.pathname.toLowerCase();
    const posthogKey = env?.POSTHOG_API_KEY || DEFAULT_POSTHOG_KEY;
    const posthogHost = env?.POSTHOG_HOST || DEFAULT_POSTHOG_HOST;

    // 1. CORS Preflight
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: CORS_HEADERS });
    }

    const clientIp = request.headers.get('cf-connecting-ip') || request.headers.get('x-forwarded-for') || request.headers.get('x-real-ip');

    // 2. Client Telemetry Ingestion (Desktop App, Install Scripts, & CLI)
    if (pathname === '/api/v1/telemetry' && request.method === 'POST') {
      try {
        const body = await request.json();
        const incomingEvents = Array.isArray(body.events)
          ? body.events
          : [body];

        const cf = request.cf || {};
        const geoProps = {
          $geoip_country_code: cf.country || undefined,
          $geoip_city_name: cf.city || undefined,
          $geoip_subdivision_1_name: cf.region || undefined,
          cf_colo: cf.colo || undefined,
          cf_asn: cf.asn || undefined,
          $ip: clientIp || undefined,
        };

        const posthogBatch = incomingEvents.map((evt) => {
          const isIdentify = evt.event === '$identify';
          const eventDistinctId = isIdentify
            ? (evt.distinct_id || evt.properties?.distinct_id || body.device_id)
            : (evt.distinct_id || body.device_id || request.headers.get('x-device-id') || 'anonymous');

          let isoTimestamp = new Date().toISOString();
          if (evt.timestamp) {
            try {
              const d = typeof evt.timestamp === 'number'
                ? (evt.timestamp < 10000000000 ? new Date(evt.timestamp * 1000) : new Date(evt.timestamp))
                : new Date(evt.timestamp);
              if (!isNaN(d.getTime())) {
                isoTimestamp = d.toISOString();
              }
            } catch (_) {}
          }

          const eventProps = {
            ...geoProps,
            ...(evt.properties || {}),
            ip_user_agent: request.headers.get('user-agent') || undefined,
            $lib: '80degrees-worker-ingest',
          };

          if (isIdentify && body.device_id && !eventProps.$anon_distinct_id) {
            eventProps.$anon_distinct_id = body.device_id;
          }

          return {
            event: evt.event || 'unknown_event',
            distinct_id: eventDistinctId,
            timestamp: isoTimestamp,
            properties: eventProps,
          };
        });

        const forwardPromise = forwardToPostHog(posthogBatch, posthogHost, posthogKey);
        if (ctx && typeof ctx.waitUntil === 'function') {
          ctx.waitUntil(forwardPromise);
        } else {
          await forwardPromise;
        }

        return new Response(JSON.stringify({ ok: true, count: posthogBatch.length }), {
          headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
        });
      } catch (err) {
        return new Response(JSON.stringify({ ok: false, error: err.message }), {
          status: 502,
          headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
        });
      }
    }

    // 3. PostHog Reverse Proxy for Web/Desktop Session Recording & Events
    if (pathname.startsWith('/api/v1/posthog')) {
      const posthogPath = pathname.replace(/^\/api\/v1\/posthog/, '') || '/';
      const targetUrl = new URL(posthogPath + url.search, posthogHost);

      const proxyHeaders = new Headers(request.headers);
      proxyHeaders.set('host', targetUrl.hostname);
      if (clientIp) {
        proxyHeaders.set('x-forwarded-for', clientIp);
        proxyHeaders.set('x-real-ip', clientIp);
      }

      try {
        const posthogResp = await fetch(targetUrl.toString(), {
          method: request.method,
          headers: proxyHeaders,
          body: request.method !== 'GET' && request.method !== 'HEAD' ? request.body : undefined,
          redirect: 'follow',
        });

        const respHeaders = new Headers(posthogResp.headers);
        for (const [key, val] of Object.entries(CORS_HEADERS)) {
          respHeaders.set(key, val);
        }
        return new Response(posthogResp.body, {
          status: posthogResp.status,
          headers: respHeaders,
        });
      } catch (err) {
        return new Response(JSON.stringify({ ok: false, error: err.message }), {
          status: 502,
          headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
        });
      }
    }

    // Helper to log genuine installer downloads (excluding web crawlers and bot previews)
    const isBot = /bot|crawl|spider|slurp|facebook|twitter|discord|whatsapp|telegram|preview/i.test(userAgent);
    const isCliInstaller = /curl|wget|powershell|pwsh|winhttp/i.test(userAgent) || url.searchParams.has('install');

    const trackInstallerHit = (platform, trackingId) => {
      if (isBot || !isCliInstaller) return; // Never record bots or casual browser clicks as installer requests
      const cf = request.cf || {};
      const hitPromise = forwardToPostHog(
        [
          {
            event: 'installer_requested',
            distinct_id: trackingId,
            timestamp: new Date().toISOString(),
            properties: {
              platform,
              path: url.pathname,
              query_ref: url.searchParams.get('ref') || undefined,
              user_agent: request.headers.get('user-agent') || 'unknown',
              $geoip_country_code: cf.country || undefined,
              $geoip_city_name: cf.city || undefined,
              cf_colo: cf.colo || undefined,
              $ip: clientIp || undefined,
              $lib: '80degrees-edge-worker',
            },
          },
        ],
        posthogHost,
        posthogKey
      );
      if (ctx && typeof ctx.waitUntil === 'function') {
        ctx.waitUntil(hitPromise);
      }
    };


    // 3. Explicit PowerShell script request or PowerShell User-Agent
    if (pathname.endsWith('.ps1') || pathname === '/win' || pathname === '/windows' || userAgent.includes('powershell')) {
      const trackingId = crypto.randomUUID();
      trackInstallerHit('windows', trackingId);
      const resp = await fetch(`${RAW_BASE}/install.ps1`);
      const rawText = await resp.text();
      const dynamicText = rawText.replace('$DeviceIdOverride = ""', `$DeviceIdOverride = "${trackingId}"`);
      return new Response(dynamicText, {
        headers: {
          'Content-Type': 'text/plain; charset=utf-8',
          'Cache-Control': 'no-cache, no-store, must-revalidate',
        },
      });
    }

    // 4. Default: Shell installer for macOS & Linux
    const trackingId = crypto.randomUUID();
    trackInstallerHit('unix', trackingId);
    const resp = await fetch(`${RAW_BASE}/install.sh`);
    const rawText = await resp.text();
    const dynamicText = rawText.replace('DEVICE_ID_OVERRIDE=""', `DEVICE_ID_OVERRIDE="${trackingId}"`);
    return new Response(dynamicText, {
      headers: {
        'Content-Type': 'text/plain; charset=utf-8',
        'Cache-Control': 'no-cache, no-store, must-revalidate',
      },
    });
  },
};
