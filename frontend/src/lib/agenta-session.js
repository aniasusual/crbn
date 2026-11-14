/**
 * Extracts the active Agenta SuperTokens session identity from the Electron
 * cookie jar / <webview> DOM so the backend provisions strictly for the user
 * currently signed into the embedded Agenta view (and never guesses via SQL LIMIT 1).
 */

function parseAccessTokenCookie(cookieString) {
  if (!cookieString || typeof cookieString !== 'string') return undefined;
  const match = cookieString
    .split(';')
    .map((part) => part.trim())
    .find((part) => part.startsWith('sAccessToken='));
  if (!match) return undefined;
  const val = decodeURIComponent(match.slice('sAccessToken='.length).trim());
  return val && val !== 'remove' ? val : undefined;
}

function parseFrontTokenCookie(cookieString) {
  if (!cookieString || typeof cookieString !== 'string') return null;
  const match = cookieString
    .split(';')
    .map((part) => part.trim())
    .find((part) => part.startsWith('sFrontToken='));

  if (!match) return null;
  const rawValue = decodeURIComponent(match.slice('sFrontToken='.length).trim());
  if (!rawValue || rawValue === 'remove') return null;

  try {
    const jsonStr = atob(rawValue);
    const parsed = JSON.parse(jsonStr);
    const uid = parsed?.uid || parsed?.up?.sub;
    const sessionHandle = parsed?.up?.sessionHandle;
    const expiresAt = typeof parsed?.ate === 'number' ? parsed.ate : null;

    if (!uid || typeof uid !== 'string') return null;
    if (expiresAt && expiresAt <= Date.now()) return null;

    return {
      uid,
      sessionHandle: typeof sessionHandle === 'string' ? sessionHandle : undefined,
      accessToken: parseAccessTokenCookie(cookieString),
      expiresAt,
    };
  } catch {
    return null;
  }
}

function buildAuthHeaders(sessionObj) {
  return {
    'X-Agenta-Auth-State': 'authenticated',
    'X-Agenta-Uid': sessionObj.uid,
    ...(sessionObj.sessionHandle ? { 'X-Agenta-Session-Handle': sessionObj.sessionHandle } : {}),
    ...(sessionObj.accessToken ? { 'X-Agenta-Access-Token': sessionObj.accessToken } : {}),
  };
}

export async function getAgentaClientSession(webviewElement = null) {
  try {
    const effectiveWebview =
      webviewElement ||
      (typeof document !== 'undefined'
        ? document.querySelector('webview.agenta-embedded-webview')
        : null);

    // 1. If a live <webview> element is present, check if it is currently on /auth
    if (effectiveWebview && typeof effectiveWebview.getURL === 'function') {
      const currentUrl = effectiveWebview.getURL() || '';
      if (currentUrl.includes('/auth')) {
        return {
          authState: 'logged-out',
          headers: { 'X-Agenta-Auth-State': 'logged-out' },
        };
      }
      // Try reading document.cookie directly from inside the <webview>
      if (typeof effectiveWebview.executeJavaScript === 'function' && currentUrl.startsWith('http')) {
        try {
          const wvCookie = await effectiveWebview.executeJavaScript('document.cookie');
          const parsedWv = parseFrontTokenCookie(wvCookie);
          if (parsedWv) {
            let accessToken = parsedWv.accessToken;
            if (!accessToken && typeof window !== 'undefined' && typeof window.crbnDesktop?.getAgentaSession === 'function') {
              try {
                const ipcSess = await window.crbnDesktop.getAgentaSession();
                if (ipcSess?.accessToken) accessToken = ipcSess.accessToken;
              } catch {}
            }
            const merged = { ...parsedWv, accessToken };
            return {
              authState: 'authenticated',
              uid: merged.uid,
              sessionHandle: merged.sessionHandle,
              accessToken: merged.accessToken,
              headers: buildAuthHeaders(merged),
            };
          }
        } catch {
          // Fall through to document.cookie / IPC if webview DOM is not ready yet
        }
      }
    }

    // 2. Check renderer document.cookie (shares localhost cookies with <webview> when on same hostname)
    if (typeof document !== 'undefined' && document.cookie) {
      const parsedDoc = parseFrontTokenCookie(document.cookie);
      if (parsedDoc) {
        let accessToken = parsedDoc.accessToken;
        if (!accessToken && typeof window !== 'undefined' && typeof window.crbnDesktop?.getAgentaSession === 'function') {
          try {
            const ipcSess = await window.crbnDesktop.getAgentaSession();
            if (ipcSess?.accessToken) accessToken = ipcSess.accessToken;
          } catch {}
        }
        const merged = { ...parsedDoc, accessToken };
        return {
          authState: 'authenticated',
          uid: merged.uid,
          sessionHandle: merged.sessionHandle,
          accessToken: merged.accessToken,
          headers: buildAuthHeaders(merged),
        };
      }
    }

    // 3. Check Electron main-process cookie jar via IPC (handles packaged builds & 127.0.0.1 vs localhost)
    if (typeof window !== 'undefined' && typeof window.crbnDesktop?.getAgentaSession === 'function') {
      try {
        const ipcSession = await window.crbnDesktop.getAgentaSession();
        if (ipcSession?.uid) {
          return {
            authState: 'authenticated',
            uid: ipcSession.uid,
            sessionHandle: ipcSession.sessionHandle,
            accessToken: ipcSession.accessToken,
            headers: buildAuthHeaders(ipcSession),
          };
        }
      } catch {}
    }
  } catch {}

  // When no <webview> is actively on /auth and no client cookie is readable in this frame,
  // do NOT claim 'logged-out'—allow the backend to use the company's persisted Agenta credentials.
  return {
    authState: 'unknown',
    headers: {},
  };
}

export async function getAgentaSessionHeaders(webviewElement = null) {
  const session = await getAgentaClientSession(webviewElement);
  return session.headers || {};
}
