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

export function getSessionData(request) {
  const cookieHeader = request.headers.get('cookie') || '';
  const cookies = parseCookies(cookieHeader);
  const token = cookies.reuniones_session;
  if (!token) return null;
  return verifySession(token);
}

export function getSessionUser(request) {
  const sessionData = getSessionData(request);
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


export function getUserKey(user) {
  if (!user) return null;
  if (typeof user === 'string') return user.toLowerCase().trim();
  if (user.email) return String(user.email).toLowerCase().trim();
  if (user.id) return String(user.id).trim();
  return null;
}

export function slugifyName(name) {
  if (!name || typeof name !== 'string') return '';
  return name
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

export function encryptHostToken(payload) {
  if (!payload || typeof payload !== 'object') return null;
  try {
    const key = crypto.createHash('sha256').update(getSecret()).digest();
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
    const json = JSON.stringify(payload);
    const encrypted = Buffer.concat([cipher.update(json, 'utf8'), cipher.final()]);
    const authTag = cipher.getAuthTag();
    return `${iv.toString('base64url')}.${authTag.toString('base64url')}.${encrypted.toString('base64url')}`;
  } catch {
    return null;
  }
}

export function decryptHostToken(token) {
  if (!token || typeof token !== 'string') return null;
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  try {
    const key = crypto.createHash('sha256').update(getSecret()).digest();
    const iv = Buffer.from(parts[0], 'base64url');
    const authTag = Buffer.from(parts[1], 'base64url');
    const encrypted = Buffer.from(parts[2], 'base64url');
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAuthTag(authTag);
    const decrypted = Buffer.concat([decipher.update(encrypted), decipher.final()]).toString('utf8');
    return JSON.parse(decrypted);
  } catch {
    return null;
  }
}

export function createDefaultSyncConfig() {
  return {
    connected: false,
    calendarName: null,
    hostPublicName: null,
    hostEmail: null,
    hostSlug: null,
    lastSync: null,
    autoBlock: true,
    icalUrl: '',
    events: [],
    isDemo: false
  };
}

export function loadSyncConfig(userId = null, hostSlug = null) {
  const cleanKey = getUserKey(userId);
  try {
    if (fs.existsSync(SYNC_FILE)) {
      const data = JSON.parse(fs.readFileSync(SYNC_FILE, 'utf-8'));
      const byUser = data.byUser || {};
      const bySlug = data.bySlug || {};

      if (cleanKey) {
        if (byUser[cleanKey]) {
          return { ...createDefaultSyncConfig(), ...byUser[cleanKey] };
        }
        return createDefaultSyncConfig();
      }

      if (hostSlug) {
        const cleanSlug = slugifyName(hostSlug);
        const mappedUserKey = bySlug[cleanSlug] || bySlug[hostSlug];
        if (mappedUserKey && byUser[mappedUserKey]) {
          return { ...createDefaultSyncConfig(), ...byUser[mappedUserKey] };
        }
        // Search by matching hostPublicName or email prefix
        for (const [, cfg] of Object.entries(byUser)) {
          if (
            cfg.hostSlug === cleanSlug ||
            slugifyName(cfg.hostPublicName) === cleanSlug ||
            (cfg.hostEmail && slugifyName(cfg.hostEmail.split('@')[0]) === cleanSlug)
          ) {
            return { ...createDefaultSyncConfig(), ...cfg };
          }
        }
      }
    }
  } catch (e) {
    console.error('Error reading sync file:', e);
  }
  return createDefaultSyncConfig();
}

export function resolvePublicHostConfig(hostSlug = null, hostToken = null) {
  const tokenData = decryptHostToken(hostToken);
  const cleanSlug = hostSlug ? slugifyName(hostSlug) : (tokenData?.slug || null);

  try {
    let byUser = {};
    let bySlug = {};
    if (fs.existsSync(SYNC_FILE)) {
      const data = JSON.parse(fs.readFileSync(SYNC_FILE, 'utf-8'));
      byUser = data.byUser || {};
      bySlug = data.bySlug || {};
    }

    // 1. Direct lookup or cold-start restoration by userKey from decrypted hostToken
    if (tokenData && tokenData.userKey) {
      const existingCfg = byUser[tokenData.userKey] || {};
      const mergedConfig = {
        ...createDefaultSyncConfig(),
        ...existingCfg,
        connected: !!(existingCfg.connected || tokenData.connected || tokenData.googleAccessToken),
        syncMode: existingCfg.syncMode || tokenData.syncMode || (tokenData.googleAccessToken ? 'google_oauth' : null),
        calendarName: existingCfg.calendarName || tokenData.calendarName || `${tokenData.name || 'Anfitrión'} (${tokenData.email || ''})`,
        hostPublicName: existingCfg.hostPublicName || tokenData.name || 'Agenda de Reuniones',
        hostEmail: existingCfg.hostEmail || tokenData.email || null,
        hostSlug: existingCfg.hostSlug || tokenData.slug || slugifyName(tokenData.name),
        icalUrl: existingCfg.icalUrl || tokenData.icalUrl || '',
        googleAccessToken: existingCfg.googleAccessToken || tokenData.googleAccessToken || null,
        googleRefreshToken: existingCfg.googleRefreshToken || tokenData.googleRefreshToken || null,
        events: Array.isArray(existingCfg.events) ? existingCfg.events : []
      };
      saveSyncConfig(mergedConfig, tokenData.userKey, mergedConfig.hostSlug);
      return {
        userKey: tokenData.userKey,
        config: mergedConfig
      };
    }

    // 2. Lookup by hostSlug in bySlug or byUser
    if (cleanSlug) {
      const mappedKey = bySlug[cleanSlug] || bySlug[hostSlug];
      if (mappedKey && byUser[mappedKey]) {
        return {
          userKey: mappedKey,
          config: { ...createDefaultSyncConfig(), ...byUser[mappedKey] }
        };
      }
      for (const [uKey, cfg] of Object.entries(byUser)) {
        if (
          cfg.hostSlug === cleanSlug ||
          slugifyName(cfg.hostPublicName) === cleanSlug ||
          (cfg.hostEmail && slugifyName(cfg.hostEmail.split('@')[0]) === cleanSlug)
        ) {
          return {
            userKey: uKey,
            config: { ...createDefaultSyncConfig(), ...cfg }
          };
        }
      }
    }

    // 3. Fallback when booking via a generic event link (e.g. #/book/reunion-15-min) without user slug:
    // Find the most recently active host who has connected a calendar or logged in
    const entries = Object.entries(byUser);
    const connectedEntry = entries.find(([, cfg]) => cfg && (cfg.connected || cfg.googleAccessToken));
    if (connectedEntry && !cleanSlug) {
      return {
        userKey: connectedEntry[0],
        config: { ...createDefaultSyncConfig(), ...connectedEntry[1] }
      };
    }
    if (entries.length > 0 && !cleanSlug) {
      return {
        userKey: entries[0][0],
        config: { ...createDefaultSyncConfig(), ...entries[0][1] }
      };
    }
  } catch (e) {
    console.error('Error resolving public host config:', e);
  }

  return {
    userKey: cleanSlug || null,
    config: createDefaultSyncConfig()
  };
}

export function saveSyncConfig(config, userId = null, hostSlug = null) {
  const cleanKey = getUserKey(userId);
  if (!cleanKey) return;
  try {
    let existing = { byUser: {}, bySlug: {} };
    if (fs.existsSync(SYNC_FILE)) {
      try {
        const parsed = JSON.parse(fs.readFileSync(SYNC_FILE, 'utf-8'));
        existing.byUser = parsed.byUser || {};
        existing.bySlug = parsed.bySlug || {};
      } catch {
        existing = { byUser: {}, bySlug: {} };
      }
    }
    const prevUserConfig = existing.byUser[cleanKey] || {};
    const derivedSlug = hostSlug || config.hostSlug || slugifyName(config.hostPublicName || prevUserConfig.hostPublicName);

    const cleanConfig = {
      ...createDefaultSyncConfig(),
      ...prevUserConfig,
      ...config,
      hostSlug: derivedSlug || prevUserConfig.hostSlug || null,
      googleAccessToken: config.googleAccessToken !== undefined ? config.googleAccessToken : (prevUserConfig.googleAccessToken || null),
      googleRefreshToken: config.googleRefreshToken !== undefined ? config.googleRefreshToken : (prevUserConfig.googleRefreshToken || null)
    };
    delete cleanConfig.byUser;
    delete cleanConfig.bySlug;

    existing.byUser[cleanKey] = cleanConfig;

    if (derivedSlug) {
      existing.bySlug[derivedSlug] = cleanKey;
    }

    fs.writeFileSync(
      SYNC_FILE,
      JSON.stringify({ byUser: existing.byUser, bySlug: existing.bySlug }, null, 2),
      'utf-8'
    );
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

export function loadMeetings(userId = null, hostSlug = null) {
  const cleanKey = getUserKey(userId);
  const derivedSlug = hostSlug || (typeof userId === 'object' && userId?.name ? slugifyName(userId.name) : null);
  try {
    if (fs.existsSync(MEETINGS_FILE)) {
      const data = JSON.parse(fs.readFileSync(MEETINGS_FILE, 'utf-8'));
      if (data && typeof data === 'object' && !Array.isArray(data)) {
        const byUser = data.byUser || {};
        const bySlug = data.bySlug || {};
        const userList = (cleanKey && Array.isArray(byUser[cleanKey])) ? byUser[cleanKey] : [];
        const slugList = (derivedSlug && Array.isArray(bySlug[derivedSlug])) ? bySlug[derivedSlug] : [];
        const merged = [...userList];
        for (const m of slugList) {
          if (m && m.id && !merged.some(existing => existing.id === m.id)) {
            merged.push(m);
          }
        }
        return merged;
      }
    }
  } catch (e) {
    console.error('Error reading meetings file:', e);
  }
  return [];
}

export function getTimezoneOffsetString(timeZone = 'America/Santiago', refDate = new Date()) {
  try {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone,
      timeZoneName: 'longOffset'
    }).formatToParts(refDate);
    const tzPart = parts.find(p => p.type === 'timeZoneName')?.value || '';
    const match = tzPart.match(/GMT([+-]\d{2}:\d{2})/);
    if (match) return match[1];
    if (tzPart === 'GMT' || tzPart === 'UTC') return '+00:00';
  } catch {
    // fallback below
  }
  return '-03:00';
}

export function normalizeDateTimeWithOffset(rawDateTime, timeZone = 'America/Santiago') {
  const str = String(rawDateTime || '').trim();
  if (!str) return new Date().toISOString();
  // If already has Z or ±HH:MM offset at the end, return as-is
  if (/(?:Z|[+-]\d{2}:\d{2})$/i.test(str)) {
    return str;
  }
  const localMatch = str.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/);
  if (localMatch) {
    const [, y, m, d, hh, mm, ss = '00'] = localMatch;
    const approxDate = new Date(Date.UTC(+y, +m - 1, +d, +hh, +mm, +ss));
    const offset = getTimezoneOffsetString(timeZone, approxDate);
    return `${y}-${m}-${d}T${hh}:${mm}:${ss}${offset}`;
  }
  const parsed = new Date(str);
  return isNaN(parsed.getTime()) ? new Date().toISOString() : parsed.toISOString();
}

export function saveMeetings(meetings, userId = null, hostSlug = null) {
  const cleanKey = getUserKey(userId);
  const derivedSlug = hostSlug || (typeof userId === 'object' && userId?.name ? slugifyName(userId.name) : null);
  if (!cleanKey && !derivedSlug) return;
  try {
    let existing = { byUser: {}, bySlug: {} };
    if (fs.existsSync(MEETINGS_FILE)) {
      try {
        const parsed = JSON.parse(fs.readFileSync(MEETINGS_FILE, 'utf-8'));
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
          existing.byUser = parsed.byUser || {};
          existing.bySlug = parsed.bySlug || {};
        }
      } catch {
        existing = { byUser: {}, bySlug: {} };
      }
    }
    const incomingList = Array.isArray(meetings) ? meetings : [];
    const mergeLists = (prevList = [], nextList = []) => {
      const byId = new Map();
      for (const item of nextList) {
        if (item && item.id) byId.set(item.id, item);
      }
      for (const item of prevList) {
        if (item && item.id && !byId.has(item.id)) {
          byId.set(item.id, item);
        }
      }
      return Array.from(byId.values());
    };

    if (cleanKey) {
      existing.byUser[cleanKey] = mergeLists(existing.byUser[cleanKey] || [], incomingList);
    }
    if (derivedSlug) {
      existing.bySlug[derivedSlug] = mergeLists(existing.bySlug[derivedSlug] || [], incomingList);
    }
    fs.writeFileSync(MEETINGS_FILE, JSON.stringify(existing, null, 2), 'utf-8');
  } catch (e) {
    console.error('Error saving meetings file:', e);
  }
}

export function mergeMeetingsIntoEvents(events = [], meetings = []) {
  const result = Array.isArray(events) ? [...events] : [];
  const upcoming = (Array.isArray(meetings) ? meetings : []).filter(m => m && m.status === 'upcoming' && m.dateTime);
  for (const m of upcoming) {
    const normDateStr = normalizeDateTimeWithOffset(m.dateTime, m.timeZone || 'America/Santiago');
    const startObj = new Date(normDateStr);
    if (isNaN(startObj.getTime())) continue;
    const endObj = new Date(startObj.getTime() + (Number(m.duration) || 30) * 60000);
    const exists = result.some(ev => ev && (ev.id === m.id || (ev.start && Math.abs(new Date(ev.start).getTime() - startObj.getTime()) < 60000)));
    if (!exists) {
      result.push({
        id: m.id,
        summary: `${m.eventTitle || 'Reunión'} con ${m.inviteeName || 'Invitado'}`,
        start: startObj.toISOString(),
        end: endObj.toISOString(),
        location: m.locationUrl || m.location || 'Google Meet',
        status: 'CONFIRMED'
      });
    }
  }
  result.sort((a, b) => new Date(a.start) - new Date(b.start));
  return result;
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

export async function refreshGoogleAccessToken(refreshToken) {
  if (!refreshToken) return null;
  try {
    const clientId = getEnv('GOOGLE_CLIENT_ID');
    const clientSecret = getEnv('GOOGLE_CLIENT_SECRET');
    if (!clientId || !clientSecret) return null;

    const res = await fetch(GOOGLE_TOKEN_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        refresh_token: refreshToken,
        grant_type: 'refresh_token'
      }).toString()
    });
    if (!res.ok) return null;
    const data = await res.json();
    return data.access_token || null;
  } catch {
    return null;
  }
}

export async function fetchGoogleCalendarApiEvents(accessToken, refreshToken = null) {
  if (!accessToken || accessToken.startsWith('demo_token_')) {
    return { ok: false, events: [], error: 'No OAuth access token available' };
  }

  const now = new Date();
  const timeMin = new Date(now.getTime() - 86400000).toISOString(); // From 24h ago
  const timeMax = new Date(now.getTime() + 86400000 * 60).toISOString(); // Next 60 days

  const buildUrl = () => {
    const params = new URLSearchParams({
      timeMin,
      timeMax,
      singleEvents: 'true',
      orderBy: 'startTime',
      maxResults: '150'
    });
    return `https://www.googleapis.com/calendar/v3/calendars/primary/events?${params.toString()}`;
  };

  let currentToken = accessToken;
  let refreshedToken = null;

  try {
    let response = await fetch(buildUrl(), {
      headers: { Authorization: `Bearer ${currentToken}` }
    });

    if (response.status === 401 && refreshToken) {
      refreshedToken = await refreshGoogleAccessToken(refreshToken);
      if (refreshedToken) {
        currentToken = refreshedToken;
        response = await fetch(buildUrl(), {
          headers: { Authorization: `Bearer ${currentToken}` }
        });
      }
    }

    if (!response.ok) {
      const errBody = await response.json().catch(() => ({}));
      const errMsg = errBody?.error?.message || `Google Calendar API HTTP ${response.status}`;
      return {
        ok: false,
        status: response.status,
        events: [],
        error: errMsg,
        newAccessToken: refreshedToken
      };
    }

    const data = await response.json();
    const items = Array.isArray(data.items) ? data.items : [];

    const validItems = items.filter(item => {
      if (!item || item.status === 'cancelled') return false;
      if (item.transparency === 'transparent') return false; // Free / non-blocking event
      return !!(item.start?.dateTime || item.start?.date);
    });

    const events = validItems.map((item, idx) => {
      const startIso = item.start.dateTime || `${item.start.date}T00:00:00`;
      const endIso = item.end?.dateTime || (item.end?.date ? `${item.end.date}T23:59:59` : startIso);
      const priv = item.extendedProperties?.private || {};
      return {
        id: priv.meetingId || item.id || `gcal-oauth-${idx}`,
        googleEventId: item.id || null,
        summary: item.summary || 'Ocupado (Google Calendar)',
        start: startIso,
        end: endIso,
        location: item.location || item.hangoutLink || 'Google Calendar',
        status: (item.status || 'CONFIRMED').toUpperCase()
      };
    });

    const reunionesMeetings = validItems
      .filter(item => {
        const priv = item.extendedProperties?.private || {};
        if (priv.reunionesBooking === 'true') return true;
        return typeof item.description === 'string' && item.description.includes('Reunión programada:');
      })
      .map(item => {
        const priv = item.extendedProperties?.private || {};
        const startIso = item.start.dateTime || `${item.start.date}T09:00:00`;
        const endIso = item.end?.dateTime || startIso;
        const calcDur = Math.max(15, Math.round((new Date(endIso) - new Date(startIso)) / 60000) || 30);
        const firstAttendee = Array.isArray(item.attendees) && item.attendees.length > 0 ? item.attendees[0] : {};
        return {
          id: priv.meetingId || `gcal-${item.id}`,
          googleEventId: item.id,
          googleEventCreated: true,
          eventTypeId: priv.eventTypeId || 'ev-1',
          eventTitle: priv.eventTitle || (item.summary ? item.summary.split(':')[0].trim() : 'Reunión'),
          eventColor: priv.eventColor || '#006bff',
          duration: Number(priv.duration) || calcDur,
          location: item.location || 'Google Meet',
          locationUrl: item.hangoutLink || item.location || 'https://meet.google.com/new',
          inviteeName: priv.inviteeName || firstAttendee.displayName || 'Invitado',
          inviteeEmail: priv.inviteeEmail || firstAttendee.email || '',
          inviteePhone: priv.inviteePhone || '',
          inviteeNotes: priv.inviteeNotes || '',
          dateTime: startIso,
          status: 'upcoming'
        };
      });

    return {
      ok: true,
      calendarSummary: data.summary || null,
      events,
      reunionesMeetings,
      newAccessToken: refreshedToken
    };
  } catch (err) {
    return {
      ok: false,
      events: [],
      error: err.message || 'Error consultando Google Calendar API',
      newAccessToken: refreshedToken
    };
  }
}

export async function createGoogleCalendarEvent(accessToken, refreshToken = null, meeting = {}, hostName = 'Anfitrión', hostEmail = null) {
  if (!accessToken || String(accessToken).startsWith('demo_token_')) {
    return { ok: false, error: 'No Google OAuth access token available for calendar insertion' };
  }

  let refreshedToken = null;

  try {
    const timeZone = meeting.timeZone || 'America/Santiago';
    const durationMinutes = Number(meeting.duration) || 30;

    // Build RFC3339 start and end dateTime strings with explicit timezone offset
    const rawDateTime = String(meeting.dateTime || '');
    const startDateTimeStr = normalizeDateTimeWithOffset(rawDateTime, timeZone);
    const startObj = new Date(startDateTimeStr);
    const endObj = new Date(startObj.getTime() + durationMinutes * 60000);

    // Format endDateTimeStr preserving the same offset when possible
    let endDateTimeStr = endObj.toISOString();
    const offsetMatch = startDateTimeStr.match(/([+-]\d{2}:\d{2})$/);
    if (offsetMatch) {
      const offsetStr = offsetMatch[1];
      const sign = offsetStr.startsWith('-') ? -1 : 1;
      const [offH, offM] = offsetStr.slice(1).split(':').map(Number);
      const offsetMs = sign * (offH * 60 + offM) * 60000;
      const localEnd = new Date(endObj.getTime() + offsetMs);
      const pad = (n) => String(n).padStart(2, '0');
      endDateTimeStr = `${localEnd.getUTCFullYear()}-${pad(localEnd.getUTCMonth() + 1)}-${pad(localEnd.getUTCDate())}T${pad(localEnd.getUTCHours())}:${pad(localEnd.getUTCMinutes())}:${pad(localEnd.getUTCSeconds())}${offsetStr}`;
    }

    const attendees = [];
    if (meeting.inviteeEmail && meeting.inviteeEmail.includes('@')) {
      attendees.push({
        email: meeting.inviteeEmail.trim(),
        displayName: meeting.inviteeName || 'Invitado'
      });
    }
    if (hostEmail && hostEmail.includes('@') && hostEmail.toLowerCase().trim() !== (meeting.inviteeEmail || '').toLowerCase().trim()) {
      attendees.push({
        email: hostEmail.trim(),
        displayName: hostName || 'Anfitrión'
      });
    }

    const descriptionLines = [
      `Reunión programada: ${meeting.eventTitle || 'Reunión'}`,
      `Anfitrión: ${hostName}`,
      `Invitado: ${meeting.inviteeName || 'Invitado'} (${meeting.inviteeEmail || ''})`
    ];
    if (meeting.inviteePhone) descriptionLines.push(`Teléfono: ${meeting.inviteePhone}`);
    if (meeting.inviteeNotes) descriptionLines.push(`Notas: ${meeting.inviteeNotes}`);
    if (meeting.locationUrl) descriptionLines.push(`Enlace de reunión: ${meeting.locationUrl}`);

    const summaryText = `${meeting.eventTitle || 'Reunión'}: ${meeting.inviteeName || 'Invitado'} y ${hostName}`;
    const descriptionText = descriptionLines.join('\n');
    const locationText = meeting.locationUrl || meeting.location || 'Google Meet';

    const extendedProperties = {
      private: {
        reunionesBooking: 'true',
        meetingId: String(meeting.id || ''),
        eventTypeId: String(meeting.eventTypeId || 'ev-1'),
        eventTitle: String(meeting.eventTitle || 'Reunión'),
        eventColor: String(meeting.eventColor || '#006bff'),
        duration: String(durationMinutes),
        inviteeName: String(meeting.inviteeName || 'Invitado'),
        inviteeEmail: String(meeting.inviteeEmail || ''),
        inviteePhone: String(meeting.inviteePhone || ''),
        inviteeNotes: String(meeting.inviteeNotes || '').slice(0, 500),
        hostName: String(hostName || '')
      }
    };

    const baseEventBody = {
      summary: summaryText,
      description: descriptionText,
      location: locationText,
      start: {
        dateTime: startDateTimeStr,
        timeZone
      },
      end: {
        dateTime: endDateTimeStr,
        timeZone
      },
      attendees,
      extendedProperties,
      reminders: {
        useDefault: true
      }
    };

    const eventBodyWithMeet = {
      ...baseEventBody,
      conferenceData: {
        createRequest: {
          requestId: `meet-${Date.now()}-${Math.random().toString(36).substring(2, 8)}`,
          conferenceSolutionKey: { type: 'hangoutsMeet' }
        }
      }
    };

    const baseEventBodyNoAttendees = {
      summary: summaryText,
      description: descriptionText,
      location: locationText,
      start: {
        dateTime: startDateTimeStr,
        timeZone
      },
      end: {
        dateTime: endDateTimeStr,
        timeZone
      },
      extendedProperties,
      reminders: {
        useDefault: true
      }
    };

    let currentToken = accessToken;

    const postEvent = async (token, mode = 'full') => {
      let query = 'conferenceDataVersion=1&sendUpdates=all';
      let payload = eventBodyWithMeet;
      if (mode === 'no_conference') {
        query = 'sendUpdates=all';
        payload = baseEventBody;
      } else if (mode === 'basic') {
        query = 'sendUpdates=none';
        payload = baseEventBodyNoAttendees;
      }
      const url = `https://www.googleapis.com/calendar/v3/calendars/primary/events?${query}`;
      return fetch(url, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(payload)
      });
    };

    let response = await postEvent(currentToken, 'full');

    if (response.status === 401 && refreshToken) {
      refreshedToken = await refreshGoogleAccessToken(refreshToken);
      if (refreshedToken) {
        currentToken = refreshedToken;
        response = await postEvent(currentToken, 'full');
      }
    }

    // If conferenceData creation is rejected by the account type, retry without conferenceData
    if (!response.ok && (response.status === 400 || response.status === 403)) {
      response = await postEvent(currentToken, 'no_conference');
    }

    // If attendees/sendUpdates=all is restricted on the account, retry basic event creation
    if (!response.ok && (response.status === 400 || response.status === 403)) {
      response = await postEvent(currentToken, 'basic');
    }

    if (!response.ok) {
      const errData = await response.json().catch(() => ({}));
      const errMsg = errData?.error?.message || `Google Calendar API HTTP ${response.status}`;
      return {
        ok: false,
        status: response.status,
        error: errMsg,
        newAccessToken: refreshedToken
      };
    }

    const created = await response.json();
    return {
      ok: true,
      eventId: created.id,
      htmlLink: created.htmlLink || null,
      hangoutLink: created.hangoutLink || created.conferenceData?.entryPoints?.[0]?.uri || null,
      start: created.start?.dateTime || startDateTimeStr,
      end: created.end?.dateTime || endDateTimeStr,
      newAccessToken: refreshedToken
    };
  } catch (err) {
    return {
      ok: false,
      error: err.message || 'Error insertando evento en Google Calendar',
      newAccessToken: refreshedToken
    };
  }
}

export async function deleteGoogleCalendarEvent(accessToken, refreshToken = null, googleEventId = null) {
  if (!accessToken || String(accessToken).startsWith('demo_token_') || !googleEventId) {
    return { ok: false, error: 'No Google OAuth token or event ID provided' };
  }

  let refreshedToken = null;
  let currentToken = accessToken;

  try {
    const doDelete = async (token) => {
      const url = `https://www.googleapis.com/calendar/v3/calendars/primary/events/${encodeURIComponent(googleEventId)}?sendUpdates=all`;
      return fetch(url, {
        method: 'DELETE',
        headers: {
          Authorization: `Bearer ${token}`
        }
      });
    };

    let response = await doDelete(currentToken);

    if (response.status === 401 && refreshToken) {
      refreshedToken = await refreshGoogleAccessToken(refreshToken);
      if (refreshedToken) {
        currentToken = refreshedToken;
        response = await doDelete(currentToken);
      }
    }

    // 204 No Content is standard success; 404/410 means already removed
    if (response.status === 204 || response.status === 404 || response.status === 410 || response.ok) {
      return { ok: true, newAccessToken: refreshedToken };
    }

    const errorBody = await response.text();
    return {
      ok: false,
      error: `Error eliminando evento de Google Calendar: ${response.status} ${errorBody}`,
      newAccessToken: refreshedToken
    };
  } catch (err) {
    return {
      ok: false,
      error: err.message || 'Error eliminando evento de Google Calendar',
      newAccessToken: refreshedToken
    };
  }
}

export async function syncPendingMeetingsToGoogleCalendar(accessToken, refreshToken = null, meetings = [], existingEvents = [], user = null) {
  if (!accessToken || String(accessToken).startsWith('demo_token_') || !Array.isArray(meetings) || meetings.length === 0) {
    return { updated: false, meetings, newAccessToken: null };
  }

  const seedIds = new Set(['meet-1', 'meet-2', 'meet-3']);
  let currentToken = accessToken;
  let latestNewToken = null;
  let updated = false;
  const hostName = (user && user.name) || 'Anfitrión';
  const hostEmail = (user && user.email) || null;

  for (const m of meetings) {
    if (!m || !m.id || seedIds.has(m.id)) continue;
    if (m.status !== 'upcoming' || !m.dateTime) continue;
    if (m.googleEventCreated) continue;

    const normStart = new Date(normalizeDateTimeWithOffset(m.dateTime, m.timeZone || 'America/Santiago'));
    if (isNaN(normStart.getTime())) continue;

    const alreadyInEvents = Array.isArray(existingEvents) && existingEvents.some(ev => {
      if (!ev) return false;
      if (ev.id === m.id) return true;
      if (ev.start && Math.abs(new Date(ev.start).getTime() - normStart.getTime()) < 60000) {
        const sum = (ev.summary || '').toLowerCase();
        const inv = (m.inviteeName || '').toLowerCase();
        if (inv && sum.includes(inv)) return true;
      }
      return false;
    });

    if (alreadyInEvents) {
      m.googleEventCreated = true;
      updated = true;
      continue;
    }

    const res = await createGoogleCalendarEvent(currentToken, refreshToken, m, m.hostName || hostName, hostEmail);
    if (res.newAccessToken) {
      currentToken = res.newAccessToken;
      latestNewToken = res.newAccessToken;
    }
    if (res.ok) {
      m.googleEventCreated = true;
      if (res.eventId) m.googleEventId = res.eventId;
      if (res.htmlLink) m.googleEventHtmlLink = res.htmlLink;
      if (res.hangoutLink) m.locationUrl = res.hangoutLink;
      updated = true;
    }
  }

  return { updated, meetings, newAccessToken: latestNewToken };
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
