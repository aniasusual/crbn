/**
 * Cloudflare Worker for 80degrees Install URL Router
 *
 * Directs incoming HTTP/HTTPS requests to the appropriate installer:
 * - Windows PowerShell (irm ... | iex) -> scripts/install.ps1
 * - macOS / Linux (curl ... | sh)      -> scripts/install.sh
 *
 * Deploy to Cloudflare Workers and route to get.80degrees.dev/* or install.80degrees.dev/*
 */

const DEFAULT_POSTHOG_KEY = 'phc_tkhNR4JeqRZ6HNggwmNdZnnoX763p8Xmc65RGChzAQFV';
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
  try {
    await fetch(`${host.replace(/\/$/, '')}/batch/`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        api_key: apiKey,
        batch,
      }),
    });
  } catch (_) {
    // Telemetry errors must never fail the worker
  }
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

    // 2. Client Telemetry Ingestion (Desktop App & Install Scripts)
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
        };

        const posthogBatch = incomingEvents.map((evt) => ({
          event: evt.event || 'unknown_event',
          distinct_id: evt.distinct_id || body.device_id || request.headers.get('x-device-id') || 'anonymous',
          properties: {
            ...geoProps,
            ...(evt.properties || {}),
            ip_user_agent: request.headers.get('user-agent') || undefined,
            $lib: '80degrees-worker-ingest',
          },
          timestamp: evt.timestamp ? new Date(evt.timestamp).toISOString() : new Date().toISOString(),
        }));

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
          status: 400,
          headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
        });
      }
    }

    // Helper to log edge install requests
    const trackInstallerHit = (platform) => {
      const cf = request.cf || {};
      const hitPromise = forwardToPostHog(
        [
          {
            event: 'installer_requested',
            distinct_id: request.headers.get('cf-ray') || crypto.randomUUID(),
            properties: {
              platform,
              path: url.pathname,
              query_ref: url.searchParams.get('ref') || undefined,
              user_agent: request.headers.get('user-agent') || 'unknown',
              $geoip_country_code: cf.country || undefined,
              $geoip_city_name: cf.city || undefined,
              cf_colo: cf.colo || undefined,
              $lib: '80degrees-edge-worker',
            },
            timestamp: new Date().toISOString(),
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
      trackInstallerHit('windows');
      const resp = await fetch(`${RAW_BASE}/install.ps1`);
      return new Response(resp.body, {
        headers: {
          'Content-Type': 'text/plain; charset=utf-8',
          'Cache-Control': 'public, max-age=300',
        },
      });
    }

    // 4. Default: Shell installer for macOS & Linux
    trackInstallerHit('unix');
    const resp = await fetch(`${RAW_BASE}/install.sh`);
    return new Response(resp.body, {
      headers: {
        'Content-Type': 'text/plain; charset=utf-8',
        'Cache-Control': 'public, max-age=300',
      },
    });
  },
};
