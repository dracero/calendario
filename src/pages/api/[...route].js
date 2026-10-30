import crypto from 'node:crypto';
import {
  getEnv,
  getSessionData,
  getSessionUser,
  isGoogleConfigured,
  getAppBaseUrl,
  getRedirectUri,
  signSession,
  slugifyName,
  encryptHostToken,
  loadSyncConfig,
  resolvePublicHostConfig,
  saveSyncConfig,
  loadMeetings,
  saveMeetings,
  mergeMeetingsIntoEvents,
  normalizeDateTimeWithOffset,
  parseIcal,
  generateDemoEvents,
  fetchGoogleCalendarApiEvents,
  createGoogleCalendarEvent,
  deleteGoogleCalendarEvent,
  syncPendingMeetingsToGoogleCalendar,
  sendWorkflowEmail,
  sendWorkflowSms,
  getWorkflowApiStatus,
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
    const sessionData = getSessionData(request);
    const user = sessionData?.user || null;
    const configured = isGoogleConfigured();
    const isHttps = url.protocol === 'https:';
    const statusCookie = `CALENDLY_AUTHENTICATED_USER_STATUS=${user ? 'true' : 'false'}; Path=/; SameSite=Lax; Max-Age=2592000${isHttps ? '; Secure' : ''}`;

    let publicHostToken = null;
    if (user) {
      const cfg = loadSyncConfig(user);
      if (sessionData?.accessToken && !user.isDemo && !cfg.explicitlyDisconnected) {
        cfg.connected = true;
        cfg.syncMode = cfg.syncMode || 'google_oauth';
        cfg.isDemo = false;
        cfg.calendarName = cfg.calendarName || `${user.name} (${user.email})`;
        cfg.googleAccessToken = sessionData.accessToken;
        cfg.googleRefreshToken = sessionData.refreshToken || cfg.googleRefreshToken || null;
        cfg.hostPublicName = user.name;
        cfg.hostEmail = user.email;
        cfg.hostSlug = slugifyName(user.name);
        saveSyncConfig(cfg, user);
      }
      publicHostToken = encryptHostToken({
        userKey: user.email || user.id,
        name: user.name,
        email: user.email,
        slug: slugifyName(user.name),
        connected: !!cfg.connected,
        syncMode: cfg.syncMode || (sessionData?.accessToken && !user.isDemo ? 'google_oauth' : null),
        icalUrl: cfg.icalUrl || '',
        googleAccessToken: sessionData?.accessToken || cfg.googleAccessToken || null,
        googleRefreshToken: sessionData?.refreshToken || cfg.googleRefreshToken || null
      });
    }

    return jsonResponse({
      authenticated: !!user,
      user: user || null,
      publicHostToken,
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
    const scopeSet = new Set(
      rawScopes.replace(/["',;]+/g, ' ').trim().split(/\s+/).filter(Boolean)
    );
    scopeSet.add('openid');
    scopeSet.add('email');
    scopeSet.add('profile');
    scopeSet.add('https://www.googleapis.com/auth/calendar.events');
    scopeSet.add('https://www.googleapis.com/auth/calendar');
    const scopes = Array.from(scopeSet).join(' ');
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

      // Automatically connect Google Calendar on Google OAuth login (Calendly intro_flow_calendar_connection)
      const syncConfig = loadSyncConfig(user);
      syncConfig.connected = true;
      syncConfig.syncMode = 'google_oauth';
      syncConfig.isDemo = false;
      syncConfig.explicitlyDisconnected = false;
      syncConfig.calendarName = `${user.name} (${user.email})`;
      syncConfig.hostPublicName = user.name;
      syncConfig.hostEmail = user.email;
      syncConfig.hostSlug = slugifyName(user.name);
      syncConfig.googleAccessToken = tokenData.access_token;
      if (tokenData.refresh_token) {
        syncConfig.googleRefreshToken = tokenData.refresh_token;
      }
      if (tokenData.access_token) {
        const apiResult = await fetchGoogleCalendarApiEvents(tokenData.access_token, tokenData.refresh_token);
        if (apiResult.ok) {
          syncConfig.events = apiResult.events;
          syncConfig.lastSync = new Date().toISOString();
          if (Array.isArray(apiResult.reunionesMeetings) && apiResult.reunionesMeetings.length > 0) {
            saveMeetings(apiResult.reunionesMeetings, user, syncConfig.hostSlug);
          }
        }
      }
      saveSyncConfig(syncConfig, user);

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

    const syncConfig = loadSyncConfig(user);
    syncConfig.hostPublicName = user.name;
    syncConfig.hostEmail = user.email;
    syncConfig.hostSlug = slugifyName(user.name);
    saveSyncConfig(syncConfig, user);

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

    const syncConfig = loadSyncConfig(user);
    syncConfig.hostPublicName = user.name;
    syncConfig.hostEmail = user.email;
    syncConfig.hostSlug = slugifyName(user.name);
    saveSyncConfig(syncConfig, user);

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
    const isPublicLookup = url.searchParams.get('public') === '1';
    const requestedSlug = (url.searchParams.get('slug') || '').trim();
    const requestedHostToken = (url.searchParams.get('ht') || '').trim();

    // Public Page Lookup: Resolve the PUBLIC HOST's calendar and busy slots (even if visitor is logged in as someone else!)
    if (isPublicLookup || requestedSlug || requestedHostToken || !user) {
      const { userKey: hostUserKey, config } = resolvePublicHostConfig(requestedSlug || null, requestedHostToken || null);
      const effectiveSlug = config.hostSlug || requestedSlug || null;

      // If on a cold instance with host's Google OAuth token in ht, fetch live Google Calendar busy slots
      if (
        config.googleAccessToken &&
        !String(config.googleAccessToken).startsWith('demo_token_') &&
        (!Array.isArray(config.events) || config.events.length === 0)
      ) {
        const pubApiRes = await fetchGoogleCalendarApiEvents(config.googleAccessToken, config.googleRefreshToken);
        if (pubApiRes.ok) {
          config.connected = true;
          config.events = pubApiRes.events;
          config.lastSync = new Date().toISOString();
          if (pubApiRes.newAccessToken) {
            config.googleAccessToken = pubApiRes.newAccessToken;
          }
          if (Array.isArray(pubApiRes.reunionesMeetings) && pubApiRes.reunionesMeetings.length > 0) {
            saveMeetings(pubApiRes.reunionesMeetings, hostUserKey, effectiveSlug);
          }
          saveSyncConfig(config, hostUserKey, effectiveSlug);
        }
      }

      const hostMeetings = loadMeetings(hostUserKey, effectiveSlug);
      const mergedHostEvents = mergeMeetingsIntoEvents(config.events || [], hostMeetings);

      const publicBusyEvents = (config.connected || mergedHostEvents.length > 0)
        ? mergedHostEvents.slice(0, 100).map(ev => ({
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
        isPublicHost: true,
        connected: !!(config.connected || hostMeetings.length > 0),
        calendarName: null,
        hostPublicName: cleanHostName,
        hostSlug: config.hostSlug || (cleanHostName ? slugifyName(cleanHostName) : requestedSlug || null),
        lastSync: config.lastSync || null,
        autoBlock: config.autoBlock !== false,
        eventCount: publicBusyEvents.length,
        events: publicBusyEvents,
        scheduledMeetings: hostMeetings,
        isDemo: false
      });
    }

    // Authenticated Admin Dashboard Lookup: Strictly THIS user's own config
    const config = loadSyncConfig(user);
    const updatedCookies = [];
    const cleanAuthHostName = (config.hostPublicName || user.name || '')
      .replace(/calendly/gi, 'Reuniones')
      .trim();
    const authHostSlug = config.hostSlug || slugifyName(cleanAuthHostName || user.name);

    // Auto-connect Google Calendar for Google OAuth users (Calendly intro_flow_calendar_connection)
    if (sessionData?.accessToken && !user.isDemo && !config.explicitlyDisconnected) {
      config.connected = true;
      config.syncMode = config.syncMode || 'google_oauth';
      config.isDemo = false;
      config.calendarName = config.calendarName || `${user.name} (${user.email})`;
      config.googleAccessToken = sessionData.accessToken;
      config.googleRefreshToken = sessionData.refreshToken || config.googleRefreshToken || null;
      config.hostPublicName = cleanAuthHostName || user.name;
      config.hostEmail = user.email;
      config.hostSlug = authHostSlug;
    }

    let userMeetings = loadMeetings(user, authHostSlug);

    // Refresh live events from Google Calendar API so events booked on any serverless instance appear immediately
    const effectiveAccessToken = sessionData?.accessToken || config.googleAccessToken || null;
    const effectiveRefreshToken = sessionData?.refreshToken || config.googleRefreshToken || null;
    if (
      config.connected &&
      config.syncMode === 'google_oauth' &&
      effectiveAccessToken &&
      !String(effectiveAccessToken).startsWith('demo_token_')
    ) {
      const apiResult = await fetchGoogleCalendarApiEvents(effectiveAccessToken, effectiveRefreshToken);
      if (apiResult.newAccessToken) {
        config.googleAccessToken = apiResult.newAccessToken;
        if (sessionData) {
          const newSessionToken = signSession({
            ...sessionData,
            accessToken: apiResult.newAccessToken,
            tokenExpiresAt: new Date(Date.now() + 3600 * 1000).toISOString()
          });
          updatedCookies.push(...buildAuthCookies(newSessionToken, url.protocol === 'https:'));
        }
      }
      if (apiResult.ok) {
        config.events = apiResult.events;
        config.lastSync = new Date().toISOString();
        if (Array.isArray(apiResult.reunionesMeetings) && apiResult.reunionesMeetings.length > 0) {
          saveMeetings(apiResult.reunionesMeetings, user, authHostSlug);
          userMeetings = loadMeetings(user, authHostSlug);
        }
      }
      const pendingSync = await syncPendingMeetingsToGoogleCalendar(
        config.googleAccessToken || effectiveAccessToken,
        effectiveRefreshToken,
        userMeetings,
        config.events || [],
        user
      );
      if (pendingSync.updated) {
        saveMeetings(pendingSync.meetings, user, authHostSlug);
        userMeetings = loadMeetings(user, authHostSlug);
      }
      saveSyncConfig(config, user, authHostSlug);
    }

    const isConnected = !!(config.connected || userMeetings.some(m => m && m.id && !['meet-1', 'meet-2', 'meet-3'].includes(m.id)));
    const calendarName = isConnected ? (config.calendarName || `${user.name} (${user.email})`) : null;
    const baseEvents = isConnected && Array.isArray(config.events) ? config.events : [];
    const events = isConnected ? mergeMeetingsIntoEvents(baseEvents, userMeetings) : [];

    const publicHostToken = encryptHostToken({
      userKey: user.email || user.id,
      name: cleanAuthHostName || user.name,
      email: user.email,
      slug: authHostSlug,
      connected: isConnected,
      syncMode: config.syncMode || null,
      icalUrl: config.icalUrl || '',
      googleAccessToken: config.googleAccessToken || effectiveAccessToken || null,
      googleRefreshToken: effectiveRefreshToken || null
    });

    return jsonResponse({
      success: true,
      userKey: user.email || user.id,
      publicHostToken,
      connected: isConnected,
      syncMode: config.syncMode || (config.isDemo ? 'demo' : (config.icalUrl ? 'ical' : null)),
      calendarName,
      hostPublicName: cleanAuthHostName || user.name,
      icalUrl: isConnected ? (config.icalUrl || '') : '',
      lastSync: isConnected ? config.lastSync : null,
      autoBlock: config.autoBlock !== false,
      eventCount: events.length,
      events: events.slice(0, 100),
      scheduledMeetings: userMeetings,
      isDemo: !!(isConnected && config.isDemo)
    }, 200, {}, updatedCookies);
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
      const userSlug = slugifyName(user.name);

      if (apiResult.ok) {
        events = apiResult.events;
        if (Array.isArray(apiResult.reunionesMeetings) && apiResult.reunionesMeetings.length > 0) {
          saveMeetings(apiResult.reunionesMeetings, user, userSlug);
        }
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

      const userMeetings = loadMeetings(user, userSlug);
      const mergedEvents = mergeMeetingsIntoEvents(events, userMeetings);

      const config = {
        connected: true,
        explicitlyDisconnected: false,
        syncMode: 'google_oauth',
        calendarName: `${user.name} (${user.email})`,
        hostPublicName: user.name,
        hostEmail: user.email,
        hostSlug: userSlug,
        googleAccessToken: apiResult.newAccessToken || sessionData.accessToken,
        googleRefreshToken: sessionData.refreshToken || null,
        lastSync: new Date().toISOString(),
        autoBlock: autoBlock !== false,
        icalUrl: '',
        isDemo: false,
        events: mergedEvents
      };
      saveSyncConfig(config, user, userSlug);

      const publicHostToken = encryptHostToken({
        userKey: user.email || user.id,
        name: user.name,
        email: user.email,
        slug: userSlug,
        connected: true,
        syncMode: 'google_oauth',
        icalUrl: '',
        googleAccessToken: config.googleAccessToken,
        googleRefreshToken: config.googleRefreshToken
      });

      return jsonResponse({
        success: true,
        syncMode: 'google_oauth',
        publicHostToken,
        calendarName: config.calendarName,
        icalUrl: '',
        count: mergedEvents.length,
        events: mergedEvents.slice(0, 100),
        scheduledMeetings: userMeetings,
        warning
      });
    }

    // Mode 2: Connect Demo Calendar for this user
    if (isDemo) {
      const userSlug = slugifyName(user.name);
      const userMeetings = loadMeetings(user, userSlug);
      const demoEvents = mergeMeetingsIntoEvents(generateDemoEvents(), userMeetings);
      const config = {
        connected: true,
        explicitlyDisconnected: false,
        syncMode: 'demo',
        calendarName: `${user.name} (Google Calendar Demo)`,
        hostPublicName: user.name,
        hostEmail: user.email,
        hostSlug: userSlug,
        lastSync: new Date().toISOString(),
        autoBlock: autoBlock !== false,
        icalUrl: 'demo://calendar.google.com/calendar/u/0/r',
        isDemo: true,
        events: demoEvents
      };
      saveSyncConfig(config, user, userSlug);
      const publicHostToken = encryptHostToken({
        userKey: user.email || user.id,
        name: user.name,
        email: user.email,
        slug: userSlug,
        connected: true,
        syncMode: 'demo',
        icalUrl: config.icalUrl,
        googleAccessToken: null,
        googleRefreshToken: null
      });
      return jsonResponse({
        success: true,
        syncMode: 'demo',
        publicHostToken,
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
      const userSlug = slugifyName(user.name);
      const userMeetings = loadMeetings(user, userSlug);
      const mergedEvents = mergeMeetingsIntoEvents(events, userMeetings);

      const config = {
        connected: true,
        explicitlyDisconnected: false,
        syncMode: 'ical',
        calendarName: calendarName || `${user.name} (Google Calendar)`,
        hostPublicName: user.name,
        hostEmail: user.email,
        hostSlug: userSlug,
        lastSync: new Date().toISOString(),
        autoBlock: autoBlock !== false,
        icalUrl: fetchUrl,
        isDemo: false,
        events: mergedEvents
      };
      saveSyncConfig(config, user, userSlug);
      const publicHostToken = encryptHostToken({
        userKey: user.email || user.id,
        name: user.name,
        email: user.email,
        slug: userSlug,
        connected: true,
        syncMode: 'ical',
        icalUrl: fetchUrl,
        googleAccessToken: sessionData?.accessToken || config.googleAccessToken || null,
        googleRefreshToken: sessionData?.refreshToken || config.googleRefreshToken || null
      });
      return jsonResponse({
        success: true,
        syncMode: 'ical',
        publicHostToken,
        calendarName: config.calendarName,
        icalUrl: config.icalUrl,
        count: mergedEvents.length,
        events: mergedEvents.slice(0, 100)
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
    const isOAuthMode = !!(body.syncMode === 'google_oauth' || config.syncMode === 'google_oauth' || (!effectiveIcalUrl && !isDemoMode && (sessionData?.accessToken || config.googleAccessToken)));
    const isConnected = !!(config.connected || effectiveIcalUrl || isDemoMode || isOAuthMode);

    if (!isConnected) {
      return jsonResponse({ success: false, error: 'Este usuario no tiene ningún calendario conectado actualmente.' }, 400);
    }

    const userSlug = config.hostSlug || slugifyName(user.name);
    let userMeetings = loadMeetings(user, userSlug);

    // 1. Demo Mode Sync
    if (isDemoMode) {
      config.connected = true;
      config.syncMode = 'demo';
      config.isDemo = true;
      config.calendarName = config.calendarName || `${user.name} (Google Calendar Demo)`;
      config.hostPublicName = user.name;
      config.lastSync = new Date().toISOString();
      config.events = mergeMeetingsIntoEvents(generateDemoEvents(), userMeetings);
      saveSyncConfig(config, user, userSlug);
      return jsonResponse({
        success: true,
        source: 'demo',
        calendarName: config.calendarName,
        count: config.events.length,
        events: config.events,
        scheduledMeetings: userMeetings
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
        const mergedEvents = mergeMeetingsIntoEvents(events, userMeetings);
        config.connected = true;
        config.syncMode = 'ical';
        config.isDemo = false;
        config.icalUrl = fetchUrl;
        config.calendarName = calendarName || config.calendarName || `${user.name} (Google Calendar)`;
        config.hostPublicName = user.name;
        config.lastSync = new Date().toISOString();
        config.events = mergedEvents;
        saveSyncConfig(config, user, userSlug);
        return jsonResponse({
          success: true,
          source: 'ical',
          calendarName: config.calendarName,
          count: mergedEvents.length,
          events: mergedEvents.slice(0, 100),
          scheduledMeetings: userMeetings
        });
      } catch (err) {
        return jsonResponse({ success: false, error: `Error al sincronizar URL iCal: ${err.message}` }, 500);
      }
    }

    // 3. Google OAuth API Sync (when this user connected via Google OAuth)
    const activeAccessToken = sessionData?.accessToken || config.googleAccessToken || null;
    const activeRefreshToken = sessionData?.refreshToken || config.googleRefreshToken || null;
    if (activeAccessToken && !user.isDemo) {
      // First push any pending local meetings into Google Calendar
      const pendingSync = await syncPendingMeetingsToGoogleCalendar(
        activeAccessToken,
        activeRefreshToken,
        userMeetings,
        config.events || [],
        user
      );
      if (pendingSync.updated) {
        saveMeetings(pendingSync.meetings, user, userSlug);
        userMeetings = loadMeetings(user, userSlug);
      }

      const apiResult = await fetchGoogleCalendarApiEvents(
        pendingSync.newAccessToken || activeAccessToken,
        activeRefreshToken
      );

      const updatedCookies = [];
      const refreshedToken = apiResult.newAccessToken || pendingSync.newAccessToken;
      if (refreshedToken) {
        config.googleAccessToken = refreshedToken;
        if (sessionData) {
          const newSessionToken = signSession({
            ...sessionData,
            accessToken: refreshedToken,
            tokenExpiresAt: new Date(Date.now() + 3600 * 1000).toISOString()
          });
          const isHttps = url.protocol === 'https:';
          updatedCookies.push(...buildAuthCookies(newSessionToken, isHttps));
        }
      }

      if (apiResult.ok) {
        if (Array.isArray(apiResult.reunionesMeetings) && apiResult.reunionesMeetings.length > 0) {
          saveMeetings(apiResult.reunionesMeetings, user, userSlug);
          userMeetings = loadMeetings(user, userSlug);
        }
        const mergedEvents = mergeMeetingsIntoEvents(apiResult.events, userMeetings);
        config.connected = true;
        config.explicitlyDisconnected = false;
        config.syncMode = 'google_oauth';
        config.isDemo = false;
        config.calendarName = config.calendarName || `${user.name} (${user.email})`;
        config.hostPublicName = user.name;
        config.lastSync = new Date().toISOString();
        config.events = mergedEvents;
        saveSyncConfig(config, user, userSlug);

        return jsonResponse({
          success: true,
          source: 'google_oauth',
          calendarName: config.calendarName,
          count: mergedEvents.length,
          events: mergedEvents.slice(0, 100),
          scheduledMeetings: userMeetings
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
            const mergedEvents = mergeMeetingsIntoEvents(events, userMeetings);
            config.connected = true;
            config.syncMode = 'google_oauth';
            config.isDemo = false;
            config.calendarName = config.calendarName || `${user.name} (${user.email})`;
            config.hostPublicName = user.name;
            config.lastSync = new Date().toISOString();
            config.events = mergedEvents;
            saveSyncConfig(config, user, userSlug);

            return jsonResponse({
              success: true,
              source: 'google_public_ical',
              calendarName: config.calendarName,
              count: mergedEvents.length,
              events: mergedEvents.slice(0, 100),
              scheduledMeetings: userMeetings
            }, 200, {}, updatedCookies);
          }
        } catch {
          // ignore
        }
      }

      // Fallback 3b: Sync with this user's scheduled internal meetings
      const fallbackEvents = mergeMeetingsIntoEvents(config.events || [], userMeetings);

      config.connected = true;
      config.syncMode = 'google_oauth';
      config.calendarName = config.calendarName || `${user.name} (${user.email})`;
      config.hostPublicName = user.name;
      config.lastSync = new Date().toISOString();
      config.events = fallbackEvents;
      saveSyncConfig(config, user, userSlug);

      return jsonResponse({
        success: true,
        source: 'local_fallback',
        calendarName: config.calendarName,
        count: config.events.length,
        events: config.events.slice(0, 100),
        scheduledMeetings: userMeetings,
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
        explicitlyDisconnected: true,
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

  // --- Calendar: Book Public Meeting (Inserts into Host & Invitee Google Calendar + Server Meetings) ---
  if (pathname === '/api/calendar/book' && method === 'POST') {
    const sessionData = getSessionData(request);
    const visitorUser = sessionData?.user || null;
    const body = await readRequestBody(request);

    const rawMeeting = body.meeting || {};
    const hostSlug = (body.hostSlug || '').trim();
    const hostToken = (body.hostToken || '').trim();

    if (!rawMeeting.dateTime || !rawMeeting.inviteeEmail) {
      return jsonResponse({ success: false, error: 'Datos de la reunión incompletos.' }, 400);
    }

    const meetingTimeZone = rawMeeting.timeZone || 'America/Santiago';
    rawMeeting.timeZone = meetingTimeZone;
    rawMeeting.dateTime = normalizeDateTimeWithOffset(rawMeeting.dateTime, meetingTimeZone);

    const { userKey: resolvedHostKey, config: hostConfig } = resolvePublicHostConfig(hostSlug || null, hostToken || null);
    const effectiveHostKey = resolvedHostKey || (visitorUser ? (visitorUser.email || visitorUser.id) : 'public-host');
    const effectiveHostName = (hostConfig.hostPublicName || body.hostName || (visitorUser && visitorUser.name) || 'Anfitrión')
      .replace(/calendly/gi, 'Reuniones')
      .trim();
    const effectiveHostEmail = hostConfig.hostEmail || null;

    let googleEventCreated = false;
    let googleEventId = null;
    let googleEventHtmlLink = null;
    let googleHangoutLink = null;
    let googleCalendarError = null;
    const updatedCookies = [];

    // 1. Try inserting into the Host's Google Calendar via OAuth API
    if (hostConfig.googleAccessToken && !String(hostConfig.googleAccessToken).startsWith('demo_token_')) {
      const hostApiRes = await createGoogleCalendarEvent(
        hostConfig.googleAccessToken,
        hostConfig.googleRefreshToken || null,
        rawMeeting,
        effectiveHostName,
        effectiveHostEmail
      );
      if (hostApiRes.newAccessToken) {
        hostConfig.googleAccessToken = hostApiRes.newAccessToken;
      }
      if (hostApiRes.ok) {
        googleEventCreated = true;
        googleEventId = hostApiRes.eventId || null;
        googleEventHtmlLink = hostApiRes.htmlLink || null;
        googleHangoutLink = hostApiRes.hangoutLink || null;
      } else {
        googleCalendarError = hostApiRes.error;
      }
    }

    // 2. If visitor is logged in with Google OAuth (and event wasn't already created on the same account), insert into Visitor's Google Calendar too
    const visitorConfig = visitorUser ? loadSyncConfig(visitorUser) : null;
    const visitorAccessToken = sessionData?.accessToken || visitorConfig?.googleAccessToken || null;
    const visitorRefreshToken = sessionData?.refreshToken || visitorConfig?.googleRefreshToken || null;
    const visitorIsSameAsHost = visitorUser && effectiveHostEmail && visitorUser.email?.toLowerCase() === effectiveHostEmail.toLowerCase();

    if (visitorAccessToken && !visitorUser?.isDemo && !String(visitorAccessToken).startsWith('demo_token_') && (!googleEventCreated || !visitorIsSameAsHost)) {
      const visitorApiRes = await createGoogleCalendarEvent(
        visitorAccessToken,
        visitorRefreshToken,
        rawMeeting,
        effectiveHostName,
        effectiveHostEmail
      );
      if (visitorApiRes.newAccessToken) {
        if (visitorConfig) visitorConfig.googleAccessToken = visitorApiRes.newAccessToken;
        if (sessionData) {
          const newSessionToken = signSession({
            ...sessionData,
            accessToken: visitorApiRes.newAccessToken,
            tokenExpiresAt: new Date(Date.now() + 3600 * 1000).toISOString()
          });
          updatedCookies.push(...buildAuthCookies(newSessionToken, url.protocol === 'https:'));
        }
      }
      if (visitorApiRes.ok) {
        googleEventCreated = true;
        if (!googleEventId) googleEventId = visitorApiRes.eventId || null;
        if (!googleEventHtmlLink) googleEventHtmlLink = visitorApiRes.htmlLink || null;
        if (!googleHangoutLink) googleHangoutLink = visitorApiRes.hangoutLink || null;
      } else if (!googleCalendarError) {
        googleCalendarError = visitorApiRes.error;
      }
    }

    const enrichedMeeting = {
      ...rawMeeting,
      id: rawMeeting.id || ('meet-' + Date.now()),
      hostName: effectiveHostName,
      hostSlug: hostSlug || hostConfig.hostSlug || slugifyName(effectiveHostName),
      locationUrl: googleHangoutLink || rawMeeting.locationUrl || 'https://meet.google.com/new',
      googleEventId,
      googleEventHtmlLink: googleEventHtmlLink || null,
      googleEventCreated,
      status: 'upcoming'
    };

    // 3. Save meeting to the Host's server-side meetings list
    const durationMs = (Number(enrichedMeeting.duration) || 30) * 60000;
    const startObj = new Date(enrichedMeeting.dateTime);
    const endObj = new Date(startObj.getTime() + durationMs);
    const busyEvent = {
      id: enrichedMeeting.id,
      summary: `${enrichedMeeting.eventTitle || 'Reunión'} con ${enrichedMeeting.inviteeName || 'Invitado'}`,
      start: startObj.toISOString(),
      end: endObj.toISOString(),
      location: enrichedMeeting.locationUrl || enrichedMeeting.location || 'Google Meet',
      status: 'CONFIRMED'
    };

    if (effectiveHostKey) {
      const hostMeetings = loadMeetings(effectiveHostKey, enrichedMeeting.hostSlug);
      const exists = hostMeetings.some(m => m.id === enrichedMeeting.id);
      if (!exists) {
        hostMeetings.unshift(enrichedMeeting);
      } else {
        const idx = hostMeetings.findIndex(m => m.id === enrichedMeeting.id);
        if (idx !== -1) hostMeetings[idx] = enrichedMeeting;
      }
      saveMeetings(hostMeetings, effectiveHostKey, enrichedMeeting.hostSlug);

      // Also add busy event to Host's syncConfig.events so the slot is immediately blocked on the public page
      hostConfig.connected = true;
      hostConfig.events = Array.isArray(hostConfig.events) ? hostConfig.events : [];
      if (!hostConfig.events.some(ev => ev.id === busyEvent.id)) {
        hostConfig.events.push(busyEvent);
      }
      hostConfig.lastSync = new Date().toISOString();
      if (!hostConfig.hostPublicName && effectiveHostName) {
        hostConfig.hostPublicName = effectiveHostName;
      }
      saveSyncConfig(hostConfig, effectiveHostKey, enrichedMeeting.hostSlug);
    }

    // 4. If visitor is logged in as a different user, also save to visitor's meetings list and calendar events
    const visitorKey = visitorUser ? (visitorUser.email || visitorUser.id) : null;
    if (visitorKey && visitorKey !== effectiveHostKey && visitorConfig) {
      const visitorSlug = visitorConfig.hostSlug || slugifyName(visitorUser.name);
      const visitorMeetings = loadMeetings(visitorKey, visitorSlug);
      if (!visitorMeetings.some(m => m.id === enrichedMeeting.id)) {
        visitorMeetings.unshift(enrichedMeeting);
      }
      saveMeetings(visitorMeetings, visitorKey, visitorSlug);
      visitorConfig.connected = true;
      visitorConfig.calendarName = visitorConfig.calendarName || `${visitorUser.name} (${visitorUser.email})`;
      visitorConfig.events = Array.isArray(visitorConfig.events) ? visitorConfig.events : [];
      if (!visitorConfig.events.some(ev => ev.id === busyEvent.id)) {
        visitorConfig.events.push(busyEvent);
      }
      visitorConfig.lastSync = new Date().toISOString();
      saveSyncConfig(visitorConfig, visitorUser, visitorSlug);
    }

    // Trigger Email Workflow for Booking Confirmation
    const emailResult = await sendWorkflowEmail({
      type: 'confirmation',
      meeting: enrichedMeeting,
      hostName: effectiveHostName,
      hostEmail: effectiveHostEmail
    });

    return jsonResponse({
      success: true,
      meeting: enrichedMeeting,
      googleEventCreated,
      googleEventId,
      googleEventHtmlLink,
      hangoutLink: googleHangoutLink,
      emailResult,
      warning: googleCalendarError
    }, 200, {}, updatedCookies);
  }

  // --- Calendar: Cancel or Delete Meeting & Trigger Google Calendar cancellation ---
  if (pathname === '/api/calendar/cancel-meeting' && method === 'POST') {
    const sessionData = getSessionData(request);
    const user = sessionData?.user || null;
    const body = await readRequestBody(request);

    const meetingId = (body.meetingId || '').trim();
    const deletePermanently = !!body.deletePermanently;
    const hostSlug = (body.hostSlug || '').trim();
    const hostToken = (body.hostToken || '').trim();

    if (!meetingId) {
      return jsonResponse({ success: false, error: 'ID de reunión requerido.' }, 400);
    }

    const { userKey: resolvedHostKey, config: hostConfig } = resolvePublicHostConfig(hostSlug || null, hostToken || null);
    const effectiveHostKey = resolvedHostKey || (user ? (user.email || user.id) : null);
    const effectiveSlug = hostSlug || hostConfig.hostSlug || (user ? slugifyName(user.name) : null);

    let foundMeeting = null;
    let googleEventDeleted = false;
    let googleCalendarError = null;

    // 1. Load Host meetings
    const hostMeetings = loadMeetings(effectiveHostKey, effectiveSlug);
    const mIdx = hostMeetings.findIndex(m => m.id === meetingId);
    if (mIdx !== -1) {
      foundMeeting = hostMeetings[mIdx];
      if (deletePermanently) {
        hostMeetings.splice(mIdx, 1);
      } else {
        hostMeetings[mIdx].status = 'canceled';
      }
      saveMeetings(hostMeetings, effectiveHostKey, effectiveSlug);
    }

    // 2. Unblock the slot in hostConfig.events so it can be re-booked
    if (hostConfig && Array.isArray(hostConfig.events)) {
      hostConfig.events = hostConfig.events.filter(ev => ev.id !== meetingId);
      hostConfig.lastSync = new Date().toISOString();
      saveSyncConfig(hostConfig, effectiveHostKey, effectiveSlug);
    }

    // 3. If visitor is also a logged in user, update visitor's meetings too
    if (user && effectiveHostKey !== (user.email || user.id)) {
      const visitorUserKey = user.email || user.id;
      const visitorSlug = slugifyName(user.name);
      const visitorMeetings = loadMeetings(visitorUserKey, visitorSlug);
      const vmIdx = visitorMeetings.findIndex(m => m.id === meetingId);
      if (vmIdx !== -1) {
        if (!foundMeeting) foundMeeting = visitorMeetings[vmIdx];
        if (deletePermanently) {
          visitorMeetings.splice(vmIdx, 1);
        } else {
          visitorMeetings[vmIdx].status = 'canceled';
        }
        saveMeetings(visitorMeetings, visitorUserKey, visitorSlug);
      }
      const visitorConfig = loadSyncConfig(user);
      if (visitorConfig && Array.isArray(visitorConfig.events)) {
        visitorConfig.events = visitorConfig.events.filter(ev => ev.id !== meetingId);
        saveSyncConfig(visitorConfig, visitorUserKey, visitorSlug);
      }
    }

    // 4. Delete event from Google Calendar if event ID is present
    const googleEventId = foundMeeting?.googleEventId || body.googleEventId;
    if (googleEventId) {
      if (hostConfig?.googleAccessToken && !String(hostConfig.googleAccessToken).startsWith('demo_token_')) {
        const delRes = await deleteGoogleCalendarEvent(hostConfig.googleAccessToken, hostConfig.googleRefreshToken || null, googleEventId);
        if (delRes.newAccessToken) hostConfig.googleAccessToken = delRes.newAccessToken;
        if (delRes.ok) {
          googleEventDeleted = true;
        } else {
          googleCalendarError = delRes.error;
        }
      }
      if (!googleEventDeleted && sessionData?.accessToken && !user?.isDemo && !String(sessionData.accessToken).startsWith('demo_token_')) {
        const delRes = await deleteGoogleCalendarEvent(sessionData.accessToken, sessionData.refreshToken || null, googleEventId);
        if (delRes.ok) {
          googleEventDeleted = true;
        } else if (!googleCalendarError) {
          googleCalendarError = delRes.error;
        }
      }
    }

    // 5. Trigger Email Workflow for Cancellation Notice
    let emailResult = null;
    if (foundMeeting) {
      emailResult = await sendWorkflowEmail({
        type: 'cancellation',
        meeting: foundMeeting,
        hostName: hostConfig?.hostPublicName || user?.name || 'Anfitrión',
        hostEmail: hostConfig?.hostEmail || user?.email || null
      });
    }

    return jsonResponse({
      success: true,
      status: deletePermanently ? 'deleted' : 'canceled',
      meetingId,
      freedSlot: true,
      googleEventDeleted,
      emailResult,
      warning: googleCalendarError
    }, 200);
  }

  // --- Workflows: Send Email Endpoint (Direct Trigger) ---
  if (pathname === '/api/workflows/send-email' && method === 'POST') {
    const sessionData = getSessionData(request);
    const user = sessionData?.user || null;
    const body = await readRequestBody(request);
    const meeting = body.meeting || {};
    const type = body.type || 'confirmation';
    const hostName = body.hostName || user?.name || 'Anfitrión';
    const hostEmail = body.hostEmail || user?.email || null;

    const emailResult = await sendWorkflowEmail({
      type,
      meeting,
      hostName,
      hostEmail
    });

    return jsonResponse({
      success: emailResult.ok,
      emailResult
    }, 200);
  }

  // --- Workflows: Send SMS Endpoint ---
  if (pathname === '/api/workflows/send-sms' && method === 'POST') {
    const body = await readRequestBody(request);
    const to = (body.to || '').trim();
    const messageBody = (body.body || body.message || '').trim();
    const meeting = body.meeting || {};

    const smsResult = await sendWorkflowSms({
      to,
      body: messageBody,
      meeting
    });

    return jsonResponse({
      success: smsResult.ok,
      smsResult
    }, 200);
  }

  // --- Workflows: Integration Status (Email, SMS, Calendar) ---
  if (pathname === '/api/workflows/status' && method === 'GET') {
    const status = getWorkflowApiStatus();
    return jsonResponse({
      success: true,
      status
    }, 200);
  }

  // --- Calendar: Sync Meetings (Strictly Per Authenticated User) ---
  if (pathname === '/api/calendar/sync-meetings' && method === 'POST') {
    const sessionData = getSessionData(request);
    const user = sessionData?.user || null;
    const body = await readRequestBody(request);
    const meetings = Array.isArray(body.meetings) ? body.meetings : [];
    if (user) {
      const userSlug = slugifyName(user.name);
      saveMeetings(meetings, user, userSlug);
      const config = loadSyncConfig(user);
      const activeToken = sessionData?.accessToken || config.googleAccessToken || null;
      const activeRefresh = sessionData?.refreshToken || config.googleRefreshToken || null;
      if (activeToken && !user.isDemo && !String(activeToken).startsWith('demo_token_')) {
        const allMeetings = loadMeetings(user, userSlug);
        const pendingSync = await syncPendingMeetingsToGoogleCalendar(
          activeToken,
          activeRefresh,
          allMeetings,
          config.events || [],
          user
        );
        if (pendingSync.updated) {
          saveMeetings(pendingSync.meetings, user, userSlug);
        }
      }
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
