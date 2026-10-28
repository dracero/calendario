import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import os from 'node:os';

const STORAGE_DIR = os.tmpdir();
const SYNC_FILE = path.join(STORAGE_DIR, 'google-calendar-sync.json');
const MEETINGS_FILE = path.join(STORAGE_DIR, 'scheduled-meetings.json');

// Google OAuth Endpoints
export const GOOGLE_AUTH_ENDPOINT = 'https://accounts.google.com/o/oauth2/v2/auth';
export const GOOGLE_TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token';
export const GOOGLE_USERINFO_ENDPOINT = 'https://www.googleapis.com/oauth2/v3/userinfo';

// Solo process.env en runtime: evita que Vite incruste secretos del .env en el bundle.
export function getEnv(key) {
  loadLocalEnv();
  let val = (process.env[key] || '').trim();
  if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
    val = val.slice(1, -1).trim();
  }
  return val;
}

function loadLocalEnv() {
  if (process.env.VERCEL) return;
  try {
    const envFile = ['.env'].join('');
    const envPath = path.resolve(process.cwd(), envFile);
    if (fs.existsSync(envPath)) {
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
    }
  } catch {
    // ignore
  }
}

export function getSecret() {
  return getEnv('SESSION_SECRET') || 'reuniones_super_secret_jwt_key_2026_change_in_production';
}


export function signSession(data) {
  const secret = getSecret();
  const payload = Buffer.from(JSON.stringify(data)).toString('base64url');
  const signature = crypto.createHmac('sha256', secret).update(payload).digest('base64url');
  return `${payload}.${signature}`;
}

export function verifySession(token) {
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

export function parseCookies(cookieHeader) {
  const list = {};
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

export function getSessionUser(request) {
  const cookieHeader = request.headers.get('cookie') || '';
  const cookies = parseCookies(cookieHeader);
  const token = cookies.reuniones_session;
  if (!token) return null;
  const sessionData = verifySession(token);
  return sessionData?.user || null;
}

export function isGoogleConfigured() {
  const clientId = getEnv('GOOGLE_CLIENT_ID');
  const clientSecret = getEnv('GOOGLE_CLIENT_SECRET');
  return !!(
    clientId &&
    clientSecret &&
    !clientId.includes('tu_google_client_id_aqui') &&
    !clientSecret.includes('tu_google_client_secret_aqui') &&
    clientId.length > 15
  );
}

export function getAppBaseUrl(request) {
  const appUrl = getEnv('APP_URL');
  if (appUrl && !appUrl.includes('localhost') && !appUrl.includes('127.0.0.1')) {
    return appUrl.replace(/\/$/, '');
  }
  let host = request.headers.get('x-forwarded-host') || request.headers.get('host') || '';
  if (host.includes(',')) host = host.split(',')[0].trim();

  let proto = request.headers.get('x-forwarded-proto') || (host && host.includes('localhost') ? 'http' : 'https');
  if (proto.includes(',')) proto = proto.split(',')[0].trim();

  if (host) {
    return `${proto}://${host}`;
  }
  const vercelUrl = getEnv('VERCEL_URL');
  if (vercelUrl) {
    return `https://${vercelUrl}`;
  }
  return 'http://localhost:4321';
}

export function getRedirectUri(request) {
  const customRedirect = getEnv('GOOGLE_REDIRECT_URI');
  if (customRedirect && !customRedirect.includes('localhost')) {
    return customRedirect;
  }
  const baseUrl = getAppBaseUrl(request);
  return `${baseUrl}/api/auth/google/callback`;
}


export function loadSyncConfig() {
  try {
    if (fs.existsSync(SYNC_FILE)) {
      return JSON.parse(fs.readFileSync(SYNC_FILE, 'utf-8'));
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

export function saveSyncConfig(config) {
  try {
    fs.writeFileSync(SYNC_FILE, JSON.stringify(config, null, 2), 'utf-8');
  } catch (e) {
    console.error('Error saving sync file:', e);
  }
}

export const SEED_MEETINGS = [
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

export function loadMeetings() {
  try {
    if (fs.existsSync(MEETINGS_FILE)) {
      return JSON.parse(fs.readFileSync(MEETINGS_FILE, 'utf-8'));
    }
  } catch (e) {
    console.error('Error reading meetings file:', e);
  }
  return SEED_MEETINGS;
}

export function saveMeetings(meetings) {
  try {
    fs.writeFileSync(MEETINGS_FILE, JSON.stringify(meetings, null, 2), 'utf-8');
  } catch (e) {
    console.error('Error saving meetings file:', e);
  }
}

export function parseIcalDate(dStr) {
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

export function parseIcal(icalText) {
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

export function generateDemoEvents() {
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

export function generateIcsFeed(meetings = []) {
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
