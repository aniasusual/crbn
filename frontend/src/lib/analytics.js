import posthog from 'posthog-js';

const POSTHOG_KEY = import.meta.env.VITE_POSTHOG_KEY || 'REDACTED_SECRET';
const POSTHOG_HOST = import.meta.env.VITE_POSTHOG_HOST || 'https://us.i.posthog.com';

function getOrCreateDeviceId() {
  try {
    // 1. Electron bridge priority (matches backend exactly from ~/.80degrees/device_id)
    if (typeof window !== 'undefined' && window.__80DEGREES_CONFIG__?.deviceId) {
      const bridgeId = window.__80DEGREES_CONFIG__.deviceId;
      localStorage.setItem('80degrees_device_id', bridgeId);
      return bridgeId;
    }
    // 2. Cached local storage
    const existing = localStorage.getItem('80degrees_device_id');
    if (existing) return existing;
    // 3. Browser fallback
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
      session_recording: {
        recordCrossOriginIframes: true,
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

/**
 * Capture exceptions and unhandled errors into PostHog Error Tracking.
 */
export function captureException(error, context = {}) {
  try {
    if (posthog && typeof posthog.captureException === 'function') {
      posthog.captureException(error, context);
    }
  } catch {
    // Ignore capture errors
  }
}

/**
 * Check if a PostHog remote feature flag is enabled.
 */
export function isFeatureEnabled(flagKey) {
  try {
    return Boolean(posthog?.isFeatureEnabled(flagKey));
  } catch {
    return false;
  }
}

/**
 * Retrieve remote JSON configuration payload associated with a feature flag.
 */
export function getFeatureFlagPayload(flagKey) {
  try {
    return posthog?.getFeatureFlagPayload(flagKey) ?? null;
  } catch {
    return null;
  }
}

/**
 * Subscribe to feature flag re-evaluations from PostHog.
 */
export function onFeatureFlags(callback) {
  try {
    if (posthog && typeof posthog.onFeatureFlags === 'function') {
      return posthog.onFeatureFlags(callback);
    }
  } catch {
    // Ignore flag subscription error
  }
}

// Register global window error and unhandled rejection listeners for automated error tracking
if (typeof window !== 'undefined') {
  window.addEventListener('error', (event) => {
    if (event.error) {
      captureException(event.error, { source: 'window.onerror' });
    }
  });

  window.addEventListener('unhandledrejection', (event) => {
    const reason = event.reason;
    captureException(reason instanceof Error ? reason : new Error(String(reason)), {
      source: 'unhandledrejection',
    });
  });
}

export { posthog };
