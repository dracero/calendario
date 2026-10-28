import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// In Vercel, the project root is parent of api/
const PROJECT_ROOT = path.resolve(__dirname, '..');
const IS_VERCEL = !!process.env.VERCEL;
const STORAGE_DIR = IS_VERCEL ? os.tmpdir() : PROJECT_ROOT;

const SYNC_FILE = path.join(STORAGE_DIR, 'google-calendar-sync.json');
const DEFAULT_SYNC_FILE = path.join(PROJECT_ROOT, 'google-calendar-sync.json');

const MEETINGS_FILE = path.join(STORAGE_DIR, 'scheduled-meetings.json');
const DEFAULT_MEETINGS_FILE = path.join(PROJECT_ROOT, 'scheduled-meetings.json');

// Google OAuth Constants
const GOOGLE_AUTH_ENDPOINT = 'https://accounts.google.com/o/oauth2/v2/auth';
const GOOGLE_TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token';
const GOOGLE_USERINFO_ENDPOINT = 'https://www.googleapis.com/oauth2/v3/userinfo';

// Helper: load local .env if present
function loadEnv() {
  const envPath = path.join(PROJECT_ROOT, '.env');
  if (fs.existsSync(envPath)) {
    try {
      const content = fs.readFileSync(envPath, 'utf-8');
      for (const line of content.split('\n')) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#')) continue;
        const eqIdx = trimmed.indexOf('=');
        if (eqIdx !== -1) {
          const key = trimmed.slice(0, eqIdx).trim();
          let val = trimmed.slice(eqIdx + 1).trim();
          if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
            val = val.slice(1, -1);
          }
          if (process.env[key] === undefined) {
            process.env[key] = val;
          }
        }
      }
    } catch (e) {
      console.error('Error loading .env file:', e);
    }
  }
}
loadEnv();

// Helper: read request body
function readBody(req) {
  if (req.body && typeof req.body === 'object') {
    return Promise.resolve(req.body);
  }
  return new Promise((resolve) => {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch (e) {
        resolve({});
      }
    });
    req.on('error', () => resolve({}));
  });
}

function sendJson(res, statusCode, data, headers = {}) {
  if (res.headersSent) return;
  try {
    if (headers) {
      for (const [k, v] of Object.entries(headers)) {
        res.setHeader(k, v);
      }
    }
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

    if (typeof res.status === 'function' && typeof res.json === 'function') {
      return res.status(statusCode).json(data);
    }

    res.writeHead(statusCode, {
      'Content-Type': 'application/json; charset=utf-8',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
      ...headers
    });
    res.end(JSON.stringify(data));
  } catch (err) {
    console.error('sendJson error:', err);
  }
}

function parseCookies(req) {
  const list = {};
  const cookieHeader = req.headers.cookie;
  if (!cookieHeader) return list;
  cookieHeader.split(';').forEach(cookie => {
    let [name, ...rest] = cookie.split('=');
    name = name?.trim();
    if (!name) return;
    const value = rest.join('=').trim();
    try {
      list[name] = decodeURIComponent(value);
    } catch {
      list[name] = value;
    }
  });
  return list;
}

// Stateless HMAC Signed Session Cookies (Perfect for Vercel Serverless)
function getSecret() {
  return process.env.SESSION_SECRET || 'reuniones_super_secret_jwt_key_2026_change_in_production';
}

function signSession(data) {
  const secret = getSecret();
  const payload = Buffer.from(JSON.stringify(data)).toString('base64url');
  const signature = crypto.createHmac('sha256', secret).update(payload).digest('base64url');
  return `${payload}.${signature}`;
}

function verifySession(token) {
  if (!token || typeof token !== 'string' || !token.includes('.')) return null;
  const [payload, signature] = token.split('.');
  const secret = getSecret();
  const expectedSignature = crypto.createHmac('sha256', secret).update(payload).digest('base64url');
  if (signature !== expectedSignature) return null;
  try {
    const json = Buffer.from(payload, 'base64url').toString('utf-8');
    const data = JSON.parse(json);
    if (data.expiresAt && new Date(data.expiresAt) < new Date()) {
      return null;
    }
    return data;
  } catch {
    return null;
  }
}

function getSessionUser(req) {
  const cookies = parseCookies(req);
  const token = cookies.reuniones_session;
  if (!token) return null;
  const sessionData = verifySession(token);
  return sessionData?.user || null;
}

function isGoogleConfigured() {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  return !!(
    clientId &&
    clientSecret &&
    !clientId.includes('tu_google_client_id_aqui') &&
    !clientSecret.includes('tu_google_client_secret_aqui') &&
    clientId.length > 15
  );
}

function getAppBaseUrl(req) {
  if (process.env.APP_URL && !process.env.APP_URL.includes('localhost') && !process.env.APP_URL.includes('127.0.0.1')) {
    return process.env.APP_URL.replace(/\/$/, '');
  }
  let host = req.headers['x-forwarded-host'] || req.headers.host || '';
  if (host.includes(',')) host = host.split(',')[0].trim();

  let proto = req.headers['x-forwarded-proto'] || (host && host.includes('localhost') ? 'http' : 'https');
  if (proto.includes(',')) proto = proto.split(',')[0].trim();

  if (host) {
    return `${proto}://${host}`;
  }
  if (process.env.VERCEL_URL) {
    return `https://${process.env.VERCEL_URL}`;
  }
  return 'http://localhost:3000';
}

function getRedirectUri(req) {
  if (process.env.GOOGLE_REDIRECT_URI && !process.env.GOOGLE_REDIRECT_URI.includes('localhost')) {
    return process.env.GOOGLE_REDIRECT_URI;
  }
  const baseUrl = getAppBaseUrl(req);
  return `${baseUrl}/api/auth/google/callback`;
}

// Calendar Sync File Storage (Graceful fallback between /tmp and seed data)
function loadSyncConfig() {
  try {
    if (fs.existsSync(SYNC_FILE)) {
      return JSON.parse(fs.readFileSync(SYNC_FILE, 'utf-8'));
    }
    if (fs.existsSync(DEFAULT_SYNC_FILE)) {
      return JSON.parse(fs.readFileSync(DEFAULT_SYNC_FILE, 'utf-8'));
    }
  } catch (e) {
    console.error('Error reading sync file:', e);
  }
  return {
    connected: false,
    calendarName: null,
    lastSync: null,
    autoBlock: true,
    icalUrl: '',
    events: []
  };
}

function saveSyncConfig(config) {
  try {
    fs.writeFileSync(SYNC_FILE, JSON.stringify(config, null, 2), 'utf-8');
  } catch (e) {
    console.error('Error saving sync file:', e);
  }
}

const SEED_MEETINGS = [
  {
    id: "meet-1",
    eventTypeId: "ev-1",
    eventTitle: "Reunión de 15 minutos",
    eventColor: "#006bff",
    duration: 15,
    location: "Google Meet",
    locationUrl: "https://meet.google.com/abc-defg-hij",
    inviteeName: "Sofía Valenzuela",
    inviteeEmail: "sofia.valenzuela@empresa.com",
    inviteePhone: "+56 9 8765 4321",
    inviteeNotes: "Coordinación sobre entrega de la fase 2 y dudas de API.",
    dateTime: "2026-10-27T10:30:00",
    status: "upcoming"
  },
  {
    id: "meet-2",
    eventTypeId: "ev-2",
    eventTitle: "Llamada de Descubrimiento & Estrategia",
    eventColor: "#10b981",
    duration: 30,
    location: "Google Meet",
    locationUrl: "https://meet.google.com/klm-nopq-rst",
    inviteeName: "Roberto Morales",
    inviteeEmail: "roberto@startup.io",
    inviteePhone: "+56 9 1234 5678",
    inviteeNotes: "Interesados en integrar el sistema en nuestro portal de ventas.",
    dateTime: "2026-10-29T15:00:00",
    status: "upcoming"
  },
  {
    id: "meet-3",
    eventTypeId: "ev-3",
    eventTitle: "Demo de Producto / Showcase",
    eventColor: "#8b5cf6",
    duration: 45,
    location: "Zoom",
    locationUrl: "https://zoom.us/j/1234567890",
    inviteeName: "Mariana Costa",
    inviteeEmail: "mariana.costa@tech.org",
    inviteePhone: "+54 11 4455 6677",
    inviteeNotes: "Revisión final de métricas y onboarding del equipo.",
    dateTime: "2026-10-25T11:00:00",
    status: "past"
  }
];

function loadMeetings() {
  try {
    if (fs.existsSync(MEETINGS_FILE)) {
      return JSON.parse(fs.readFileSync(MEETINGS_FILE, 'utf-8'));
    }
    if (fs.existsSync(DEFAULT_MEETINGS_FILE)) {
      return JSON.parse(fs.readFileSync(DEFAULT_MEETINGS_FILE, 'utf-8'));
    }
  } catch (e) {
    console.error('Error reading meetings file:', e);
  }
  return SEED_MEETINGS;
}

function saveMeetings(meetings) {
  try {
    fs.writeFileSync(MEETINGS_FILE, JSON.stringify(meetings, null, 2), 'utf-8');
  } catch (e) {
    console.error('Error saving meetings file:', e);
  }
}

function parseIcalDate(dStr) {
  if (!dStr) return null;
  const clean = dStr.replace(/[^0-9TZ]/g, '');
  if (clean.length === 8) {
    const y = parseInt(clean.substring(0, 4), 10);
    const m = parseInt(clean.substring(4, 6), 10) - 1;
    const d = parseInt(clean.substring(6, 8), 10);
    return new Date(y, m, d).toISOString();
  }
  const match = clean.match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})(Z?)$/);
  if (match) {
    const [, y, m, d, hh, mm, ss, isUtc] = match;
    if (isUtc) return new Date(Date.UTC(+y, +m - 1, +d, +hh, +mm, +ss)).toISOString();
    return new Date(+y, +m - 1, +d, +hh, +mm, +ss).toISOString();
  }
  const parsed = Date.parse(dStr);
  return !isNaN(parsed) ? new Date(parsed).toISOString() : null;
}

function parseIcal(icalText) {
  const unfolded = icalText.replace(/\r\n[ \t]/g, '').replace(/\n[ \t]/g, '');
  const lines = unfolded.split(/\r?\n/);
  let calendarName = 'Google Calendar';
  const events = [];
  let inEvent = false;
  let currentEvent = {};

  for (const line of lines) {
    if (line.startsWith('X-WR-CALNAME:')) {
      calendarName = line.replace('X-WR-CALNAME:', '').trim();
    }
    if (line === 'BEGIN:VEVENT') {
      inEvent = true;
      currentEvent = {};
      continue;
    }
    if (line === 'END:VEVENT') {
      inEvent = false;
      if (currentEvent.start && currentEvent.end && currentEvent.status !== 'CANCELLED') {
        events.push(currentEvent);
      }
      continue;
    }
    if (!inEvent) continue;

    if (line.startsWith('SUMMARY:')) currentEvent.summary = line.substring(8).trim();
    else if (line.startsWith('UID:')) currentEvent.id = line.substring(4).trim();
    else if (line.startsWith('STATUS:')) currentEvent.status = line.substring(7).trim();
    else if (line.startsWith('DTSTART')) {
      const val = line.split(':').slice(1).join(':').trim();
      currentEvent.start = parseIcalDate(val);
      currentEvent.rawStart = val;
    } else if (line.startsWith('DTEND')) {
      const val = line.split(':').slice(1).join(':').trim();
      currentEvent.end = parseIcalDate(val);
      currentEvent.rawEnd = val;
    } else if (line.startsWith('LOCATION:')) currentEvent.location = line.substring(9).trim();
  }

  events.sort((a, b) => new Date(a.start) - new Date(b.start));
  return { calendarName, events };
}

function generateDemoEvents() {
  const now = new Date();
  const formatTime = (d, h, m) => {
    const target = new Date(d);
    target.setHours(h, m, 0, 0);
    return target.toISOString();
  };

  const day1 = new Date(now.getTime() + 86400000 * 1);
  const day2 = new Date(now.getTime() + 86400000 * 2);
  const day3 = new Date(now.getTime() + 86400000 * 3);

  return [
    {
      id: 'gcal-demo-1',
      summary: 'Reunión de Equipo Comercial (Google Calendar)',
      start: formatTime(day1, 10, 0),
      end: formatTime(day1, 11, 0),
      location: 'Google Meet',
      status: 'CONFIRMED'
    },
    {
      id: 'gcal-demo-2',
      summary: 'Cita médica / Control privado',
      start: formatTime(day1, 15, 30),
      end: formatTime(day1, 16, 30),
      location: 'Clínica',
      status: 'CONFIRMED'
    },
    {
      id: 'gcal-demo-3',
      summary: 'Revisión trimestral de presupuesto',
      start: formatTime(day2, 11, 0),
      end: formatTime(day2, 12, 30),
      location: 'Oficina Central',
      status: 'CONFIRMED'
    },
    {
      id: 'gcal-demo-4',
      summary: 'Sprint Planning Semanal (Ingeniería)',
      start: formatTime(day3, 9, 30),
      end: formatTime(day3, 11, 0),
      location: 'Google Meet',
      status: 'CONFIRMED'
    }
  ];
}

function generateIcsFeed(meetings = []) {
  const pad = (n) => String(n).padStart(2, '0');
  const toIcsDate = (d) => `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}T${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}00Z`;

  const vevents = meetings.map(m => {
    const startObj = new Date(m.dateTime);
    const endObj = new Date(startObj.getTime() + (m.duration || 30) * 60000);
    return [
      'BEGIN:VEVENT',
      `UID:${m.id || Date.now()}@reuniones.io`,
      `DTSTAMP:${toIcsDate(new Date())}`,
      `DTSTART:${toIcsDate(startObj)}`,
      `DTEND:${toIcsDate(endObj)}`,
      `SUMMARY:${(m.eventTitle || 'Reunión')} con ${m.inviteeName || 'Invitado'}`,
      `DESCRIPTION:${(m.inviteeNotes || 'Reunión agendada vía Reuniones')}\\nInvitado: ${m.inviteeName || ''} (${m.inviteeEmail || ''})`,
      `LOCATION:${m.locationUrl || m.location || 'Google Meet'}`,
      'STATUS:CONFIRMED',
      'END:VEVENT'
    ].join('\r\n');
  }).join('\r\n');

  return [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Reuniones Calendly Clone//ES',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'X-WR-CALNAME:Reuniones (Citas Programadas)',
    'X-WR-TIMEZONE:America/Santiago',
    vevents,
    'END:VCALENDAR'
  ].join('\r\n');
}

// =========================================================================
// VERCEL SERVERLESS HANDLER
// =========================================================================
export default async function handler(req, res) {
  try {
    let host = req.headers['x-forwarded-host'] || req.headers.host || 'localhost:3000';
    if (host.includes(',')) host = host.split(',')[0].trim();

    let proto = req.headers['x-forwarded-proto'] || (host.includes('localhost') ? 'http' : 'https');
    if (proto.includes(',')) proto = proto.split(',')[0].trim();

    let rawPath = req.url || '/';
    if ((rawPath.startsWith('/api/index.js') || rawPath === '/api' || rawPath === '/api/') && req.headers['x-matched-path']) {
      rawPath = req.headers['x-matched-path'];
    }

    let parsedUrl;
    try {
      parsedUrl = new URL(rawPath, `${proto}://${host}`);
    } catch {
      parsedUrl = new URL(rawPath, 'https://reuniones.local');
    }
    const pathname = parsedUrl.pathname;

  // Handle CORS Preflight
  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization'
    });
    res.end();
    return;
  }

  // --- Auth: Current User ---
  if (pathname === '/api/auth/me' && req.method === 'GET') {
    const user = getSessionUser(req);
    const configured = isGoogleConfigured();
    sendJson(res, 200, {
      authenticated: !!user,
      user: user || null,
      googleConfigured: configured,
      googleClientId: configured ? process.env.GOOGLE_CLIENT_ID : null
    });
    return;
  }

  // --- Auth: Initiate Google OAuth ---
  if (pathname === '/api/auth/google' && req.method === 'GET') {
    if (!isGoogleConfigured()) {
      if (req.headers.accept && req.headers.accept.includes('application/json')) {
        sendJson(res, 400, {
          success: false,
          configured: false,
          error: 'Credenciales de Google no configuradas en variables de entorno',
          help: 'Debes configurar GOOGLE_CLIENT_ID y GOOGLE_CLIENT_SECRET en tu panel de Vercel'
        });
        return;
      }
      res.writeHead(302, { Location: '/#login?error=missing_credentials' });
      res.end();
      return;
    }

    const clientId = process.env.GOOGLE_CLIENT_ID;
    const redirectUri = getRedirectUri(req);
    const scopes = process.env.GOOGLE_SCOPES || 'openid email profile https://www.googleapis.com/auth/calendar.events';
    const state = crypto.randomBytes(16).toString('hex');

    const authUrl = `${GOOGLE_AUTH_ENDPOINT}?client_id=${encodeURIComponent(clientId)}&redirect_uri=${encodeURIComponent(redirectUri)}&response_type=code&scope=${encodeURIComponent(scopes)}&access_type=offline&prompt=consent%20select_account&state=${state}`;

    if (parsedUrl.searchParams.get('format') === 'json') {
      sendJson(res, 200, { success: true, url: authUrl });
      return;
    }

    res.writeHead(302, { Location: authUrl });
    res.end();
    return;
  }

  // --- Auth: Google OAuth Callback ---
  if (pathname === '/api/auth/google/callback' && req.method === 'GET') {
    const code = parsedUrl.searchParams.get('code');
    const error = parsedUrl.searchParams.get('error');

    if (error) {
      console.warn('Google OAuth returned error:', error);
      res.writeHead(302, { Location: `/#login?error=${encodeURIComponent(error)}` });
      res.end();
      return;
    }

    if (!code) {
      res.writeHead(302, { Location: '/#login?error=missing_auth_code' });
      res.end();
      return;
    }

    try {
      const clientId = process.env.GOOGLE_CLIENT_ID;
      const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
      const redirectUri = getRedirectUri(req);

      // Exchange code for tokens
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
        res.writeHead(302, { Location: `/#login?error=${encodeURIComponent(reason)}` });
        res.end();
        return;
      }

      // Fetch user profile
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

      // Auto update calendar config
      if (user.hasCalendarScope) {
        const syncConfig = loadSyncConfig();
        syncConfig.connected = true;
        syncConfig.calendarName = `${user.name} (${user.email})`;
        syncConfig.lastSync = new Date().toISOString();
        saveSyncConfig(syncConfig);
      }

      const isHttps = proto === 'https';
      res.writeHead(302, {
        'Set-Cookie': `reuniones_session=${sessionToken}; Path=/; HttpOnly; SameSite=Lax; Max-Age=2592000${isHttps ? '; Secure' : ''}`,
        Location: '/?login=success#meeting_types'
      });
      res.end();
      return;
    } catch (err) {
      console.error('Fatal Google callback error:', err);
      res.writeHead(302, { Location: `/#login?error=server_error&details=${encodeURIComponent(err.message)}` });
      res.end();
      return;
    }
  }

  // --- Auth: Demo Google Login ---
  if (pathname === '/api/auth/demo-login' && req.method === 'POST') {
    const body = await readBody(req);
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

    const isHttps = proto === 'https';
    res.writeHead(200, {
      'Content-Type': 'application/json; charset=utf-8',
      'Set-Cookie': `reuniones_session=${sessionToken}; Path=/; HttpOnly; SameSite=Lax; Max-Age=2592000${isHttps ? '; Secure' : ''}`,
      'Access-Control-Allow-Origin': '*'
    });
    res.end(JSON.stringify({
      success: true,
      message: 'Sesión iniciada con éxito (Cuenta Google Demo)',
      user
    }));
    return;
  }

  // --- Auth: One Tap ---
  if (pathname === '/api/auth/google/one-tap' && req.method === 'POST') {
    const body = await readBody(req);
    const credential = body.credential;
    if (!credential) {
      sendJson(res, 400, { success: false, error: 'Credencial no proporcionada' });
      return;
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

      const isHttps = proto === 'https';
      res.writeHead(200, {
        'Content-Type': 'application/json; charset=utf-8',
        'Set-Cookie': `reuniones_session=${sessionToken}; Path=/; HttpOnly; SameSite=Lax; Max-Age=2592000${isHttps ? '; Secure' : ''}`,
        'Access-Control-Allow-Origin': '*'
      });
      res.end(JSON.stringify({ success: true, user }));
      return;
    } catch (err) {
      sendJson(res, 400, { success: false, error: 'Token Google inválido' });
      return;
    }
  }

  // --- Auth: Logout ---
  if (pathname === '/api/auth/logout' && req.method === 'POST') {
    res.writeHead(200, {
      'Content-Type': 'application/json; charset=utf-8',
      'Set-Cookie': 'reuniones_session=; Path=/; HttpOnly; Max-Age=0',
      'Access-Control-Allow-Origin': '*'
    });
    res.end(JSON.stringify({ success: true, message: 'Sesión cerrada correctamente' }));
    return;
  }

  // --- Calendar: Status ---
  if (pathname === '/api/calendar/status' && req.method === 'GET') {
    const config = loadSyncConfig();
    sendJson(res, 200, {
      success: true,
      connected: config.connected,
      calendarName: config.calendarName,
      lastSync: config.lastSync,
      autoBlock: config.autoBlock !== false,
      eventCount: (config.events || []).length,
      events: (config.events || []).slice(0, 100),
      isDemo: !!config.isDemo
    });
    return;
  }

  // --- Calendar: Connect ---
  if (pathname === '/api/calendar/connect' && req.method === 'POST') {
    const body = await readBody(req);
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
      sendJson(res, 200, {
        success: true,
        message: 'Google Calendar sincronizado en modo demostración',
        calendarName: config.calendarName,
        count: demoEvents.length,
        events: demoEvents
      });
      return;
    }

    if (!icalUrl || typeof icalUrl !== 'string') {
      sendJson(res, 400, { success: false, error: 'Debes proporcionar una URL iCal válida.' });
      return;
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
      sendJson(res, 200, { success: true, count: events.length, events: events.slice(0, 100) });
    } catch (err) {
      sendJson(res, 422, { success: false, error: `Error: ${err.message}` });
    }
    return;
  }

  // --- Calendar: Sync Now ---
  if (pathname === '/api/calendar/sync-now' && req.method === 'POST') {
    const config = loadSyncConfig();
    if (!config.connected) {
      sendJson(res, 400, { success: false, error: 'No hay un calendario conectado actualmente.' });
      return;
    }

    if (config.isDemo) {
      config.lastSync = new Date().toISOString();
      config.events = generateDemoEvents();
      saveSyncConfig(config);
      sendJson(res, 200, { success: true, count: config.events.length, events: config.events });
      return;
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
      sendJson(res, 200, { success: true, count: events.length, events: events.slice(0, 100) });
    } catch (err) {
      sendJson(res, 500, { success: false, error: `Error: ${err.message}` });
    }
    return;
  }

  // --- Calendar: Disconnect ---
  if (pathname === '/api/calendar/disconnect' && req.method === 'POST') {
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
    sendJson(res, 200, { success: true, message: 'Google Calendar desconectado.' });
    return;
  }

  // --- Calendar: Sync Meetings ---
  if (pathname === '/api/calendar/sync-meetings' && req.method === 'POST') {
    const body = await readBody(req);
    const meetings = Array.isArray(body.meetings) ? body.meetings : [];
    saveMeetings(meetings);
    sendJson(res, 200, { success: true, count: meetings.length });
    return;
  }

  // --- Calendar: Feed ICS ---
  if (pathname === '/api/calendar/feed.ics' || pathname === '/feed.ics') {
    const meetings = loadMeetings();
    const icsContent = generateIcsFeed(meetings);
    res.writeHead(200, {
      'Content-Type': 'text/calendar; charset=utf-8',
      'Content-Disposition': 'inline; filename="reuniones.ics"',
      'Access-Control-Allow-Origin': '*',
      'Cache-Control': 'no-cache'
    });
    res.end(icsContent);
    return;
  }

    // Not found fallback for /api
    sendJson(res, 404, { error: 'Ruta no encontrada', path: pathname });
  } catch (fatalErr) {
    console.error('Fatal Serverless Error in handler:', fatalErr);
    if (!res.headersSent) {
      sendJson(res, 500, {
        error: 'Error interno en función serverless',
        message: fatalErr.message
      });
    }
  }
}

