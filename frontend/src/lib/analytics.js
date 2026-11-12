import posthog from 'posthog-js';

const POSTHOG_KEY = import.meta.env.VITE_POSTHOG_KEY || 'REDACTED_SECRET';
const POSTHOG_HOST = import.meta.env.VITE_POSTHOG_HOST || 'https://us.i.posthog.com';

function getOrCreateDeviceId() {
  try {
    const existing = localStorage.getItem('80degrees_device_id');
    if (existing) return existing;
    const newId = crypto.randomUUID();
    localStorage.setItem('80degrees_device_id', newId);
    return newId;
  } catch {
    return 'anon-' + Math.random().toString(36).slice(2, 10);
  }
}

/**
 * Initialize PostHog Analytics and Session Recording for the 80degrees Desktop UI.
 */
export function initAnalytics() {
  if (typeof window === 'undefined') return;

  const dnt = navigator.doNotTrack === '1' || window.doNotTrack === '1';
  if (dnt) {
    return;
  }

  const deviceId = getOrCreateDeviceId();

  try {
    posthog.init(POSTHOG_KEY, {
      api_host: POSTHOG_HOST,
      ui_host: 'https://us.posthog.com',
      bootstrap: {
        distinctID: deviceId,
      },
      autocapture: true,
      capture_pageview: true,
      capture_pageleave: true,
      disable_session_recording: false,
      session_recording: {
        recordCrossOriginIframes: false,
        maskAllInputs: false,
        maskTextSelector: [
          '.apikey-dialog-input',
          '.mcp-form-input',
          '.chat-panel__input-secret',
          'input[type="password"]',
          '[data-ph-mask]',
        ].join(', '),
        blockSelector: '.ph-no-capture',
      },
      persistence: 'localStorage',
    });
    window.posthog = posthog;
  } catch (err) {
    console.warn('[Analytics] Failed to initialize PostHog:', err);
  }
}

/**
 * Identify a user in PostHog when they connect GitHub or account credentials.
 */
export function identifyUser(userId, traits = {}) {
  try {
    if (posthog && typeof posthog.identify === 'function') {
      posthog.identify(userId, traits);
    }
  } catch {
    // Ignore identification errors
  }
}

/**
 * Reset PostHog user identity on disconnect/logout.
 */
export function resetUser() {
  try {
    if (posthog && typeof posthog.reset === 'function') {
      posthog.reset();
    }
  } catch {
    // Ignore reset errors
  }
}

/**
 * Track user UI interactions (template selections, mode toggles, errors).
 */
export function trackUiEvent(event, properties = {}) {
  try {
    if (posthog && typeof posthog.capture === 'function') {
      posthog.capture(event, properties);
    }
  } catch {
    // Ignore capture errors
  }
}

export { posthog };
