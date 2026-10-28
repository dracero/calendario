import crypto from 'node:crypto';
import {
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
  generateIcsFeed,
  GOOGLE_AUTH_ENDPOINT,
  GOOGLE_TOKEN_ENDPOINT,
  GOOGLE_USERINFO_ENDPOINT
} from '../../lib/server-utils.js';

function jsonResponse(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
      ...headers
    }
  });
}

function redirectResponse(location, headers = {}) {
  return new Response(null, {
    status: 302,
    headers: {
      Location: location,
      ...headers
    }
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
    return jsonResponse({
      authenticated: !!user,
      user: user || null,
      googleConfigured: configured,
      googleClientId: configured ? process.env.GOOGLE_CLIENT_ID : null
    });
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

    const clientId = process.env.GOOGLE_CLIENT_ID;
    const redirectUri = getRedirectUri(request);
    const scopes = process.env.GOOGLE_SCOPES || 'openid email profile https://www.googleapis.com/auth/calendar.events';
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
      const clientId = process.env.GOOGLE_CLIENT_ID;
      const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
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
        expiresAt: new Date(Date.now() + (tokenData.expires_in || 3600) * 1000).toISOString()
      });

      if (user.hasCalendarScope) {
        const syncConfig = loadSyncConfig();
        syncConfig.connected = true;
        syncConfig.calendarName = `${user.name} (${user.email})`;
        syncConfig.lastSync = new Date().toISOString();
        saveSyncConfig(syncConfig);
      }

      const isHttps = url.protocol === 'https:';
      return redirectResponse('/?login=success#meeting_types', {
        'Set-Cookie': `reuniones_session=${sessionToken}; Path=/; HttpOnly; SameSite=Lax; Max-Age=2592000${isHttps ? '; Secure' : ''}`
      });
    } catch (err) {
      console.error('Fatal Google callback error:', err);
      return redirectResponse(`/#login?error=server_error&details=${encodeURIComponent(err.message)}`);
    }
  }

  // --- Auth: Demo Google Login ---
  if (pathname === '/api/auth/demo-login' && method === 'POST') {
    const body = await readRequestBody(request);
    const demoName = body.name || 'Alex Calendly';
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

    const syncConfig = loadSyncConfig();
    syncConfig.connected = true;
    syncConfig.calendarName = `${user.name} (Google Calendar Demo)`;
    syncConfig.lastSync = new Date().toISOString();
    syncConfig.isDemo = true;
    if (!syncConfig.events || syncConfig.events.length === 0) {
      syncConfig.events = generateDemoEvents();
    }
    saveSyncConfig(syncConfig);

    const isHttps = url.protocol === 'https:';
    return jsonResponse({
      success: true,
      message: 'Sesión iniciada con éxito (Cuenta Google Demo)',
      user
    }, 200, {
      'Set-Cookie': `reuniones_session=${sessionToken}; Path=/; HttpOnly; SameSite=Lax; Max-Age=2592000${isHttps ? '; Secure' : ''}`
    });
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
      return jsonResponse({ success: true, user }, 200, {
        'Set-Cookie': `reuniones_session=${sessionToken}; Path=/; HttpOnly; SameSite=Lax; Max-Age=2592000${isHttps ? '; Secure' : ''}`
      });
    } catch {
      return jsonResponse({ success: false, error: 'Token Google inválido' }, 400);
    }
  }

  // --- Auth: Logout ---
  if (pathname === '/api/auth/logout' && method === 'POST') {
    return jsonResponse({ success: true, message: 'Sesión cerrada correctamente' }, 200, {
      'Set-Cookie': 'reuniones_session=; Path=/; HttpOnly; Max-Age=0'
    });
  }

  // --- Calendar: Status ---
  if (pathname === '/api/calendar/status' && method === 'GET') {
    const config = loadSyncConfig();
    return jsonResponse({
      success: true,
      connected: config.connected,
      calendarName: config.calendarName,
      lastSync: config.lastSync,
      autoBlock: config.autoBlock !== false,
      eventCount: (config.events || []).length,
      events: (config.events || []).slice(0, 100),
      isDemo: !!config.isDemo
    });
  }

  // --- Calendar: Connect ---
  if (pathname === '/api/calendar/connect' && method === 'POST') {
    const body = await readRequestBody(request);
    const { icalUrl, autoBlock, isDemo } = body;

    if (isDemo) {
      const demoEvents = generateDemoEvents();
      const config = {
        connected: true,
        calendarName: 'Google Calendar (Demo Sincronizado)',
        lastSync: new Date().toISOString(),
        autoBlock: autoBlock !== false,
        icalUrl: 'demo://calendar.google.com/calendar/u/0/r',
        isDemo: true,
        events: demoEvents
      };
      saveSyncConfig(config);
      return jsonResponse({
        success: true,
        message: 'Google Calendar sincronizado en modo demostración',
        calendarName: config.calendarName,
        count: demoEvents.length,
        events: demoEvents
      });
    }

    if (!icalUrl || typeof icalUrl !== 'string') {
      return jsonResponse({ success: false, error: 'Debes proporcionar una URL iCal válida.' }, 400);
    }

    let fetchUrl = icalUrl.trim();
    if (fetchUrl.startsWith('webcal://')) fetchUrl = 'https://' + fetchUrl.substring(9);

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
        lastSync: new Date().toISOString(),
        autoBlock: autoBlock !== false,
        icalUrl: fetchUrl,
        isDemo: false,
        events: events
      };
      saveSyncConfig(config);
      return jsonResponse({ success: true, count: events.length, events: events.slice(0, 100) });
    } catch (err) {
      return jsonResponse({ success: false, error: `Error: ${err.message}` }, 422);
    }
  }

  // --- Calendar: Sync Now ---
  if (pathname === '/api/calendar/sync-now' && method === 'POST') {
    const config = loadSyncConfig();
    if (!config.connected) {
      return jsonResponse({ success: false, error: 'No hay un calendario conectado actualmente.' }, 400);
    }

    if (config.isDemo) {
      config.lastSync = new Date().toISOString();
      config.events = generateDemoEvents();
      saveSyncConfig(config);
      return jsonResponse({ success: true, count: config.events.length, events: config.events });
    }

    try {
      const response = await fetch(config.icalUrl, {
        headers: { 'User-Agent': 'Reuniones-Calendar-Sync/1.0' }
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const icalContent = await response.text();
      const { calendarName, events } = parseIcal(icalContent);
      config.calendarName = calendarName || config.calendarName;
      config.lastSync = new Date().toISOString();
      config.events = events;
      saveSyncConfig(config);
      return jsonResponse({ success: true, count: events.length, events: events.slice(0, 100) });
    } catch (err) {
      return jsonResponse({ success: false, error: `Error: ${err.message}` }, 500);
    }
  }

  // --- Calendar: Disconnect ---
  if (pathname === '/api/calendar/disconnect' && method === 'POST') {
    const config = {
      connected: false,
      calendarName: null,
      lastSync: null,
      autoBlock: true,
      icalUrl: '',
      isDemo: false,
      events: []
    };
    saveSyncConfig(config);
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
