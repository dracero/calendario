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

    const authUrl = `${GOOGLE_AUTH_ENDPOINT}?client_id=${encodeURIComponent(clientId)}&redirect_uri=${encodeURIComponent(redirectUri)}&response_type=code&scope=${encodeURIComponent(scopes)}&access_type=offline&prompt=consent%20select_account&state=${state}`;

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

      const user = {
        id: profile.sub,
        name: profile.name || profile.given_name || 'Usuario Google',
        givenName: profile.given_name || '',
        familyName: profile.family_name || '',
        email: profile.email,
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

      const syncConfig = loadSyncConfig(user.id);
      syncConfig.connected = true;
      syncConfig.isDemo = false;
      syncConfig.calendarName = `${user.name} (${user.email})`;
      syncConfig.hostPublicName = user.name;
      syncConfig.lastSync = new Date().toISOString();

      if (user.hasCalendarScope && tokenData.access_token) {
        const apiResult = await fetchGoogleCalendarApiEvents(tokenData.access_token, tokenData.refresh_token);
        if (apiResult.ok) {
          syncConfig.events = apiResult.events;
        }
      }
      saveSyncConfig(syncConfig, user.id);

      const isHttps = url.protocol === 'https:';
      return redirectResponse('/?login=success#meeting_types', {}, buildAuthCookies(sessionToken, isHttps));
    } catch (err) {
      console.error('Fatal Google callback error:', err);
      return redirectResponse(`/#login?error=server_error&details=${encodeURIComponent(err.message)}`);
    }
  }

  // --- Auth: Demo Google Login ---
  if (pathname === '/api/auth/demo-login' && method === 'POST') {
    const body = await readRequestBody(request);
    const rawDemoName = body.name || 'Alex Reuniones';
    const demoName = String(rawDemoName).replace(/calendly/gi, 'Reuniones').trim() || 'Alex Reuniones';
    const demoEmail = body.email || 'alex.usuario@gmail.com';

    const user = {
      id: 'google-demo-user-' + Date.now(),
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

    const syncConfig = loadSyncConfig(user.id);
    syncConfig.connected = true;
    syncConfig.calendarName = `${user.name} (Google Calendar Demo)`;
    syncConfig.hostPublicName = user.name;
    syncConfig.lastSync = new Date().toISOString();
    syncConfig.isDemo = true;
    if (!syncConfig.events || syncConfig.events.length === 0) {
      syncConfig.events = generateDemoEvents();
    }
    saveSyncConfig(syncConfig, user.id);

    const isHttps = url.protocol === 'https:';
    return jsonResponse({
      success: true,
      message: 'Sesión iniciada con éxito (Cuenta Google Demo)',
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

      const user = {
        id: payload.sub,
        name: payload.name || 'Usuario Google',
        givenName: payload.given_name || '',
        familyName: payload.family_name || '',
        email: payload.email,
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
    const config = loadSyncConfig(user?.id || null);

    // If unauthenticated browser, never expose another user's private calendarName/email
    if (!user) {
      const publicBusyEvents = (config.events || []).slice(0, 100).map(ev => ({
        start: ev.start,
        end: ev.end,
        status: ev.status || 'CONFIRMED'
      }));
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

    // If authenticated with Google and /tmp was reset on a serverless cold start, restore connected state
    const isConnected = config.connected !== undefined ? !!config.connected : !!(user.hasCalendarScope || user.provider === 'google');
    const calendarName = config.calendarName || (isConnected ? `${user.name} (${user.email})` : null);
    let events = Array.isArray(config.events) ? config.events : [];

    if (isConnected && events.length === 0 && sessionData?.accessToken && !user.isDemo && !config.isDemo) {
      const apiResult = await fetchGoogleCalendarApiEvents(sessionData.accessToken, sessionData.refreshToken);
      if (apiResult.ok && apiResult.events.length > 0) {
        events = apiResult.events;
        config.connected = true;
        config.calendarName = calendarName;
        config.events = events;
        config.lastSync = new Date().toISOString();
        saveSyncConfig(config, user.id);
      }
    }

    const cleanAuthHostName = (config.hostPublicName || user.name || '')
      .replace(/calendly/gi, 'Reuniones')
      .trim();

    return jsonResponse({
      success: true,
      connected: isConnected,
      calendarName,
      hostPublicName: cleanAuthHostName || user.name,
      icalUrl: config.icalUrl || '',
      lastSync: config.lastSync || new Date().toISOString(),
      autoBlock: config.autoBlock !== false,
      eventCount: events.length,
      events: events.slice(0, 100),
      isDemo: !!(config.isDemo || user.isDemo)
    });
  }

  // --- Calendar: Connect ---
  if (pathname === '/api/calendar/connect' && method === 'POST') {
    const user = getSessionUser(request);
    const body = await readRequestBody(request);
    const { icalUrl, autoBlock, isDemo } = body;

    if (isDemo) {
      const demoEvents = generateDemoEvents();
      const config = {
        connected: true,
        calendarName: 'Google Calendar (Demo Sincronizado)',
        hostPublicName: user?.name || null,
        lastSync: new Date().toISOString(),
        autoBlock: autoBlock !== false,
        icalUrl: 'demo://calendar.google.com/calendar/u/0/r',
        isDemo: true,
        events: demoEvents
      };
      saveSyncConfig(config, user?.id || null);
      return jsonResponse({
        success: true,
        message: 'Google Calendar sincronizado en modo demostración',
        calendarName: config.calendarName,
        icalUrl: config.icalUrl,
        count: demoEvents.length,
        events: demoEvents
      });
    }

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
        calendarName: calendarName || 'Google Calendar',
        hostPublicName: user?.name || null,
        lastSync: new Date().toISOString(),
        autoBlock: autoBlock !== false,
        icalUrl: fetchUrl,
        isDemo: false,
        events: events
      };
      saveSyncConfig(config, user?.id || null);
      return jsonResponse({
        success: true,
        calendarName: config.calendarName,
        icalUrl: config.icalUrl,
        count: events.length,
        events: events.slice(0, 100)
      });
    } catch (err) {
      return jsonResponse({ success: false, error: `Error al leer el feed iCal: ${err.message}` }, 422);
    }
  }

  // --- Calendar: Sync Now ---
  if (pathname === '/api/calendar/sync-now' && method === 'POST') {
    const sessionData = getSessionData(request);
    const user = sessionData?.user || null;
    const body = await readRequestBody(request);
    const config = loadSyncConfig(user?.id || null);

    const effectiveIcalUrl = (body.icalUrl || config.icalUrl || '').trim();
    const isDemoMode = !!(body.isDemo || config.isDemo || user?.isDemo || effectiveIcalUrl.startsWith('demo://'));
    const hasOAuthConnection = !!(user && (user.hasCalendarScope || user.provider === 'google' || sessionData?.accessToken));
    const isConnected = !!(config.connected || effectiveIcalUrl || isDemoMode || hasOAuthConnection);

    if (!isConnected) {
      return jsonResponse({ success: false, error: 'No hay un calendario conectado actualmente.' }, 400);
    }

    // 1. Demo Mode Sync
    if (isDemoMode) {
      config.connected = true;
      config.isDemo = true;
      config.calendarName = config.calendarName || (user ? `${user.name} (Google Calendar Demo)` : 'Google Calendar (Demo Sincronizado)');
      config.lastSync = new Date().toISOString();
      config.events = generateDemoEvents();
      saveSyncConfig(config, user?.id || null);
      return jsonResponse({
        success: true,
        source: 'demo',
        calendarName: config.calendarName,
        count: config.events.length,
        events: config.events
      });
    }

    // 2. Explicit iCal Feed Sync (if an http/https/webcal iCal URL is configured)
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
        config.isDemo = false;
        config.icalUrl = fetchUrl;
        config.calendarName = calendarName || config.calendarName || 'Google Calendar';
        config.lastSync = new Date().toISOString();
        config.events = events;
        saveSyncConfig(config, user?.id || null);
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

    // 3. Google OAuth API Sync (when logged in with Google OAuth)
    if (sessionData?.accessToken) {
      const apiResult = await fetchGoogleCalendarApiEvents(sessionData.accessToken, sessionData.refreshToken);

      // Update session cookie if token was refreshed
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
        config.isDemo = false;
        config.calendarName = config.calendarName || `${user.name} (${user.email})`;
        config.hostPublicName = config.hostPublicName || user.name;
        config.lastSync = new Date().toISOString();
        config.events = apiResult.events;
        saveSyncConfig(config, user.id);

        return jsonResponse({
          success: true,
          source: 'google_oauth',
          calendarName: config.calendarName,
          count: apiResult.events.length,
          events: apiResult.events.slice(0, 100)
        }, 200, {}, updatedCookies);
      }

      // Fallback 3a: Try public iCal URL for the user's Google email if Calendar API returned 403/404
      if (user?.email) {
        try {
          const publicIcalUrl = `https://calendar.google.com/calendar/ical/${encodeURIComponent(user.email)}/public/basic.ics`;
          const pubRes = await fetch(publicIcalUrl, {
            headers: { 'User-Agent': 'Reuniones-Calendar-Sync/1.0' }
          });
          if (pubRes.ok) {
            const icalContent = await pubRes.text();
            const { events } = parseIcal(icalContent);
            config.connected = true;
            config.isDemo = false;
            config.calendarName = config.calendarName || `${user.name} (${user.email})`;
            config.lastSync = new Date().toISOString();
            config.events = events;
            saveSyncConfig(config, user.id);

            return jsonResponse({
              success: true,
              source: 'google_public_ical',
              calendarName: config.calendarName,
              count: events.length,
              events: events.slice(0, 100)
            }, 200, {}, updatedCookies);
          }
        } catch {
          // ignore public iCal fallback error
        }
      }

      // Fallback 3b: Sync with scheduled internal meetings so sync still completes cleanly and reports helpful guidance
      const meetings = loadMeetings().filter(m => m.status === 'upcoming');
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
      config.calendarName = config.calendarName || `${user?.name || 'Usuario'} (${user?.email || 'Google Calendar'})`;
      config.lastSync = new Date().toISOString();
      if (!config.events || config.events.length === 0) {
        config.events = fallbackEvents;
      }
      saveSyncConfig(config, user?.id || null);

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
      error: 'Conecta tu enlace iCal o vuelve a iniciar sesión con Google para sincronizar eventos.'
    }, 400);
  }

  // --- Calendar: Disconnect ---
  if (pathname === '/api/calendar/disconnect' && method === 'POST') {
    const user = getSessionUser(request);
    const config = {
      connected: false,
      calendarName: null,
      lastSync: null,
      autoBlock: true,
      icalUrl: '',
      isDemo: false,
      events: []
    };
    saveSyncConfig(config, user?.id || null);
    return jsonResponse({ success: true, message: 'Google Calendar desconectado.' });
  }

  // --- Calendar: Sync Meetings ---
  if (pathname === '/api/calendar/sync-meetings' && method === 'POST') {
    const body = await readRequestBody(request);
    const meetings = Array.isArray(body.meetings) ? body.meetings : [];
    saveMeetings(meetings);
    return jsonResponse({ success: true, count: meetings.length });
  }

  // --- Calendar: Feed ICS ---
  if (pathname === '/api/calendar/feed.ics' || pathname === '/feed.ics') {
    const meetings = loadMeetings();
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
