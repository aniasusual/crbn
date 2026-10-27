/**
 * Cloudflare Worker for 80degrees Install URL Router
 *
 * Directs incoming HTTP/HTTPS requests to the appropriate installer:
 * - Windows PowerShell (irm ... | iex) -> scripts/install.ps1
 * - macOS / Linux (curl ... | sh)      -> scripts/install.sh
 *
 * Deploy to Cloudflare Workers and route to get.80degrees.dev/* or install.80degrees.dev/*
 */

const REPO_OWNER = 'aniasusual';
const REPO_NAME = 'crbn';
const BRANCH = 'main';

const RAW_BASE = `https://raw.githubusercontent.com/${REPO_OWNER}/${REPO_NAME}/${BRANCH}/scripts`;

export default {
  async fetch(request) {
    const url = new URL(request.url);
    const userAgent = (request.headers.get('user-agent') || '').toLowerCase();
    const pathname = url.pathname.toLowerCase();

    // 1. Explicit PowerShell script request or PowerShell User-Agent
    if (pathname.endsWith('.ps1') || pathname === '/win' || pathname === '/windows' || userAgent.includes('powershell')) {
      const resp = await fetch(`${RAW_BASE}/install.ps1`);
      return new Response(resp.body, {
        headers: {
          'Content-Type': 'text/plain; charset=utf-8',
          'Cache-Control': 'public, max-age=300',
        },
      });
    }

    // 2. Default: Shell installer for macOS & Linux
    const resp = await fetch(`${RAW_BASE}/install.sh`);
    return new Response(resp.body, {
      headers: {
        'Content-Type': 'text/plain; charset=utf-8',
        'Cache-Control': 'public, max-age=300',
      },
    });
  },
};
