import crypto from 'node:crypto';
import {
  getEnv,
  getSessionData,
  getSessionUser,
  isGoogleConfigured,
  getAppBaseUrl,
  getRedirectUri,
  signSession,
  loadSyncConfig,
  saveSyncConfig,
  loadMeetings,
  saveMeetings,
  parseIcal,
  generateDemoEvents,
  fetchGoogleCalendarApiEvents,
  generateIcsFeed,
  GOOGLE_AUTH_ENDPOINT,
  GOOGLE_TOKEN_ENDPOINT,
  GOOGLE_USERINFO_ENDPOINT
} from '../../lib/server-utils.js';

const NO_CACHE_HEADERS = {
  'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate, private, max-age=0, s-maxage=0',
  'Pragma': 'no-cache',
  'Expires': '0',
  'Vary': 'Cookie'
};

function buildAuthCookies(sessionToken, isHttps) {
  const secureFlag = isHttps ? '; Secure' : '';
  if (sessionToken) {
    return [
      `reuniones_session=${sessionToken}; Path=/; HttpOnly; SameSite=Lax; Max-Age=2592000${secureFlag}`,
      `CALENDLY_AUTHENTICATED_USER_STATUS=true; Path=/; SameSite=Lax; Max-Age=2592000${secureFlag}`
    ];
  }
  return [
    `reuniones_session=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secureFlag}`,
    `CALENDLY_AUTHENTICATED_USER_STATUS=false; Path=/; SameSite=Lax; Max-Age=2592000${secureFlag}`
  ];
}

function createHeaders(baseHeaders = {}, cookies = []) {
  const h = new Headers({
    ...NO_CACHE_HEADERS,
    ...baseHeaders
  });
  for (const cookie of cookies) {
    h.append('Set-Cookie', cookie);
  }
  return h;
}

function jsonResponse(data, status = 200, headers = {}, cookies = []) {
  const h = createHeaders({
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    ...headers
  }, cookies);
  return new Response(JSON.stringify(data), {
    status,
    headers: h
  });
}

function redirectResponse(location, headers = {}, cookies = []) {
  const h = createHeaders({
    Location: location,
    ...headers
  }, cookies);
  return new Response(null, {
    status: 302,
    headers: h
  });
}

async function readRequestBody(request) {
  try {
    const text = await request.text();
    return text ? JSON.parse(text) : {};
  } catch {
    return {};
  }
}

export const ALL = async (context) => {
  const { request } = context;
  const url = new URL(request.url);
  const pathname = url.pathname;
  const method = request.method;

  // Handle CORS Preflight
  if (method === 'OPTIONS') {
    return new Response(null, {
      status: 204,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization'
      }
    });
  }

  // --- Auth: Current User ---
  if (pathname === '/api/auth/me' && method === 'GET') {
    const user = getSessionUser(request);
    const configured = isGoogleConfigured();
    const isHttps = url.protocol === 'https:';
    const statusCookie = `CALENDLY_AUTHENTICATED_USER_STATUS=${user ? 'true' : 'false'}; Path=/; SameSite=Lax; Max-Age=2592000${isHttps ? '; Secure' : ''}`;
    return jsonResponse({
      authenticated: !!user,
      user: user || null,
      googleConfigured: configured,
      googleClientId: configured ? getEnv('GOOGLE_CLIENT_ID') : null
    }, 200, {}, [statusCookie]);
  }

  // --- Auth: Initiate Google OAuth ---
  if (pathname === '/api/auth/google' && method === 'GET') {
    if (!isGoogleConfigured()) {
      const accept = request.headers.get('accept') || '';
      if (accept.includes('application/json')) {
        return jsonResponse({
          success: false,
          configured: false,
          error: 'Credenciales de Google no configuradas en variables de entorno',
          help: 'Debes configurar GOOGLE_CLIENT_ID y GOOGLE_CLIENT_SECRET en tu panel de Vercel'
        }, 400);
      }
      return redirectResponse('/#login?error=missing_credentials');
    }

    const clientId = getEnv('GOOGLE_CLIENT_ID');
    const redirectUri = getRedirectUri(request);
    const rawScopes = getEnv('GOOGLE_SCOPES') || 'openid email profile https://www.googleapis.com/auth/calendar.events';
    const scopes = rawScopes.replace(/["']/g, '').trim().split(/\s+/).join(' ');
    const state = crypto.randomBytes(16).toString('hex');
    const loginHint = (url.searchParams.get('login_hint') || '').trim();
    const hintParam = loginHint ? `&login_hint=${encodeURIComponent(loginHint)}` : '';

    const authUrl = `${GOOGLE_AUTH_ENDPOINT}?client_id=${encodeURIComponent(clientId)}&redirect_uri=${encodeURIComponent(redirectUri)}&response_type=code&scope=${encodeURIComponent(scopes)}&access_type=offline&prompt=consent%20select_account&state=${state}${hintParam}`;

    if (url.searchParams.get('format') === 'json') {
      return jsonResponse({ success: true, url: authUrl });
    }

    return redirectResponse(authUrl);
  }

  // --- Auth: Google OAuth Callback ---
  if (pathname === '/api/auth/google/callback' && method === 'GET') {
    const code = url.searchParams.get('code');
    const error = url.searchParams.get('error');

    if (error) {
      console.warn('Google OAuth returned error:', error);
      return redirectResponse(`/#login?error=${encodeURIComponent(error)}`);
    }

    if (!code) {
      return redirectResponse('/#login?error=missing_auth_code');
    }

    try {
      const clientId = getEnv('GOOGLE_CLIENT_ID');
      const clientSecret = getEnv('GOOGLE_CLIENT_SECRET');
      const redirectUri = getRedirectUri(request);

      const tokenResponse = await fetch(GOOGLE_TOKEN_ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          code,
          client_id: clientId,
          client_secret: clientSecret,
          redirect_uri: redirectUri,
          grant_type: 'authorization_code'
        }).toString()
      });

      const tokenData = await tokenResponse.json();
      if (!tokenResponse.ok || !tokenData.access_token) {
        console.error('Error exchanging Google token:', tokenData);
        const reason = tokenData.error_description || tokenData.error || 'token_exchange_failed';
        return redirectResponse(`/#login?error=${encodeURIComponent(reason)}`);
      }

      const userInfoResponse = await fetch(GOOGLE_USERINFO_ENDPOINT, {
        headers: { Authorization: `Bearer ${tokenData.access_token}` }
      });
      const profile = await userInfoResponse.json();
      const cleanEmail = (profile.email || '').toLowerCase().trim();

      const user = {
        id: cleanEmail || profile.sub,
        googleSub: profile.sub,
        name: profile.name || profile.given_name || 'Usuario Google',
        givenName: profile.given_name || '',
        familyName: profile.family_name || '',
        email: cleanEmail || profile.email,
        picture: profile.picture || null,
        locale: profile.locale || 'es',
        provider: 'google',
        hasCalendarScope: !!(tokenData.scope && tokenData.scope.includes('calendar')),
        loggedInAt: new Date().toISOString()
      };

      const sessionToken = signSession({
        user,
        accessToken: tokenData.access_token,
        refreshToken: tokenData.refresh_token || null,
        tokenExpiresAt: new Date(Date.now() + (tokenData.expires_in || 3600) * 1000).toISOString(),
        expiresAt: new Date(Date.now() + 86400000 * 30).toISOString()
      });

      // Only refresh calendar events if THIS specific user had ALREADY connected their calendar
      const syncConfig = loadSyncConfig(user);
      syncConfig.hostPublicName = user.name;
      if (syncConfig.connected && syncConfig.syncMode === 'google_oauth' && tokenData.access_token) {
        const apiResult = await fetchGoogleCalendarApiEvents(tokenData.access_token, tokenData.refreshToken);
        if (apiResult.ok) {
          syncConfig.events = apiResult.events;
          syncConfig.lastSync = new Date().toISOString();
        }
        saveSyncConfig(syncConfig, user);
      }

      const isHttps = url.protocol === 'https:';
      return redirectResponse('/?login=success#meeting_types', {}, buildAuthCookies(sessionToken, isHttps));
    } catch (err) {
      console.error('Fatal Google callback error:', err);
      return redirectResponse(`/#login?error=server_error&details=${encodeURIComponent(err.message)}`);
    }
  }

  // --- Auth: Email Registration / Login (Unique Per User) ---
  if ((pathname === '/api/auth/email-login' || pathname === '/api/auth/register') && method === 'POST') {
    const body = await readRequestBody(request);
    const rawEmail = String(body.email || '').toLowerCase().trim();
    if (!rawEmail || !rawEmail.includes('@')) {
      return jsonResponse({ success: false, error: 'Ingresa un correo electrónico válido.' }, 400);
    }

    const emailPrefix = rawEmail.split('@')[0].replace(/[._-]+/g, ' ');
    const defaultDerivedName = emailPrefix
      .split(' ')
      .filter(Boolean)
      .map(w => w.charAt(0).toUpperCase() + w.slice(1))
      .join(' ') || 'Usuario';

    const rawName = String(body.name || '').replace(/calendly/gi, 'Reuniones').trim() || defaultDerivedName;

    const user = {
      id: rawEmail,
      name: rawName,
      givenName: rawName.split(' ')[0] || rawName,
      familyName: rawName.split(' ').slice(1).join(' ') || '',
      email: rawEmail,
      picture: null,
      locale: 'es',
      provider: 'email',
      isDemo: false,
      hasCalendarScope: false,
      loggedInAt: new Date().toISOString()
    };

    const sessionToken = signSession({
      user,
      accessToken: null,
      expiresAt: new Date(Date.now() + 86400000 * 30).toISOString()
    });

    const isHttps = url.protocol === 'https:';
    return jsonResponse({
      success: true,
      message: `Sesión iniciada como ${user.name} (${user.email})`,
      user
    }, 200, {}, buildAuthCookies(sessionToken, isHttps));
  }

  // --- Auth: Demo Google Login ---
  if (pathname === '/api/auth/demo-login' && method === 'POST') {
    const body = await readRequestBody(request);
    const rawDemoName = body.name || 'Alex Reuniones';
    const demoName = String(rawDemoName).replace(/calendly/gi, 'Reuniones').trim() || 'Alex Reuniones';
    const demoEmail = String(body.email || 'alex.usuario@gmail.com').toLowerCase().trim();

    const user = {
      id: demoEmail,
      name: demoName,
      givenName: demoName.split(' ')[0],
      familyName: demoName.split(' ').slice(1).join(' '),
      email: demoEmail,
      picture: 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=150&auto=format&fit=crop&q=80',
      locale: 'es',
      provider: 'google',
      isDemo: true,
      hasCalendarScope: true,
      loggedInAt: new Date().toISOString()
    };

    const sessionToken = signSession({
      user,
      accessToken: 'demo_token_' + Date.now(),
      expiresAt: new Date(Date.now() + 86400000 * 30).toISOString()
    });

    const isHttps = url.protocol === 'https:';
    return jsonResponse({
      success: true,
      message: 'Sesión iniciada con éxito (Cuenta Demo)',
      user
    }, 200, {}, buildAuthCookies(sessionToken, isHttps));
  }

  // --- Auth: One Tap ---
  if (pathname === '/api/auth/google/one-tap' && method === 'POST') {
    const body = await readRequestBody(request);
    const credential = body.credential;
    if (!credential) {
      return jsonResponse({ success: false, error: 'Credencial no proporcionada' }, 400);
    }

    try {
      const parts = credential.split('.');
      if (parts.length < 2) throw new Error('Formato JWT inválido');
      const payloadBase64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
      const payload = JSON.parse(Buffer.from(payloadBase64, 'base64').toString('utf-8'));
      const cleanEmail = (payload.email || '').toLowerCase().trim();

      const user = {
        id: cleanEmail || payload.sub,
        name: payload.name || 'Usuario Google',
        givenName: payload.given_name || '',
        familyName: payload.family_name || '',
        email: cleanEmail || payload.email,
        picture: payload.picture || null,
        locale: payload.locale || 'es',
        provider: 'google',
        hasCalendarScope: true,
        loggedInAt: new Date().toISOString()
      };

      const sessionToken = signSession({
        user,
        expiresAt: new Date(Date.now() + 86400000 * 30).toISOString()
      });

      const isHttps = url.protocol === 'https:';
      return jsonResponse({ success: true, user }, 200, {}, buildAuthCookies(sessionToken, isHttps));
    } catch {
      return jsonResponse({ success: false, error: 'Token Google inválido' }, 400);
    }
  }

  // --- Auth: Logout ---
  if (pathname === '/api/auth/logout' && method === 'POST') {
    const isHttps = url.protocol === 'https:';
    return jsonResponse({ success: true, message: 'Sesión cerrada correctamente' }, 200, {}, buildAuthCookies(null, isHttps));
  }

  // --- Calendar: Status ---
  if (pathname === '/api/calendar/status' && method === 'GET') {
    const sessionData = getSessionData(request);
    const user = sessionData?.user || null;
    const requestedSlug = (url.searchParams.get('slug') || '').trim();
    const config = loadSyncConfig(user, requestedSlug || null);

    // If unauthenticated browser, never expose another user's private calendarName/email
    if (!user) {
      const publicBusyEvents = config.connected
        ? (config.events || []).slice(0, 100).map(ev => ({
            start: ev.start,
            end: ev.end,
            status: ev.status || 'CONFIRMED'
          }))
        : [];
      const cleanHostName = config.hostPublicName
        ? String(config.hostPublicName).replace(/calendly/gi, 'Reuniones').trim()
        : null;
      return jsonResponse({
        success: true,
        connected: !!config.connected,
        calendarName: null,
        hostPublicName: cleanHostName,
        lastSync: config.lastSync || null,
        autoBlock: config.autoBlock !== false,
        eventCount: publicBusyEvents.length,
        events: publicBusyEvents,
        isDemo: false
      });
    }

    // Strictly per-user connection status: NEVER auto-connect unless THIS user explicitly connected their calendar
    const isConnected = !!config.connected;
    const calendarName = isConnected ? (config.calendarName || `${user.name} (${user.email})`) : null;
    const events = isConnected && Array.isArray(config.events) ? config.events : [];

    const cleanAuthHostName = (config.hostPublicName || user.name || '')
      .replace(/calendly/gi, 'Reuniones')
      .trim();

    return jsonResponse({
      success: true,
      userKey: user.email || user.id,
      connected: isConnected,
      syncMode: config.syncMode || (config.isDemo ? 'demo' : (config.icalUrl ? 'ical' : null)),
      calendarName,
      hostPublicName: cleanAuthHostName || user.name,
      icalUrl: isConnected ? (config.icalUrl || '') : '',
      lastSync: isConnected ? config.lastSync : null,
      autoBlock: config.autoBlock !== false,
      eventCount: events.length,
      events: events.slice(0, 100),
      isDemo: !!(isConnected && config.isDemo)
    });
  }

  // --- Calendar: Connect (Strictly Per Authenticated User) ---
  if (pathname === '/api/calendar/connect' && method === 'POST') {
    const sessionData = getSessionData(request);
    const user = sessionData?.user || null;
    if (!user) {
      return jsonResponse({ success: false, error: 'Debes iniciar sesión con tu cuenta antes de conectar un calendario.' }, 401);
    }

    const body = await readRequestBody(request);
    const { icalUrl, autoBlock, isDemo, useGoogleOAuth } = body;

    // Mode 1: Connect using the current user's Google OAuth account
    if (useGoogleOAuth) {
      if (!sessionData?.accessToken || user.provider !== 'google' || user.isDemo) {
        return jsonResponse({
          success: false,
          error: 'Para conectar por OAuth directo debes haber iniciado sesión con tu cuenta real de Google, o bien pega tu enlace iCal (.ics) abajo.'
        }, 400);
      }

      const apiResult = await fetchGoogleCalendarApiEvents(sessionData.accessToken, sessionData.refreshToken);
      let events = [];
      let warning = null;

      if (apiResult.ok) {
        events = apiResult.events;
      } else {
        warning = apiResult.error;
        if (user.email) {
          try {
            const pubUrl = `https://calendar.google.com/calendar/ical/${encodeURIComponent(user.email)}/public/basic.ics`;
            const pubRes = await fetch(pubUrl, { headers: { 'User-Agent': 'Reuniones-Calendar-Sync/1.0' } });
            if (pubRes.ok) {
              const parsed = parseIcal(await pubRes.text());
              events = parsed.events;
              warning = null;
            }
          } catch {
            // ignore
          }
        }
      }

      const config = {
        connected: true,
        syncMode: 'google_oauth',
        calendarName: `${user.name} (${user.email})`,
        hostPublicName: user.name,
        lastSync: new Date().toISOString(),
        autoBlock: autoBlock !== false,
        icalUrl: '',
        isDemo: false,
        events
      };
      saveSyncConfig(config, user);

      return jsonResponse({
        success: true,
        syncMode: 'google_oauth',
        calendarName: config.calendarName,
        icalUrl: '',
        count: events.length,
        events: events.slice(0, 100),
        warning
      });
    }

    // Mode 2: Connect Demo Calendar for this user
    if (isDemo) {
      const demoEvents = generateDemoEvents();
      const config = {
        connected: true,
        syncMode: 'demo',
        calendarName: `${user.name} (Google Calendar Demo)`,
        hostPublicName: user.name,
        lastSync: new Date().toISOString(),
        autoBlock: autoBlock !== false,
        icalUrl: 'demo://calendar.google.com/calendar/u/0/r',
        isDemo: true,
        events: demoEvents
      };
      saveSyncConfig(config, user);
      return jsonResponse({
        success: true,
        syncMode: 'demo',
        message: 'Google Calendar sincronizado en modo demostración para tu usuario',
        calendarName: config.calendarName,
        icalUrl: config.icalUrl,
        count: demoEvents.length,
        events: demoEvents
      });
    }

    // Mode 3: Connect via iCal (.ics) URL for this user
    if (!icalUrl || typeof icalUrl !== 'string') {
      return jsonResponse({ success: false, error: 'Debes proporcionar una URL iCal válida.' }, 400);
    }

    let fetchUrl = icalUrl.trim();
    if (fetchUrl.startsWith('webcal://')) fetchUrl = 'https://' + fetchUrl.substring(9);

    if (fetchUrl.includes('calendar.google.com/calendar/u/') || fetchUrl.includes('calendar.google.com/calendar/r')) {
      return jsonResponse({
        success: false,
        isBrowserUrl: true,
        error: 'Has pegado el enlace de la vista web del navegador (calendar/u/0/r). Debes copiar la "Dirección secreta en formato iCal" (termina en /basic.ics) desde Configuración de Google Calendar.'
      }, 400);
    }

    try {
      const response = await fetch(fetchUrl, {
        headers: { 'User-Agent': 'Reuniones-Calendar-Sync/1.0' }
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const icalContent = await response.text();
      const { calendarName, events } = parseIcal(icalContent);

      const config = {
        connected: true,
        syncMode: 'ical',
        calendarName: calendarName || `${user.name} (Google Calendar)`,
        hostPublicName: user.name,
        lastSync: new Date().toISOString(),
        autoBlock: autoBlock !== false,
        icalUrl: fetchUrl,
        isDemo: false,
        events: events
      };
      saveSyncConfig(config, user);
      return jsonResponse({
        success: true,
        syncMode: 'ical',
        calendarName: config.calendarName,
        icalUrl: config.icalUrl,
        count: events.length,
        events: events.slice(0, 100)
      });
    } catch (err) {
      return jsonResponse({ success: false, error: `Error al leer el feed iCal: ${err.message}` }, 422);
    }
  }

  // --- Calendar: Sync Now (Strictly Per Authenticated User) ---
  if (pathname === '/api/calendar/sync-now' && method === 'POST') {
    const sessionData = getSessionData(request);
    const user = sessionData?.user || null;
    if (!user) {
      return jsonResponse({ success: false, error: 'Debes iniciar sesión para sincronizar tu calendario.' }, 401);
    }

    const body = await readRequestBody(request);
    const config = loadSyncConfig(user);

    const effectiveIcalUrl = (body.icalUrl || config.icalUrl || '').trim();
    const isDemoMode = !!(body.isDemo || config.isDemo || effectiveIcalUrl.startsWith('demo://'));
    const isOAuthMode = !!(body.syncMode === 'google_oauth' || config.syncMode === 'google_oauth' || (config.connected && !effectiveIcalUrl && !isDemoMode && sessionData?.accessToken));
    const isConnected = !!(config.connected || effectiveIcalUrl || isDemoMode || isOAuthMode);

    if (!isConnected) {
      return jsonResponse({ success: false, error: 'Este usuario no tiene ningún calendario conectado actualmente.' }, 400);
    }

    // 1. Demo Mode Sync
    if (isDemoMode) {
      config.connected = true;
      config.syncMode = 'demo';
      config.isDemo = true;
      config.calendarName = config.calendarName || `${user.name} (Google Calendar Demo)`;
      config.hostPublicName = user.name;
      config.lastSync = new Date().toISOString();
      config.events = generateDemoEvents();
      saveSyncConfig(config, user);
      return jsonResponse({
        success: true,
        source: 'demo',
        calendarName: config.calendarName,
        count: config.events.length,
        events: config.events
      });
    }

    // 2. Explicit iCal Feed Sync
    if (effectiveIcalUrl && !effectiveIcalUrl.startsWith('demo://')) {
      let fetchUrl = effectiveIcalUrl;
      if (fetchUrl.startsWith('webcal://')) fetchUrl = 'https://' + fetchUrl.substring(9);

      try {
        const response = await fetch(fetchUrl, {
          headers: { 'User-Agent': 'Reuniones-Calendar-Sync/1.0' }
        });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const icalContent = await response.text();
        const { calendarName, events } = parseIcal(icalContent);
        config.connected = true;
        config.syncMode = 'ical';
        config.isDemo = false;
        config.icalUrl = fetchUrl;
        config.calendarName = calendarName || config.calendarName || `${user.name} (Google Calendar)`;
        config.hostPublicName = user.name;
        config.lastSync = new Date().toISOString();
        config.events = events;
        saveSyncConfig(config, user);
        return jsonResponse({
          success: true,
          source: 'ical',
          calendarName: config.calendarName,
          count: events.length,
          events: events.slice(0, 100)
        });
      } catch (err) {
        return jsonResponse({ success: false, error: `Error al sincronizar URL iCal: ${err.message}` }, 500);
      }
    }

    // 3. Google OAuth API Sync (when this user connected via Google OAuth)
    if (sessionData?.accessToken && !user.isDemo) {
      const apiResult = await fetchGoogleCalendarApiEvents(sessionData.accessToken, sessionData.refreshToken);

      const updatedCookies = [];
      if (apiResult.newAccessToken) {
        const newSessionToken = signSession({
          ...sessionData,
          accessToken: apiResult.newAccessToken,
          tokenExpiresAt: new Date(Date.now() + 3600 * 1000).toISOString()
        });
        const isHttps = url.protocol === 'https:';
        updatedCookies.push(...buildAuthCookies(newSessionToken, isHttps));
      }

      if (apiResult.ok) {
        config.connected = true;
        config.syncMode = 'google_oauth';
        config.isDemo = false;
        config.calendarName = config.calendarName || `${user.name} (${user.email})`;
        config.hostPublicName = user.name;
        config.lastSync = new Date().toISOString();
        config.events = apiResult.events;
        saveSyncConfig(config, user);

        return jsonResponse({
          success: true,
          source: 'google_oauth',
          calendarName: config.calendarName,
          count: apiResult.events.length,
          events: apiResult.events.slice(0, 100)
        }, 200, {}, updatedCookies);
      }

      // Fallback 3a: Try public iCal URL for this user's Google email
      if (user.email) {
        try {
          const publicIcalUrl = `https://calendar.google.com/calendar/ical/${encodeURIComponent(user.email)}/public/basic.ics`;
          const pubRes = await fetch(publicIcalUrl, {
            headers: { 'User-Agent': 'Reuniones-Calendar-Sync/1.0' }
          });
          if (pubRes.ok) {
            const icalContent = await pubRes.text();
            const { events } = parseIcal(icalContent);
            config.connected = true;
            config.syncMode = 'google_oauth';
            config.isDemo = false;
            config.calendarName = config.calendarName || `${user.name} (${user.email})`;
            config.hostPublicName = user.name;
            config.lastSync = new Date().toISOString();
            config.events = events;
            saveSyncConfig(config, user);

            return jsonResponse({
              success: true,
              source: 'google_public_ical',
              calendarName: config.calendarName,
              count: events.length,
              events: events.slice(0, 100)
            }, 200, {}, updatedCookies);
          }
        } catch {
          // ignore
        }
      }

      // Fallback 3b: Sync with this user's scheduled internal meetings
      const meetings = loadMeetings(user).filter(m => m.status === 'upcoming');
      const fallbackEvents = meetings.map((m, idx) => {
        const startObj = new Date(m.dateTime);
        const endObj = new Date(startObj.getTime() + (m.duration || 30) * 60000);
        return {
          id: m.id || `local-meet-${idx}`,
          summary: `${m.eventTitle || 'Reunión'} con ${m.inviteeName || 'Invitado'}`,
          start: startObj.toISOString(),
          end: endObj.toISOString(),
          location: m.location || 'Google Meet',
          status: 'CONFIRMED'
        };
      });

      config.connected = true;
      config.syncMode = 'google_oauth';
      config.calendarName = config.calendarName || `${user.name} (${user.email})`;
      config.hostPublicName = user.name;
      config.lastSync = new Date().toISOString();
      config.events = fallbackEvents;
      saveSyncConfig(config, user);

      return jsonResponse({
        success: true,
        source: 'local_fallback',
        calendarName: config.calendarName,
        count: config.events.length,
        events: config.events.slice(0, 100),
        warning: apiResult.error
      }, 200, {}, updatedCookies);
    }

    return jsonResponse({
      success: false,
      error: 'Conecta primero el calendario para este usuario.'
    }, 400);
  }

  // --- Calendar: Disconnect (Strictly Per Authenticated User) ---
  if (pathname === '/api/calendar/disconnect' && method === 'POST') {
    const user = getSessionUser(request);
    if (user) {
      const config = {
        connected: false,
        syncMode: null,
        calendarName: null,
        hostPublicName: user.name,
        lastSync: null,
        autoBlock: true,
        icalUrl: '',
        isDemo: false,
        events: []
      };
      saveSyncConfig(config, user);
    }
    return jsonResponse({ success: true, message: 'Google Calendar desconectado para tu usuario.' });
  }

  // --- Calendar: Sync Meetings (Strictly Per Authenticated User) ---
  if (pathname === '/api/calendar/sync-meetings' && method === 'POST') {
    const user = getSessionUser(request);
    const body = await readRequestBody(request);
    const meetings = Array.isArray(body.meetings) ? body.meetings : [];
    if (user) {
      saveMeetings(meetings, user);
    }
    return jsonResponse({ success: true, count: meetings.length });
  }

  // --- Calendar: Feed ICS ---
  if (pathname === '/api/calendar/feed.ics' || pathname === '/feed.ics') {
    const user = getSessionUser(request);
    const queryUser = url.searchParams.get('user') || null;
    const meetings = loadMeetings(user || queryUser);
    const icsContent = generateIcsFeed(meetings);
    return new Response(icsContent, {
      status: 200,
      headers: {
        'Content-Type': 'text/calendar; charset=utf-8',
        'Content-Disposition': 'inline; filename="reuniones.ics"',
        'Access-Control-Allow-Origin': '*',
        'Cache-Control': 'no-cache'
      }
    });
  }

  return jsonResponse({ error: 'Ruta no encontrada', path: pathname }, 404);
};
