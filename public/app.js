/* ==========================================================================
   REUNIONES APPLICATION ENGINE (CALENDLY CLONE FULL LOGIC)
   ========================================================================== */

(function () {
  'use strict';

  // --- Initial Seed Data ---
  const DEFAULT_EVENT_TYPES = [
    {
      id: 'ev-1',
      name: 'Reunión de 15 minutos',
      slug: '15min',
      color: '#006bff',
      duration: 15,
      location: 'Google Meet',
      description: 'Llamada rápida 1 a 1 para resolver dudas puntuales, coordinar próximas tareas o una breve puesta al día.',
      active: true,
      bufferBefore: 5,
      bufferAfter: 5,
      dateRange: 60,
      reqPhone: true,
      reqNotes: true,
      reqGuests: false,
      internalNote: 'Ideal para contactos iniciales y consultas breves.',
      createdAt: new Date().toISOString()
    },
    {
      id: 'ev-2',
      name: 'Llamada de Descubrimiento & Estrategia',
      slug: 'estrategia-30m',
      color: '#10b981',
      duration: 30,
      location: 'Google Meet',
      description: 'Sesión para explorar necesidades del proyecto, alineación de objetivos, alcance inicial y definir plan de acción.',
      active: true,
      bufferBefore: 10,
      bufferAfter: 10,
      dateRange: 60,
      reqPhone: true,
      reqNotes: true,
      reqGuests: true,
      internalNote: 'Preparar ficha de cliente antes de iniciar.',
      createdAt: new Date(Date.now() - 86400000 * 2).toISOString()
    },
    {
      id: 'ev-3',
      name: 'Demo de Producto / Showcase',
      slug: 'demo-producto-45m',
      color: '#8b5cf6',
      duration: 45,
      location: 'Zoom',
      description: 'Demostración interactiva guiada de nuestra plataforma y resolución de consultas técnicas en vivo.',
      active: true,
      bufferBefore: 10,
      bufferAfter: 15,
      dateRange: 30,
      reqPhone: true,
      reqNotes: true,
      reqGuests: true,
      internalNote: 'Tener abierta la cuenta sandbox demo.',
      createdAt: new Date(Date.now() - 86400000 * 5).toISOString()
    },
    {
      id: 'ev-4',
      name: 'Sesión de Mentoría & Consultoría Técnica',
      slug: 'consultoria-1h',
      color: '#f59e0b',
      duration: 60,
      location: 'Google Meet',
      description: 'Consultoría técnica profunda en arquitectura, diseño de sistemas, optimización y mejores prácticas de ingeniería.',
      active: false,
      bufferBefore: 15,
      bufferAfter: 15,
      dateRange: 90,
      reqPhone: true,
      reqNotes: true,
      reqGuests: false,
      internalNote: 'Revisar documentación previa enviada por el cliente.',
      createdAt: new Date(Date.now() - 86400000 * 10).toISOString()
    }
  ];

  const DEFAULT_SCHEDULED_MEETINGS = [
    {
      id: 'meet-1',
      eventTypeId: 'ev-1',
      eventTitle: 'Reunión de 15 minutos',
      eventColor: '#006bff',
      duration: 15,
      location: 'Google Meet',
      locationUrl: 'https://meet.google.com/abc-defg-hij',
      inviteeName: 'Sofía Valenzuela',
      inviteeEmail: 'sofia.valenzuela@empresa.com',
      inviteePhone: '+56 9 8765 4321',
      inviteeNotes: 'Coordinación sobre entrega de la fase 2 y dudas de API.',
      dateTime: new Date(Date.now() + 86400000 * 1).toISOString().split('T')[0] + 'T10:30:00',
      status: 'upcoming'
    },
    {
      id: 'meet-2',
      eventTypeId: 'ev-2',
      eventTitle: 'Llamada de Descubrimiento & Estrategia',
      eventColor: '#10b981',
      duration: 30,
      location: 'Google Meet',
      locationUrl: 'https://meet.google.com/klm-nopq-rst',
      inviteeName: 'Roberto Morales',
      inviteeEmail: 'roberto@startup.io',
      inviteePhone: '+56 9 1234 5678',
      inviteeNotes: 'Interesados en integrar el sistema en nuestro portal de ventas.',
      dateTime: new Date(Date.now() + 86400000 * 3).toISOString().split('T')[0] + 'T15:00:00',
      status: 'upcoming'
    },
    {
      id: 'meet-3',
      eventTypeId: 'ev-3',
      eventTitle: 'Demo de Producto / Showcase',
      eventColor: '#8b5cf6',
      duration: 45,
      location: 'Zoom',
      locationUrl: 'https://zoom.us/j/1234567890',
      inviteeName: 'Mariana Costa',
      inviteeEmail: 'mariana.costa@tech.org',
      inviteePhone: '+54 11 4455 6677',
      inviteeNotes: 'Revisión final de métricas y onboarding del equipo.',
      dateTime: new Date(Date.now() - 86400000 * 1).toISOString().split('T')[0] + 'T11:00:00',
      status: 'past'
    }
  ];

  const DEFAULT_WEEKLY_SCHEDULE = [
    { day: 'Lunes', active: true, start: '09:00', end: '18:00' },
    { day: 'Martes', active: true, start: '09:00', end: '18:00' },
    { day: 'Miércoles', active: true, start: '09:00', end: '18:00' },
    { day: 'Jueves', active: true, start: '09:00', end: '18:00' },
    { day: 'Viernes', active: true, start: '09:00', end: '17:00' },
    { day: 'Sábado', active: false, start: '10:00', end: '14:00' },
    { day: 'Domingo', active: false, start: '10:00', end: '14:00' }
  ];

  // --- State Management ---
  const state = {
    eventTypes: [],
    scheduledMeetings: [],
    weeklySchedule: [],
    timezone: 'America/Santiago',
    currentFilter: 'all',
    searchQuery: '',
    viewMode: 'grid', // 'grid' | 'list'
    activeAppView: 'login',
    scheduledFilter: 'upcoming',
    // Booking flow state
    bookingEvent: null,
    currentCalDate: new Date(),
    selectedDate: null,
    selectedSlot: null,
    // Active Share Event
    shareEvent: null,
    // Google Calendar Sync State
    googleCalendar: {
      connected: false,
      calendarName: null,
      hostPublicName: null,
      lastSync: null,
      autoBlock: true,
      icalUrl: '',
      events: [],
      isDemo: false
    },
    // Public Host State (when viewing another person's public booking link)
    publicHost: {
      connected: false,
      hostPublicName: null,
      hostSlug: null,
      autoBlock: true,
      events: [],
      scheduledMeetings: []
    },
    // Authentication State (Google OAuth / Calendly Clone)
    auth: {
      authenticated: false,
      checked: false,
      user: null,
      publicHostToken: null,
      googleConfigured: false,
      googleClientId: null
    }
  };

  function getCurrentUserStorageKey() {
    if (state.auth && state.auth.authenticated && state.auth.user) {
      const raw = (state.auth.user.email || state.auth.user.id || '').toLowerCase().trim();
      if (raw) return raw.replace(/[^a-z0-9@._-]/g, '_');
    }
    return 'anonymous';
  }

  function loadState(customUserKey) {
    try {
      const userKey = customUserKey || getCurrentUserStorageKey();
      const storedEvents = localStorage.getItem(`reuniones_event_types_${userKey}`);
      state.eventTypes = storedEvents ? JSON.parse(storedEvents) : JSON.parse(JSON.stringify(DEFAULT_EVENT_TYPES));

      const storedMeetings = localStorage.getItem(`reuniones_scheduled_${userKey}`);
      state.scheduledMeetings = storedMeetings ? JSON.parse(storedMeetings) : JSON.parse(JSON.stringify(DEFAULT_SCHEDULED_MEETINGS));

      const storedSchedule = localStorage.getItem(`reuniones_weekly_schedule_${userKey}`);
      state.weeklySchedule = storedSchedule ? JSON.parse(storedSchedule) : JSON.parse(JSON.stringify(DEFAULT_WEEKLY_SCHEDULE));

      const storedTz = localStorage.getItem(`reuniones_timezone_${userKey}`) || localStorage.getItem('reuniones_timezone');
      if (storedTz) state.timezone = storedTz;

      const storedTheme = localStorage.getItem('reuniones_theme');
      if (storedTheme) {
        document.documentElement.setAttribute('data-theme', storedTheme);
      }
    } catch (e) {
      console.warn('Error reading from localStorage, using defaults:', e);
      state.eventTypes = JSON.parse(JSON.stringify(DEFAULT_EVENT_TYPES));
      state.scheduledMeetings = JSON.parse(JSON.stringify(DEFAULT_SCHEDULED_MEETINGS));
      state.weeklySchedule = JSON.parse(JSON.stringify(DEFAULT_WEEKLY_SCHEDULE));
    }
  }

  function saveState() {
    try {
      const userKey = getCurrentUserStorageKey();
      localStorage.setItem(`reuniones_event_types_${userKey}`, JSON.stringify(state.eventTypes));
      localStorage.setItem(`reuniones_scheduled_${userKey}`, JSON.stringify(state.scheduledMeetings));
      localStorage.setItem(`reuniones_weekly_schedule_${userKey}`, JSON.stringify(state.weeklySchedule));
      localStorage.setItem(`reuniones_timezone_${userKey}`, state.timezone);
    } catch (e) {
      console.error('Failed to save to localStorage:', e);
    }
  }

  function loadUserLocalCalendarMeta(userKey) {
    if (!userKey || userKey === 'anonymous') return null;
    try {
      const raw = localStorage.getItem(`reuniones_gcal_user_${userKey}`);
      return raw ? JSON.parse(raw) : null;
    } catch {
      return null;
    }
  }

  function saveUserLocalCalendarMeta(meta) {
    const userKey = getCurrentUserStorageKey();
    if (!userKey || userKey === 'anonymous') return;
    try {
      localStorage.setItem(`reuniones_gcal_user_${userKey}`, JSON.stringify(meta));
    } catch (e) {
      console.warn('Failed to save user calendar metadata:', e);
    }
  }

  function clearUserLocalCalendarMeta() {
    const userKey = getCurrentUserStorageKey();
    if (!userKey || userKey === 'anonymous') return;
    try {
      localStorage.removeItem(`reuniones_gcal_user_${userKey}`);
    } catch (e) {
      console.warn('Failed to clear user calendar metadata:', e);
    }
  }

  function resetCalendarStateInMemory() {
    state.googleCalendar = {
      connected: false,
      calendarName: null,
      hostPublicName: null,
      lastSync: null,
      autoBlock: true,
      icalUrl: '',
      events: [],
      eventCount: 0,
      isDemo: false,
      syncMode: null
    };
    const urlInput = document.getElementById('input-gcal-ical-url');
    if (urlInput) urlInput.value = '';
  }

  // --- Toast Notifications ---
  function showToast(message, icon = '✓') {
    const container = document.getElementById('toast-container');
    if (!container) return;

    const toast = document.createElement('div');
    toast.className = 'toast';
    toast.innerHTML = `
      <span style="display: flex; align-items: center; justify-content: center; width: 20px; height: 20px; border-radius: 50%; background: rgba(255,255,255,0.2); font-weight: bold;">${icon}</span>
      <span>${message}</span>
    `;
    container.appendChild(toast);

    setTimeout(() => {
      toast.style.opacity = '0';
      toast.style.transform = 'translateY(10px) scale(0.95)';
      toast.style.transition = 'all 200ms ease';
      setTimeout(() => toast.remove(), 200);
    }, 3200);
  }

  // --- Copy Helper ---
  function copyToClipboard(text, successMsg = 'Enlace copiado al portapapeles') {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(() => showToast(successMsg));
    } else {
      const textarea = document.createElement('textarea');
      textarea.value = text;
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand('copy');
      textarea.remove();
      showToast(successMsg);
    }
  }

  // --- Dynamic Host Information based on Per-Browser Session Auth ---
  function sanitizePublicBrandName(name) {
    if (!name || typeof name !== 'string') return '';
    return name.replace(/calendly/gi, 'Reuniones').trim();
  }

  function humanizeSlug(slug) {
    if (!slug || typeof slug !== 'string') return '';
    return slug
      .replace(/[-_]+/g, ' ')
      .trim()
      .split(/\s+/)
      .filter(Boolean)
      .map(w => w.charAt(0).toUpperCase() + w.slice(1))
      .join(' ');
  }

  function getPublicRouteContext() {
    const hash = window.location.hash || '';
    const path = window.location.pathname || '';
    const searchParams = new URLSearchParams(window.location.search);

    let hashPath = hash.startsWith('#') ? hash.substring(1) : hash;
    let hashQuery = '';
    const qIdx = hashPath.indexOf('?');
    if (qIdx !== -1) {
      hashQuery = hashPath.substring(qIdx + 1);
      hashPath = hashPath.substring(0, qIdx);
    }
    const hashParams = new URLSearchParams(hashQuery);

    const hostToken = hashParams.get('ht') || searchParams.get('ht') || '';
    let hostSlug = hashParams.get('host') || searchParams.get('host') || '';
    let eventSlug = '';

    if (hashPath.startsWith('/user/')) {
      hostSlug = decodeURIComponent(hashPath.replace('/user/', '').split('/')[0] || '');
    } else if (path.startsWith('/user/')) {
      hostSlug = decodeURIComponent(path.replace('/user/', '').split('/')[0] || '');
    } else if (hashPath.startsWith('/book/')) {
      const rest = hashPath.replace('/book/', '').split('/').filter(Boolean);
      if (rest.length >= 2) {
        hostSlug = decodeURIComponent(rest[0]);
        eventSlug = decodeURIComponent(rest[1]);
      } else if (rest.length === 1) {
        eventSlug = decodeURIComponent(rest[0]);
      }
    } else if (path.startsWith('/book/')) {
      const rest = path.replace('/book/', '').split('/').filter(Boolean);
      if (rest.length >= 2) {
        hostSlug = decodeURIComponent(rest[0]);
        eventSlug = decodeURIComponent(rest[1]);
      } else if (rest.length === 1) {
        eventSlug = decodeURIComponent(rest[0]);
      }
    }

    return {
      hostSlug: hostSlug.trim(),
      eventSlug: eventSlug.trim(),
      hostToken: hostToken.trim()
    };
  }

  function getHostName() {
    if (state.auth && state.auth.authenticated && state.auth.user && state.auth.user.name) {
      return sanitizePublicBrandName(state.auth.user.name) || 'Agenda de Reuniones';
    }
    if (state.googleCalendar && state.googleCalendar.hostPublicName && state.googleCalendar.hostPublicName.trim()) {
      return sanitizePublicBrandName(state.googleCalendar.hostPublicName) || 'Agenda de Reuniones';
    }
    return 'Agenda de Reuniones';
  }

  function getPublicHostName() {
    const ctx = getPublicRouteContext();
    const mySlug = state.auth && state.auth.authenticated && state.auth.user
      ? getHostSlug(state.auth.user.name)
      : '';

    // If viewing another person's public page, show the public host's name instead of the visitor's own name
    if (state.publicHost && state.publicHost.hostPublicName) {
      return sanitizePublicBrandName(state.publicHost.hostPublicName);
    }
    if (ctx.hostSlug && ctx.hostSlug !== mySlug) {
      return sanitizePublicBrandName(humanizeSlug(ctx.hostSlug)) || 'Agenda de Reuniones';
    }
    return getHostName();
  }

  function getInitials(name) {
    if (!name) return 'AR';
    const parts = name.trim().split(/\s+/).filter(Boolean);
    if (parts.length === 1) return parts[0].substring(0, 2).toUpperCase();
    return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
  }

  function getHostSlug(name) {
    const n = name || getHostName();
    return n.toLowerCase()
      .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'calendario';
  }

  function buildPublicUserUrl(customSlug) {
    const slug = customSlug || getHostSlug();
    const ht = state.auth?.publicHostToken || '';
    const query = ht ? `?ht=${encodeURIComponent(ht)}` : '';
    return `${window.location.origin}/#/user/${slug}${query}`;
  }

  function buildPublicBookUrl(eventSlug, customHostSlug) {
    const hostSlug = customHostSlug || getHostSlug();
    const ht = state.auth?.publicHostToken || '';
    const params = new URLSearchParams();
    if (hostSlug) params.set('host', hostSlug);
    if (ht) params.set('ht', ht);
    const qs = params.toString();
    return `${window.location.origin}/#/book/${eventSlug}${qs ? '?' + qs : ''}`;
  }

  function renderAvatarElement(el, initials, picture, name) {
    if (!el) return;
    if (picture) {
      el.innerHTML = `<img src="${picture}" alt="${name || 'Avatar'}" style="width: 100%; height: 100%; object-fit: cover; border-radius: 50%;">`;
    } else {
      el.textContent = initials;
    }
  }

  function updateHostProfileUI() {
    const hostName = getHostName();
    const initials = getInitials(hostName);
    const slug = getHostSlug(hostName);
    const picture = state.auth && state.auth.user ? state.auth.user.picture : null;

    // 1. Header user avatar
    const headerAvatar = document.getElementById('header-user-avatar');
    renderAvatarElement(headerAvatar, initials, picture, hostName);

    // 2. Dropdown elements
    const dropAvatar = document.getElementById('dropdown-avatar');
    const dropName = document.getElementById('dropdown-name');
    const dropEmail = document.getElementById('dropdown-email');
    const dropBadge = document.getElementById('dropdown-google-badge');

    renderAvatarElement(dropAvatar, initials, picture, hostName);
    if (dropName) dropName.textContent = hostName;
    if (dropEmail) {
      dropEmail.textContent = (state.auth && state.auth.user && state.auth.user.email) || 'alex.usuario@gmail.com';
    }
    if (dropBadge) {
      if (state.auth && state.auth.authenticated) {
        dropBadge.style.display = 'inline-flex';
        if (state.auth.user?.isDemo) {
          dropBadge.innerHTML = '<span>⚡ Demo Google</span>';
        } else if (state.auth.user?.provider === 'email') {
          dropBadge.innerHTML = '<span>✉️ Cuenta registrada</span>';
        } else {
          dropBadge.innerHTML = '<svg width="12" height="12" viewBox="0 0 24 24"><path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/><path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/><path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22.81-.63z"/><path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52z"/></svg> Google OAuth';
        }
      } else {
        dropBadge.style.display = 'none';
      }
    }

    // 3. Main Admin Banner
    const mainAvatar = document.getElementById('main-host-avatar');
    const mainName = document.getElementById('main-host-name');
    const mainSlug = document.getElementById('main-host-slug');
    renderAvatarElement(mainAvatar, initials, picture, hostName);
    if (mainName) mainName.textContent = hostName;
    if (mainSlug) mainSlug.textContent = `reuniones.io/${slug}`;

    // 4. Public Profile Card (uses public host name when viewing another person's link)
    const pubHostName = getPublicHostName();
    const pubInitials = getInitials(pubHostName);
    const isViewingOwnPublic = !isPublicRoute() || (slug === getHostSlug(pubHostName));
    const pubPicture = isViewingOwnPublic ? picture : null;

    const pubAvatar = document.getElementById('public-avatar-circle');
    const pubName = document.getElementById('public-profile-name');
    const pubBio = document.getElementById('public-profile-bio');
    renderAvatarElement(pubAvatar, pubInitials, pubPicture, pubHostName);
    if (pubName) pubName.textContent = pubHostName;
    if (pubBio) {
      pubBio.textContent = `Bienvenido a la página de programación de ${pubHostName}. Selecciona una de las sesiones disponibles a continuación para agendar un espacio en el calendario.`;
    }

    // 5. Modal Booking Host
    const bookAvatar = document.getElementById('book-host-avatar');
    const bookName = document.getElementById('book-host-name');
    renderAvatarElement(bookAvatar, initials, picture, hostName);
    if (bookName) bookName.textContent = hostName;

    // 6. Edit modal slug prefix
    const editSlugPrefix = document.getElementById('edit-slug-prefix');
    if (editSlugPrefix) editSlugPrefix.textContent = `reuniones.io/${slug}/`;

    // 7. Update .env Modal and Login alerts status
    updateEnvStatusUI();
  }

  function updateEnvStatusUI() {
    const statusText = document.getElementById('env-status-text');
    const statusPill = document.getElementById('env-status-pill');
    const alertBanner = document.getElementById('login-alert-banner');
    const alertMsg = document.getElementById('login-alert-message');

    const isConfigured = !!state.auth.googleConfigured;

    if (statusText && statusPill) {
      if (isConfigured) {
        statusText.innerHTML = `<strong>Configurado:</strong> GOOGLE_CLIENT_ID detectado en <code>.env</code>.`;
        statusPill.textContent = 'ACTIVO';
        statusPill.style.background = '#22c55e';
        statusPill.style.color = '#ffffff';
      } else {
        statusText.innerHTML = `<strong>Pendiente:</strong> Credenciales aún no configuradas en <code>.env</code>. Puedes usar el botón de Demo Instantáneo o ingresar tus claves de Google Cloud.`;
        statusPill.textContent = 'PENDIENTE';
        statusPill.style.background = '#fbbf24';
        statusPill.style.color = '#78350f';
      }
    }

    if (alertBanner && alertMsg) {
      if (!isConfigured && !state.auth.authenticated) {
        alertBanner.style.display = 'flex';
        alertBanner.className = 'auth-alert-banner warning';
        alertMsg.innerHTML = `<strong>Nota:</strong> Las credenciales de Google OAuth están pendientes en tu archivo <code>.env</code>. Puedes ingresar con el botón <strong>"Entrar con Cuenta Google Demo (1-clic)"</strong> abajo o <a href="#" id="link-alert-env-help" style="color: inherit; font-weight: bold; text-decoration: underline;">configurar tus claves</a>.`;
        const linkHelp = document.getElementById('link-alert-env-help');
        if (linkHelp) {
          linkHelp.onclick = (e) => {
            e.preventDefault();
            const modal = document.getElementById('modal-env-setup');
            if (modal) modal.classList.add('show');
          };
        }
      } else {
        alertBanner.style.display = 'none';
      }
    }
  }

  // --- Google Authentication System (Calendly Clone - Per-Browser Session Strategy) ---
  function isPublicRoute() {
    const hash = window.location.hash || '';
    const path = window.location.pathname || '';
    return (
      hash === '#public' ||
      hash.startsWith('#/user') ||
      hash.startsWith('#/book/') ||
      path === '/public' ||
      path.startsWith('/user/') ||
      path.startsWith('/book/')
    );
  }

  async function checkAuthStatus() {
    const prevUserKey = getCurrentUserStorageKey();
    try {
      const res = await fetch('/api/auth/me', {
        method: 'GET',
        credentials: 'same-origin',
        cache: 'no-store',
        headers: { 'Cache-Control': 'no-cache' }
      });
      if (res.ok) {
        const data = await res.json();
        state.auth.authenticated = !!data.authenticated;
        state.auth.checked = true;
        state.auth.user = data.user || null;
        state.auth.publicHostToken = data.publicHostToken || null;
        state.auth.googleConfigured = !!data.googleConfigured;
        state.auth.googleClientId = data.googleClientId || null;

        const nextUserKey = getCurrentUserStorageKey();
        if (nextUserKey !== prevUserKey) {
          resetCalendarStateInMemory();
          loadState(nextUserKey);
          renderEventTypes();
          renderScheduledMeetings();
          renderWeeklySchedule();
        }
        updateHostProfileUI();
        return data;
      }
    } catch (e) {
      console.warn('Could not check auth status:', e);
    }
    state.auth.authenticated = false;
    state.auth.checked = true;
    state.auth.user = null;
    state.auth.publicHostToken = null;
    resetCalendarStateInMemory();
    updateHostProfileUI();
    return null;
  }

  function initiateGoogleLogin() {
    if (!state.auth.googleConfigured) {
      const modal = document.getElementById('modal-env-setup');
      if (modal) modal.classList.add('show');
      showToast('Configura tus credenciales de Google en el archivo .env', 'ℹ️');
      return;
    }
    window.location.href = '/api/auth/google';
  }

  async function loginDemoUser() {
    try {
      const res = await fetch('/api/auth/demo-login', {
        method: 'POST',
        credentials: 'same-origin',
        cache: 'no-store',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: 'Alex Reuniones',
          email: 'alex.usuario@gmail.com'
        })
      });
      const data = await res.json();
      if (data.success) {
        showToast('¡Sesión iniciada en este navegador!', '✓');
        await checkAuthStatus();
        await fetchCalendarStatus();
        window.location.hash = '#meeting_types';
        switchView('event-types');
      }
    } catch (err) {
      showToast('Error al iniciar demo: ' + err.message, '⚠️');
    }
  }

  async function loginOrRegisterByEmail(email, name, isSignup = false) {
    try {
      const endpoint = isSignup ? '/api/auth/register' : '/api/auth/email-login';
      const res = await fetch(endpoint, {
        method: 'POST',
        credentials: 'same-origin',
        cache: 'no-store',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, name })
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        showToast(data.error || 'Error al iniciar sesión', '⚠️');
        return false;
      }
      resetCalendarStateInMemory();
      await checkAuthStatus();
      await fetchCalendarStatus();
      showToast(`¡Bienvenido, ${data.user?.name || email}! Tu cuenta y calendario son independientes.`, '🎉');
      window.location.hash = '#meeting_types';
      switchView('event-types');
      return true;
    } catch (err) {
      showToast('Error de red al autenticar: ' + err.message, '⚠️');
      return false;
    }
  }

  async function logoutUser() {
    try {
      await fetch('/api/auth/logout', {
        method: 'POST',
        credentials: 'same-origin',
        cache: 'no-store'
      });
      state.auth.authenticated = false;
      state.auth.user = null;
      resetCalendarStateInMemory();
      loadState('anonymous');
      updateGoogleCalendarUI();
      updateHostProfileUI();
      showToast('Has cerrado sesión en este navegador', '✓');
      const dropdown = document.getElementById('user-profile-dropdown');
      if (dropdown) dropdown.classList.remove('show');
      window.location.hash = '#login';
      switchView('login');
    } catch (err) {
      showToast('Error al cerrar sesión', '⚠️');
    }
  }

  // --- Render Event Types ---
  function renderEventTypes() {
    const container = document.getElementById('event-types-container');
    if (!container) return;

    // Filter and Search
    const filtered = state.eventTypes.filter(ev => {
      // Filter by status
      if (state.currentFilter === 'active' && !ev.active) return false;
      if (state.currentFilter === 'inactive' && ev.active) return false;

      // Filter by search query
      if (state.searchQuery.trim()) {
        const query = state.searchQuery.toLowerCase();
        const matchesName = ev.name.toLowerCase().includes(query);
        const matchesDesc = (ev.description || '').toLowerCase().includes(query);
        const matchesLoc = (ev.location || '').toLowerCase().includes(query);
        const matchesSlug = (ev.slug || '').toLowerCase().includes(query);
        if (!matchesName && !matchesDesc && !matchesLoc && !matchesSlug) return false;
      }
      return true;
    });

    // Update Counts
    const allCount = state.eventTypes.length;
    const activeCount = state.eventTypes.filter(e => e.active).length;
    const inactiveCount = allCount - activeCount;

    const elAll = document.getElementById('count-all');
    const elAct = document.getElementById('count-active');
    const elInact = document.getElementById('count-inactive');
    if (elAll) elAll.textContent = allCount;
    if (elAct) elAct.textContent = activeCount;
    if (elInact) elInact.textContent = inactiveCount;

    // View Mode Class
    if (state.viewMode === 'list') {
      container.className = 'event-types-list-mode';
    } else {
      container.className = 'event-types-grid';
    }

    if (filtered.length === 0) {
      container.innerHTML = `
        <div style="grid-column: 1 / -1; text-align: center; padding: 60px 20px; background: var(--bg-card); border-radius: var(--radius-lg); border: 1px dashed var(--border-light);">
          <div style="font-size: 2.5rem; margin-bottom: 12px;">📅</div>
          <h3 style="font-size: 1.15rem; font-weight: 700; color: var(--text-main); margin-bottom: 6px;">No se encontraron tipos de eventos</h3>
          <p class="form-hint" style="margin-bottom: 20px;">Prueba ajustando los filtros de búsqueda o crea uno nuevo.</p>
          <button class="btn-primary" onclick="window.ReunionesApp.openCreateModal()">+ Crear tipo de evento</button>
        </div>
      `;
      return;
    }

    container.innerHTML = filtered.map(ev => {
      const publicUrl = buildPublicBookUrl(ev.slug);
      const locationIcon = getLocationIconSvg(ev.location);

      return `
        <div class="event-card ${ev.active ? '' : 'inactive'}" data-id="${ev.id}">
          <div class="card-top-accent" style="background: ${ev.color};"></div>
          <div class="card-body">
            <div class="card-header-row">
              <div class="card-title-group">
                <h2 class="card-title" onclick="window.ReunionesApp.openBookingModal('${ev.id}')">${escapeHtml(ev.name)}</h2>
                <div class="card-slug">
                  <span>/${escapeHtml(ev.slug)}</span>
                  ${ev.internalNote ? `<span title="Nota interna: ${escapeHtml(ev.internalNote)}" style="cursor: help;">📝</span>` : ''}
                </div>
              </div>

              <div class="card-actions-wrapper">
                <button class="btn-card-menu" onclick="window.ReunionesApp.toggleCardMenu('${ev.id}', event)" title="Opciones">
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                    <circle cx="12" cy="12" r="1.5"></circle>
                    <circle cx="12" cy="5" r="1.5"></circle>
                    <circle cx="12" cy="19" r="1.5"></circle>
                  </svg>
                </button>

                <div class="card-dropdown-menu" id="menu-${ev.id}">
                  <button class="card-dropdown-item" onclick="window.ReunionesApp.openEditModal('${ev.id}')">
                    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path></svg>
                    Editar
                  </button>
                  <button class="card-dropdown-item" onclick="window.ReunionesApp.openBookingModal('${ev.id}')">
                    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path><circle cx="12" cy="12" r="3"></circle></svg>
                    Previsualizar
                  </button>
                  <button class="card-dropdown-item" onclick="window.ReunionesApp.duplicateEvent('${ev.id}')">
                    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>
                    Duplicar
                  </button>
                  <button class="card-dropdown-item" onclick="window.ReunionesApp.openInternalNoteModal('${ev.id}')">
                    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline><line x1="16" y1="13" x2="8" y2="13"></line><line x1="16" y1="17" x2="8" y2="17"></line><polyline points="10 9 9 9 8 9"></polyline></svg>
                    Nota interna
                  </button>
                  <div style="height: 1px; background: var(--border-light); margin: 4px 0;"></div>
                  <button class="card-dropdown-item danger" onclick="window.ReunionesApp.deleteEvent('${ev.id}')">
                    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>
                    Eliminar
                  </button>
                </div>
              </div>
            </div>

            <div class="card-meta-row">
              <span class="meta-pill">
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><circle cx="12" cy="12" r="10"></circle><polyline points="12 6 12 12 16 14"></polyline></svg>
                ${ev.duration} min
              </span>
              <span class="meta-pill meta-pill-location">
                ${locationIcon}
                ${escapeHtml(ev.location)}
              </span>
            </div>

            <p class="card-description">${escapeHtml(ev.description || 'Sin descripción especificada.')}</p>
          </div>

          <div class="card-footer">
            <div class="card-footer-left">
              <button class="btn-copy-link" onclick="window.ReunionesApp.copyEventLink('${publicUrl}', this)">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>
                Copiar enlace
              </button>
              <button class="btn-share" onclick="window.ReunionesApp.openShareModal('${ev.id}')">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="18" cy="5" r="3"></circle><circle cx="6" cy="12" r="3"></circle><circle cx="18" cy="19" r="3"></circle><line x1="8.59" y1="13.51" x2="15.42" y2="17.49"></line><line x1="15.41" y1="6.51" x2="8.59" y2="10.49"></line></svg>
                Compartir
              </button>
            </div>

            <div class="toggle-switch-wrapper" title="${ev.active ? 'Evento activo (los clientes pueden reservar)' : 'Evento inactivo (reservas pausadas)'}">
              <label class="toggle-switch">
                <input type="checkbox" ${ev.active ? 'checked' : ''} onchange="window.ReunionesApp.toggleEventActive('${ev.id}', this.checked)">
                <span class="toggle-slider"></span>
              </label>
            </div>
          </div>
        </div>
      `;
    }).join('');
  }

  // --- Render Scheduled Meetings ---
  function renderScheduledMeetings() {
    const container = document.getElementById('scheduled-meetings-container');
    if (!container) return;

    const filtered = state.scheduledMeetings.filter(m => {
      if (state.scheduledFilter === 'upcoming') return m.status === 'upcoming';
      if (state.scheduledFilter === 'past') return m.status === 'past';
      if (state.scheduledFilter === 'canceled') return m.status === 'canceled';
      return true;
    });

    const upCount = state.scheduledMeetings.filter(m => m.status === 'upcoming').length;
    const pastCount = state.scheduledMeetings.filter(m => m.status === 'past').length;
    const canCount = state.scheduledMeetings.filter(m => m.status === 'canceled').length;

    const elUp = document.getElementById('scheduled-count-upcoming');
    const elPast = document.getElementById('scheduled-count-past');
    const elCan = document.getElementById('scheduled-count-canceled');
    const elBadge = document.getElementById('scheduled-counter-badge');

    if (elUp) elUp.textContent = upCount;
    if (elPast) elPast.textContent = pastCount;
    if (elCan) elCan.textContent = canCount;
    if (elBadge) elBadge.textContent = upCount;

    if (filtered.length === 0) {
      container.innerHTML = `
        <div style="text-align: center; padding: 60px 20px; background: var(--bg-card); border-radius: var(--radius-lg); border: 1px dashed var(--border-light);">
          <div style="font-size: 2.5rem; margin-bottom: 12px;">🗓️</div>
          <h3 style="font-size: 1.15rem; font-weight: 700; color: var(--text-main); margin-bottom: 6px;">No hay reuniones ${state.scheduledFilter === 'upcoming' ? 'próximas' : state.scheduledFilter === 'past' ? 'pasadas' : 'canceladas'}</h3>
          <p class="form-hint">Cuando un cliente reserve una cita desde tu enlace público, aparecerá listada aquí automáticamente.</p>
        </div>
      `;
      return;
    }

    container.innerHTML = filtered.map(m => {
      const dateObj = new Date(m.dateTime);
      const months = ['ENE', 'FEB', 'MAR', 'ABR', 'MAY', 'JUN', 'JUL', 'AGO', 'SEP', 'OCT', 'NOV', 'DIC'];
      const monthStr = months[dateObj.getMonth()];
      const dayNum = dateObj.getDate();
      const timeStr = dateObj.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

      return `
        <div class="meeting-row-card">
          <div class="meeting-row-left">
            <div class="meeting-date-badge">
              <span class="date-badge-month">${monthStr}</span>
              <span class="date-badge-day">${dayNum}</span>
            </div>
            <div class="meeting-row-details">
              <h3>${escapeHtml(m.inviteeName)}</h3>
              <div class="meeting-row-meta">
                <span style="display: flex; align-items: center; gap: 6px;">
                  <span style="width: 8px; height: 8px; border-radius: 50%; background: ${m.eventColor};"></span>
                  <strong>${escapeHtml(m.eventTitle)}</strong>
                </span>
                <span>•</span>
                <span>${timeStr} (${m.duration} min)</span>
                <span>•</span>
                <span>${escapeHtml(m.location)}</span>
              </div>
              <div style="font-size: 0.8125rem; color: var(--text-muted); margin-top: 4px;">
                ✉️ ${escapeHtml(m.inviteeEmail)} ${m.inviteePhone ? `• 📞 ${escapeHtml(m.inviteePhone)}` : ''}
              </div>
            </div>
          </div>

          <div style="display: flex; align-items: center; gap: 10px;">
            ${m.status === 'upcoming' ? `
              <a href="${m.locationUrl}" target="_blank" rel="noopener noreferrer" class="btn-primary" style="padding: 7px 14px; font-size: 0.8125rem;">
                Unirse a videollamada
              </a>
              <button class="btn-secondary" style="padding: 7px 12px; font-size: 0.8125rem;" onclick="window.ReunionesApp.cancelMeeting('${m.id}')">
                Cancelar
              </button>
            ` : `
              <span style="font-size: 0.8125rem; font-weight: 600; color: var(--text-muted); text-transform: uppercase;">
                ${m.status === 'past' ? 'Completada' : 'Cancelada'}
              </span>
            `}
          </div>
        </div>
      `;
    }).join('');
  }

  // --- Render Weekly Availability Schedule ---
  function renderWeeklySchedule() {
    const container = document.getElementById('weekly-schedule-rows');
    if (!container) return;

    container.innerHTML = state.weeklySchedule.map((s, idx) => `
      <div style="display: flex; align-items: center; justify-content: space-between; padding: 12px 16px; background: var(--bg-subtle); border-radius: var(--radius-md); gap: 16px;">
        <div style="display: flex; align-items: center; gap: 12px; width: 140px;">
          <input type="checkbox" id="sched-day-${idx}" ${s.active ? 'checked' : ''} onchange="window.ReunionesApp.updateScheduleDayActive(${idx}, this.checked)">
          <label for="sched-day-${idx}" style="font-weight: 600; font-size: 0.9375rem; cursor: pointer;">${s.day}</label>
        </div>

        <div style="display: flex; align-items: center; gap: 8px; flex: 1; justify-content: flex-end;">
          ${s.active ? `
            <input type="time" class="form-control" style="width: 120px; padding: 6px 10px;" value="${s.start}" onchange="window.ReunionesApp.updateScheduleTime(${idx}, 'start', this.value)">
            <span style="color: var(--text-muted);">-</span>
            <input type="time" class="form-control" style="width: 120px; padding: 6px 10px;" value="${s.end}" onchange="window.ReunionesApp.updateScheduleTime(${idx}, 'end', this.value)">
          ` : `
            <span style="font-size: 0.875rem; color: var(--text-muted); font-style: italic;">No disponible (Día libre)</span>
          `}
        </div>
      </div>
    `).join('');
  }

  // --- Helper Icon SVGs ---
  function getLocationIconSvg(loc) {
    if (loc.includes('Meet') || loc.includes('Google')) {
      return `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="23 7 16 12 23 17 23 7"></polygon><rect x="1" y="5" width="15" height="14" rx="2" ry="2"></rect></svg>`;
    }
    if (loc.includes('Zoom')) {
      return `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"></circle><polygon points="10 8 16 12 10 16 10 8"></polygon></svg>`;
    }
    if (loc.includes('teléfono') || loc.includes('Phone')) {
      return `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z"></path></svg>`;
    }
    return `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"></path><circle cx="12" cy="10" r="3"></circle></svg>`;
  }

  function escapeHtml(str) {
    if (!str) return '';
    return str.toString()
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  // --- Modal Helpers ---
  function openModal(modalId) {
    // Prevent modals from overlapping
    document.querySelectorAll('.modal-overlay.show').forEach(m => {
      if (m.id !== modalId) m.classList.remove('show');
    });
    const el = document.getElementById(modalId);
    if (el) el.classList.add('show');
  }

  function closeModal(modalId) {
    const el = document.getElementById(modalId);
    if (el) el.classList.remove('show');
  }

  // Close menus on outside click
  document.addEventListener('click', (e) => {
    // Dropdown menus
    if (!e.target.closest('.create-btn-container')) {
      const drop = document.getElementById('create-dropdown-menu');
      if (drop) drop.classList.remove('show');
    }
    if (!e.target.closest('.card-actions-wrapper')) {
      document.querySelectorAll('.card-dropdown-menu.show').forEach(m => m.classList.remove('show'));
    }
  });

  // Modal close buttons
  document.querySelectorAll('[data-close-modal]').forEach(btn => {
    btn.addEventListener('click', () => {
      closeModal(btn.getAttribute('data-close-modal'));
    });
  });

  // =========================================================================
  // PUBLIC BOOKING LOGIC (INTERACTIVE CALENDAR + TIME SLOTS)
  // =========================================================================
  function openBookingModal(eventId) {
    const ev = state.eventTypes.find(e => e.id === eventId) || state.eventTypes[0];
    if (!ev) return;

    state.bookingEvent = ev;
    state.selectedDate = null;
    state.selectedSlot = null;
    state.currentCalDate = new Date();

    // Reset steps
    document.getElementById('booking-step-calendar').style.display = 'block';
    document.getElementById('booking-step-form').style.display = 'none';
    document.getElementById('booking-step-success').style.display = 'none';

    // Populate Left Column details
    document.getElementById('book-event-title').textContent = ev.name;
    document.getElementById('book-event-duration').textContent = `${ev.duration} minutos`;
    document.getElementById('book-event-location').textContent = ev.location;
    document.getElementById('book-event-desc').textContent = ev.description || 'Agenda una reunión en el horario disponible que mejor te acomode.';

    // Populate Host Profile
    updateHostProfileUI();

    // Render Calendar
    renderCalendar();
    renderTimeSlots();

    openModal('modal-public-booking');
  }

  function renderCalendar() {
    const monthLabel = document.getElementById('calendar-month-label');
    const grid = document.getElementById('calendar-days-grid');
    if (!grid || !monthLabel) return;

    const year = state.currentCalDate.getFullYear();
    const month = state.currentCalDate.getMonth();

    const monthNames = [
      'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
      'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'
    ];
    monthLabel.textContent = `${monthNames[month]} ${year}`;

    // Day headers (L M M J V S D)
    const dayHeaders = ['L', 'M', 'M', 'J', 'V', 'S', 'D'];
    let html = dayHeaders.map(h => `<div class="cal-day-header">${h}</div>`).join('');

    const firstDayIndex = new Date(year, month, 1).getDay(); // 0 is Sunday
    // Adjust so 0 is Monday
    const startDay = (firstDayIndex + 6) % 7;
    const totalDays = new Date(year, month + 1, 0).getDate();

    // Empty cells before start of month
    for (let i = 0; i < startDay; i++) {
      html += `<div class="cal-day-cell empty"></div>`;
    }

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    for (let day = 1; day <= totalDays; day++) {
      const cellDate = new Date(year, month, day);
      cellDate.setHours(0, 0, 0, 0);

      const isPast = cellDate < today;
      const dayOfWeek = (cellDate.getDay() + 6) % 7; // 0=Mon, 6=Sun
      const daySchedule = state.weeklySchedule[dayOfWeek];
      const isDayOff = !daySchedule || !daySchedule.active;

      const isDisabled = isPast || isDayOff;
      const isSelected = state.selectedDate &&
        state.selectedDate.getFullYear() === year &&
        state.selectedDate.getMonth() === month &&
        state.selectedDate.getDate() === day;

      const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;

      html += `
        <div class="cal-day-cell ${isDisabled ? 'disabled' : ''} ${isSelected ? 'selected' : ''}"
             data-date="${dateStr}"
             onclick="window.ReunionesApp.selectBookingDate('${dateStr}', this)">
          ${day}
        </div>
      `;
    }

    grid.innerHTML = html;
  }

  function selectBookingDate(dateStr, cellEl) {
    document.querySelectorAll('.cal-day-cell.selected').forEach(c => c.classList.remove('selected'));
    if (cellEl) cellEl.classList.add('selected');

    const [y, m, d] = dateStr.split('-').map(Number);
    state.selectedDate = new Date(y, m - 1, d);
    state.selectedSlot = null;

    renderTimeSlots();
  }

  function renderTimeSlots() {
    const list = document.getElementById('time-slots-list');
    const headerDate = document.getElementById('selected-date-label');
    if (!list) return;

    if (!state.selectedDate) {
      headerDate.textContent = 'Selecciona un día';
      list.innerHTML = `<p class="form-hint" style="text-align: center; margin-top: 30px;">Selecciona una fecha disponible en el calendario para ver los horarios.</p>`;
      return;
    }

    const days = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'];
    const months = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'];
    headerDate.textContent = `${days[state.selectedDate.getDay()]}, ${state.selectedDate.getDate()} de ${months[state.selectedDate.getMonth()]}`;

    // Generate Slots based on duration and schedule
    const dayOfWeek = (state.selectedDate.getDay() + 6) % 7;
    const schedule = state.weeklySchedule[dayOfWeek];
    if (!schedule || !schedule.active) {
      list.innerHTML = `<p class="form-hint" style="text-align: center; margin-top: 20px;">No hay horarios disponibles para este día.</p>`;
      return;
    }

    const duration = (state.bookingEvent && state.bookingEvent.duration) || 15;
    const [startH, startM] = schedule.start.split(':').map(Number);
    const [endH, endM] = schedule.end.split(':').map(Number);

    const startMinutes = startH * 60 + startM;
    const endMinutes = endH * 60 + endM;

    const slots = [];
    for (let m = startMinutes; m + duration <= endMinutes; m += duration >= 30 ? 30 : 15) {
      const h = Math.floor(m / 60);
      const min = m % 60;
      const timeStr = `${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}`;
      slots.push(timeStr);
    }

    const selYear = state.selectedDate.getFullYear();
    const selMonth = state.selectedDate.getMonth();
    const selDay = state.selectedDate.getDate();

    list.innerHTML = slots.map(timeStr => {
      const isSelected = state.selectedSlot === timeStr;
      const [slotH, slotM] = timeStr.split(':').map(Number);
      const slotStart = new Date(selYear, selMonth, selDay, slotH, slotM, 0, 0);
      const slotEnd = new Date(slotStart.getTime() + duration * 60000);

      // 1. Check conflict with existing booked meetings in app
      const meetingConflict = state.scheduledMeetings.find(m => {
        if (m.status !== 'upcoming') return false;
        const mStart = new Date(m.dateTime);
        const mEnd = new Date(mStart.getTime() + (m.duration || 15) * 60000);
        return slotStart < mEnd && slotEnd > mStart;
      });

      // 2. Check conflict with synced Google Calendar events
      let gcalConflict = null;
      if (state.googleCalendar && state.googleCalendar.connected && state.googleCalendar.autoBlock) {
        gcalConflict = (state.googleCalendar.events || []).find(ev => {
          if (!ev.start || !ev.end) return false;
          const evStart = new Date(ev.start);
          const evEnd = new Date(ev.end);
          return slotStart < evEnd && slotEnd > evStart;
        });
      }

      if (meetingConflict) {
        return `
          <div class="slot-item-wrapper">
            <button class="slot-btn slot-busy" disabled title="Horario ya reservado: ${meetingConflict.eventTitle}">
              ${timeStr} <span class="slot-busy-indicator">Reservado</span>
            </button>
          </div>
        `;
      }

      if (gcalConflict) {
        return `
          <div class="slot-item-wrapper">
            <button class="slot-btn slot-busy" disabled title="Ocupado en Google Calendar: ${gcalConflict.summary || 'Evento'}">
              ${timeStr} <span class="slot-busy-indicator">Ocupado en G-Calendar</span>
            </button>
          </div>
        `;
      }

      return `
        <div class="slot-item-wrapper">
          <button class="slot-btn ${isSelected ? 'selected' : ''}" onclick="window.ReunionesApp.chooseSlot('${timeStr}')">
            ${timeStr}
          </button>
          ${isSelected ? `
            <button class="slot-confirm-btn" onclick="window.ReunionesApp.proceedToBookingForm('${timeStr}')">
              Siguiente &rarr;
            </button>
          ` : ''}
        </div>
      `;
    }).join('');
  }

  function chooseSlot(timeStr) {
    state.selectedSlot = timeStr;
    renderTimeSlots();
  }

  function proceedToBookingForm(timeStr) {
    state.selectedSlot = timeStr;
    document.getElementById('booking-step-calendar').style.display = 'none';
    document.getElementById('booking-step-form').style.display = 'block';

    const days = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'];
    const months = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];
    const dateFormatted = `${days[state.selectedDate.getDay()]}, ${state.selectedDate.getDate()} de ${months[state.selectedDate.getMonth()]} de ${state.selectedDate.getFullYear()}`;

    document.getElementById('form-summary-datetime').textContent = `📅 ${dateFormatted} a las ${timeStr} (${state.bookingEvent.duration} min)`;
  }

  async function submitBookingToServer(newMeeting) {
    const ctx = getPublicRouteContext();
    const pubHostName = getPublicHostName();
    const targetSlug = ctx.hostSlug || getHostSlug(pubHostName);
    const targetToken = ctx.hostToken || state.auth.publicHostToken || '';

    try {
      const res = await fetch('/api/calendar/book', {
        method: 'POST',
        credentials: 'same-origin',
        cache: 'no-store',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          meeting: newMeeting,
          hostSlug: targetSlug,
          hostToken: targetToken,
          hostName: pubHostName
        })
      });
      if (!res.ok) return null;
      const data = await res.json();
      if (data && data.success) {
        if (data.meeting) {
          Object.assign(newMeeting, data.meeting);
        }
        // Immediately block the slot in publicHost memory so it shows as Ocupado
        state.publicHost.scheduledMeetings = Array.isArray(state.publicHost.scheduledMeetings)
          ? [newMeeting, ...state.publicHost.scheduledMeetings]
          : [newMeeting];
        const startObj = new Date(newMeeting.dateTime);
        const endObj = new Date(startObj.getTime() + (Number(newMeeting.duration) || 30) * 60000);
        state.publicHost.events = Array.isArray(state.publicHost.events)
          ? [...state.publicHost.events, { start: startObj.toISOString(), end: endObj.toISOString(), status: 'CONFIRMED' }]
          : [{ start: startObj.toISOString(), end: endObj.toISOString(), status: 'CONFIRMED' }];
        return data;
      }
    } catch (e) {
      console.warn('Error booking meeting on server:', e);
    }
    return null;
  }

  // --- Invitee Booking Form Submission ---
  const bookingForm = document.getElementById('form-invitee-booking');
  if (bookingForm) {
    bookingForm.addEventListener('submit', async (e) => {
      e.preventDefault();

      const name = document.getElementById('invitee-name').value.trim();
      const email = document.getElementById('invitee-email').value.trim();
      const phone = document.getElementById('invitee-phone').value.trim();
      const notes = document.getElementById('invitee-notes').value.trim();

      const y = state.selectedDate.getFullYear();
      const m = String(state.selectedDate.getMonth() + 1).padStart(2, '0');
      const d = String(state.selectedDate.getDate()).padStart(2, '0');
      const dateTimeIso = `${y}-${m}-${d}T${state.selectedSlot}:00`;
      const resolvedTz = (Intl.DateTimeFormat && Intl.DateTimeFormat().resolvedOptions().timeZone) || 'America/Santiago';

      const newMeeting = {
        id: 'meet-' + Date.now(),
        eventTypeId: state.bookingEvent.id,
        eventTitle: state.bookingEvent.name,
        eventColor: state.bookingEvent.color,
        duration: state.bookingEvent.duration,
        location: state.bookingEvent.location,
        locationUrl: 'https://meet.google.com/' + Math.random().toString(36).substring(2, 5) + '-' + Math.random().toString(36).substring(2, 6) + '-' + Math.random().toString(36).substring(2, 5),
        inviteeName: name,
        inviteeEmail: email,
        inviteePhone: phone,
        inviteeNotes: notes,
        dateTime: dateTimeIso,
        timeZone: resolvedTz,
        status: 'upcoming'
      };

      const bookResult = await submitBookingToServer(newMeeting);

      state.scheduledMeetings.unshift(newMeeting);
      saveState();

      // Show Step 3 (Confirmation)
      document.getElementById('booking-step-form').style.display = 'none';
      document.getElementById('booking-step-success').style.display = 'flex';

      document.getElementById('success-invitee-email').textContent = email;
      document.getElementById('success-event-title').textContent = state.bookingEvent.name;
      document.getElementById('success-datetime').textContent = `${y}-${m}-${d} a las ${state.selectedSlot}`;
      document.getElementById('success-location').textContent = `${state.bookingEvent.location} (${newMeeting.locationUrl})`;

      // Setup Calendar links (Google, Outlook, ICS)
      const startObj = new Date(dateTimeIso);
      const endObj = new Date(startObj.getTime() + state.bookingEvent.duration * 60000);
      const pad = (n) => String(n).padStart(2, '0');
      const gDate = (d) => `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}T${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}00Z`;

      const hostName = getPublicHostName();
      const gCalUrl = `https://calendar.google.com/calendar/render?action=TEMPLATE&text=${encodeURIComponent(newMeeting.eventTitle + ' con ' + hostName)}&dates=${gDate(startObj)}/${gDate(endObj)}&details=${encodeURIComponent(newMeeting.inviteeNotes || 'Reunión programada')}&location=${encodeURIComponent(newMeeting.locationUrl || newMeeting.location)}`;
      const outCalUrl = `https://outlook.live.com/calendar/0/deeplink/compose?path=/calendar/action/compose&rru=addevent&subject=${encodeURIComponent(newMeeting.eventTitle + ' con ' + hostName)}&startdt=${startObj.toISOString()}&enddt=${endObj.toISOString()}&body=${encodeURIComponent(newMeeting.inviteeNotes || 'Reunión programada')}&location=${encodeURIComponent(newMeeting.locationUrl || newMeeting.location)}`;

      const btnG = document.getElementById('btn-add-google-cal');
      const btnO = document.getElementById('btn-add-outlook-cal');
      if (btnG) {
        btnG.href = (bookResult && bookResult.googleEventHtmlLink) ? bookResult.googleEventHtmlLink : gCalUrl;
      }
      if (btnO) btnO.href = outCalUrl;

      // Setup ICS download
      document.getElementById('btn-download-ics').onclick = () => downloadIcsFile(newMeeting);

      // Refresh listings
      renderScheduledMeetings();
      if (bookResult && bookResult.googleEventCreated) {
        showToast('¡Reunión agendada automáticamente en Google Calendar!', '🎉');
      } else {
        showToast('¡Reunión programada con éxito!', '🎉');
      }
    });
  }

  // --- ICS Generator ---
  function downloadIcsFile(meeting) {
    const startObj = new Date(meeting.dateTime);
    const endObj = new Date(startObj.getTime() + meeting.duration * 60000);

    const pad = (n) => String(n).padStart(2, '0');
    const toIcsDate = (d) => `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}T${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}00Z`;

    const icsContent = [
      'BEGIN:VCALENDAR',
      'VERSION:2.0',
      'PRODID:-//Reuniones Calendly Clone//ES',
      'CALSCALE:GREGORIAN',
      'METHOD:REQUEST',
      'BEGIN:VEVENT',
      `UID:${meeting.id}@reuniones.io`,
      `DTSTAMP:${toIcsDate(new Date())}`,
      `DTSTART:${toIcsDate(startObj)}`,
      `DTEND:${toIcsDate(endObj)}`,
      `SUMMARY:${meeting.eventTitle} con ${getHostName()}`,
      `DESCRIPTION:${meeting.inviteeNotes || 'Reunión de coordinación'}`,
      `LOCATION:${meeting.locationUrl || meeting.location}`,
      'STATUS:CONFIRMED',
      'END:VEVENT',
      'END:VCALENDAR'
    ].join('\r\n');

    const blob = new Blob([icsContent], { type: 'text/calendar;charset=utf-8' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `reunion-${meeting.id}.ics`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    showToast('Archivo .ics descargado');
  }

  // =========================================================================
  // EVENT TYPE BUILDER / CRUD
  // =========================================================================
  function openCreateModal(type = 'one-on-one') {
    document.getElementById('create-dropdown-menu').classList.remove('show');
    document.getElementById('editor-modal-title').textContent = 'Crear Tipo de Evento';
    document.getElementById('form-event-editor').reset();
    document.getElementById('edit-event-id').value = '';

    // Default values
    document.getElementById('edit-name').value = type === 'group' ? 'Taller / Sesión Grupal' : 'Reunión 1 a 1';
    document.getElementById('edit-slug').value = type === 'group' ? 'sesion-grupal' : 'reunion-nueva';
    document.getElementById('edit-duration').value = 30;

    // Reset tabs
    switchEditorTab('basic');
    openModal('modal-event-editor');
  }

  function openEditModal(eventId) {
    const ev = state.eventTypes.find(e => e.id === eventId);
    if (!ev) return;

    document.getElementById('editor-modal-title').textContent = 'Editar Tipo de Evento';
    document.getElementById('edit-event-id').value = ev.id;
    document.getElementById('edit-name').value = ev.name;
    document.getElementById('edit-slug').value = ev.slug;
    document.getElementById('edit-location').value = ev.location;
    document.getElementById('edit-description').value = ev.description || '';
    document.getElementById('edit-duration').value = ev.duration;
    document.getElementById('edit-date-range').value = ev.dateRange || 60;
    document.getElementById('edit-buffer-before').value = ev.bufferBefore || 0;
    document.getElementById('edit-buffer-after').value = ev.bufferAfter || 0;
    document.getElementById('edit-req-phone').checked = !!ev.reqPhone;
    document.getElementById('edit-req-notes').checked = !!ev.reqNotes;
    document.getElementById('edit-req-guests').checked = !!ev.reqGuests;

    // Set Color
    document.querySelectorAll('.color-swatch-item').forEach(sw => {
      sw.classList.toggle('active', sw.getAttribute('data-color') === ev.color);
    });

    switchEditorTab('basic');
    openModal('modal-event-editor');
  }

  function switchEditorTab(tabKey) {
    document.querySelectorAll('.modal-nav-tab').forEach(t => {
      t.classList.toggle('active', t.getAttribute('data-editor-tab') === tabKey);
    });
    document.getElementById('tab-editor-basic').style.display = tabKey === 'basic' ? 'block' : 'none';
    document.getElementById('tab-editor-schedule').style.display = tabKey === 'schedule' ? 'block' : 'none';
    document.getElementById('tab-editor-questions').style.display = tabKey === 'questions' ? 'block' : 'none';
  }

  document.querySelectorAll('[data-editor-tab]').forEach(tabBtn => {
    tabBtn.addEventListener('click', () => switchEditorTab(tabBtn.getAttribute('data-editor-tab')));
  });

  // Color Swatch Selection
  document.querySelectorAll('.color-swatch-item').forEach(swatch => {
    swatch.addEventListener('click', () => {
      document.querySelectorAll('.color-swatch-item').forEach(s => s.classList.remove('active'));
      swatch.classList.add('active');
    });
  });

  // Duration Presets
  document.querySelectorAll('.duration-preset-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.duration-preset-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      document.getElementById('edit-duration').value = btn.getAttribute('data-duration');
    });
  });

  // Auto slugify name
  const nameInput = document.getElementById('edit-name');
  if (nameInput) {
    nameInput.addEventListener('input', () => {
      const slugInput = document.getElementById('edit-slug');
      if (document.getElementById('edit-event-id').value === '') {
        slugInput.value = nameInput.value.toLowerCase()
          .replace(/[^\w\s-]/g, '')
          .replace(/[\s_-]+/g, '-')
          .replace(/^-+|-+$/g, '');
      }
    });
  }

  // Save Event Type Form
  document.getElementById('btn-save-event-type').addEventListener('click', () => {
    const name = document.getElementById('edit-name').value.trim();
    const slug = document.getElementById('edit-slug').value.trim();
    if (!name || !slug) {
      alert('Por favor ingresa un nombre y un enlace (slug) para el evento.');
      return;
    }

    const activeSwatch = document.querySelector('.color-swatch-item.active');
    const color = activeSwatch ? activeSwatch.getAttribute('data-color') : '#006bff';
    const location = document.getElementById('edit-location').value;
    const description = document.getElementById('edit-description').value.trim();
    const duration = parseInt(document.getElementById('edit-duration').value, 10) || 15;
    const dateRange = document.getElementById('edit-date-range').value;
    const bufferBefore = parseInt(document.getElementById('edit-buffer-before').value, 10) || 0;
    const bufferAfter = parseInt(document.getElementById('edit-buffer-after').value, 10) || 0;
    const reqPhone = document.getElementById('edit-req-phone').checked;
    const reqNotes = document.getElementById('edit-req-notes').checked;
    const reqGuests = document.getElementById('edit-req-guests').checked;

    const editId = document.getElementById('edit-event-id').value;

    if (editId) {
      // Update
      const ev = state.eventTypes.find(e => e.id === editId);
      if (ev) {
        ev.name = name;
        ev.slug = slug;
        ev.color = color;
        ev.location = location;
        ev.description = description;
        ev.duration = duration;
        ev.dateRange = dateRange;
        ev.bufferBefore = bufferBefore;
        ev.bufferAfter = bufferAfter;
        ev.reqPhone = reqPhone;
        ev.reqNotes = reqNotes;
        ev.reqGuests = reqGuests;
      }
      showToast('Tipo de evento actualizado con éxito');
    } else {
      // Create
      const newEv = {
        id: 'ev-' + Date.now(),
        name,
        slug,
        color,
        location,
        description,
        duration,
        dateRange,
        bufferBefore,
        bufferAfter,
        reqPhone,
        reqNotes,
        reqGuests,
        active: true,
        internalNote: '',
        createdAt: new Date().toISOString()
      };
      state.eventTypes.unshift(newEv);
      showToast('Nuevo tipo de evento creado');
    }

    saveState();
    renderEventTypes();
    closeModal('modal-event-editor');
  });

  // Toggle active switch
  function toggleEventActive(eventId, isChecked) {
    const ev = state.eventTypes.find(e => e.id === eventId);
    if (ev) {
      ev.active = isChecked;
      saveState();
      renderEventTypes();
      showToast(isChecked ? 'Evento activado para reservas' : 'Evento desactivado');
    }
  }

  // Duplicate Event
  function duplicateEvent(eventId) {
    const original = state.eventTypes.find(e => e.id === eventId);
    if (!original) return;

    const copy = {
      ...JSON.parse(JSON.stringify(original)),
      id: 'ev-' + Date.now(),
      name: `${original.name} (Copia)`,
      slug: `${original.slug}-copia`,
      createdAt: new Date().toISOString()
    };

    state.eventTypes.unshift(copy);
    saveState();
    renderEventTypes();
    showToast('Tipo de evento duplicado');
  }

  // Delete Event
  function deleteEvent(eventId) {
    const ev = state.eventTypes.find(e => e.id === eventId);
    if (!ev) return;

    if (confirm(`¿Estás seguro de que deseas eliminar permanentemente el tipo de evento "${ev.name}"?`)) {
      state.eventTypes = state.eventTypes.filter(e => e.id !== eventId);
      saveState();
      renderEventTypes();
      showToast('Tipo de evento eliminado');
    }
  }

  // Internal Note Modal
  let noteTargetEventId = null;
  function openInternalNoteModal(eventId) {
    const ev = state.eventTypes.find(e => e.id === eventId);
    if (!ev) return;
    noteTargetEventId = eventId;
    document.getElementById('internal-note-textarea').value = ev.internalNote || '';
    openModal('modal-internal-note');
  }

  document.getElementById('btn-save-internal-note').addEventListener('click', () => {
    if (noteTargetEventId) {
      const ev = state.eventTypes.find(e => e.id === noteTargetEventId);
      if (ev) {
        ev.internalNote = document.getElementById('internal-note-textarea').value.trim();
        saveState();
        renderEventTypes();
        showToast('Nota interna guardada');
      }
    }
    closeModal('modal-internal-note');
  });

  // =========================================================================
  // SHARE MODAL
  // =========================================================================
  function openShareModal(eventId) {
    const ev = state.eventTypes.find(e => e.id === eventId);
    if (!ev) return;

    state.shareEvent = ev;
    const permUrl = buildPublicBookUrl(ev.slug);
    const sep = permUrl.includes('?') ? '&' : '?';

    document.getElementById('share-link-input').value = permUrl;
    document.getElementById('single-use-link-input').value = `${permUrl}${sep}single_use=token_${Math.random().toString(36).substring(2, 9)}`;

    // Embed code
    const embedCode = `<!-- Widget de reserva de Reuniones -->\n<div class="reuniones-inline-widget" data-url="${permUrl}" style="min-width:320px;height:700px;"></div>\n<script type="text/javascript" src="${window.location.origin}/widget.js" async><\/script>`;
    document.getElementById('embed-code-textarea').value = embedCode;

    switchShareTab('permanent');
    openModal('modal-share');
  }

  function switchShareTab(tabKey) {
    document.querySelectorAll('[data-share-tab]').forEach(t => {
      t.classList.toggle('active', t.getAttribute('data-share-tab') === tabKey);
    });
    document.getElementById('tab-share-permanent').style.display = tabKey === 'permanent' ? 'block' : 'none';
    document.getElementById('tab-share-single-use').style.display = tabKey === 'single-use' ? 'block' : 'none';
    document.getElementById('tab-share-embed').style.display = tabKey === 'embed' ? 'block' : 'none';
  }

  document.querySelectorAll('[data-share-tab]').forEach(btn => {
    btn.addEventListener('click', () => switchShareTab(btn.getAttribute('data-share-tab')));
  });

  document.getElementById('btn-copy-share-link').addEventListener('click', () => {
    copyToClipboard(document.getElementById('share-link-input').value);
  });

  document.getElementById('btn-copy-single-use').addEventListener('click', () => {
    copyToClipboard(document.getElementById('single-use-link-input').value, 'Enlace de un solo uso copiado');
  });

  document.getElementById('btn-generate-new-single-use').addEventListener('click', () => {
    const permUrl = buildPublicBookUrl(state.shareEvent.slug);
    const sep = permUrl.includes('?') ? '&' : '?';
    const token = 'token_' + Math.random().toString(36).substring(2, 9);
    document.getElementById('single-use-link-input').value = `${permUrl}${sep}single_use=${token}`;
    showToast('Nuevo token de un solo uso generado');
  });

  document.getElementById('btn-copy-embed-code').addEventListener('click', () => {
    copyToClipboard(document.getElementById('embed-code-textarea').value, 'Código de inserción copiado');
  });

  // Toggle Card 3-dots Menu
  function toggleCardMenu(eventId, e) {
    e.stopPropagation();
    document.querySelectorAll('.card-dropdown-menu.show').forEach(m => {
      if (m.id !== `menu-${eventId}`) m.classList.remove('show');
    });
    const menu = document.getElementById(`menu-${eventId}`);
    if (menu) menu.classList.toggle('show');
  }

  // Copy Event Link from Card Button
  function copyEventLink(url, btnEl) {
    copyToClipboard(url);
    if (btnEl) {
      const origHtml = btnEl.innerHTML;
      btnEl.innerHTML = `✓ ¡Copiado!`;
      btnEl.style.borderColor = 'var(--accent-emerald)';
      btnEl.style.color = 'var(--accent-emerald)';
      setTimeout(() => {
        btnEl.innerHTML = origHtml;
        btnEl.style.borderColor = '';
        btnEl.style.color = '';
      }, 2000);
    }
  }

  // =========================================================================
  // VIEW SWITCHING & NAVIGATION
  // =========================================================================
  document.querySelectorAll('.nav-tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const viewKey = btn.getAttribute('data-view');
      switchView(viewKey);
    });
  });

  function switchView(viewKey) {
    // Route Guard: Unauthenticated browsers can ONLY access 'login' or 'public-landing'
    const adminViews = ['event-types', 'scheduled-events', 'availability', 'workflows'];
    if (adminViews.includes(viewKey) && state.auth.checked && !state.auth.authenticated) {
      viewKey = 'login';
    }

    document.querySelectorAll('.nav-tab-btn').forEach(b => {
      b.classList.toggle('active', b.getAttribute('data-view') === viewKey);
    });

    document.querySelectorAll('.app-view').forEach(v => {
      v.style.display = 'none';
      v.classList.remove('active');
    });

    const targetView = document.getElementById(`view-${viewKey}`);
    if (targetView) {
      targetView.style.display = 'block';
      targetView.classList.add('active');
    }

    state.activeAppView = viewKey;
    document.body.classList.toggle('auth-view', viewKey === 'login');
    document.body.classList.toggle('public-view', viewKey === 'public-landing');

    // Show/hide host admin preview banner on public page based on whether this browser is authenticated
    const adminBanner = document.getElementById('public-admin-banner');
    if (adminBanner) {
      adminBanner.style.display = (viewKey === 'public-landing' && state.auth.authenticated) ? 'flex' : 'none';
    }

    const profileDrop = document.getElementById('user-profile-dropdown');
    if (profileDrop) profileDrop.classList.remove('show');

    if (viewKey === 'scheduled-events') renderScheduledMeetings();
    if (viewKey === 'availability') renderWeeklySchedule();
    if (viewKey === 'public-landing') renderPublicLandingView();
  }

  // Brand home click
  document.getElementById('brand-home-btn').addEventListener('click', () => {
    window.location.hash = '';
    switchView('event-types');
  });

  // Create Button Dropdown
  const createBtn = document.getElementById('btn-create-event-type');
  const createMenu = document.getElementById('create-dropdown-menu');
  if (createBtn && createMenu) {
    createBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      createMenu.classList.toggle('show');
    });
  }

  document.querySelectorAll('[data-create-type]').forEach(btn => {
    btn.addEventListener('click', () => {
      openCreateModal(btn.getAttribute('data-create-type'));
    });
  });

  // Filter Chips (All, Active, Inactive)
  document.querySelectorAll('[data-filter]').forEach(chip => {
    chip.addEventListener('click', () => {
      document.querySelectorAll('[data-filter]').forEach(c => c.classList.remove('active'));
      chip.classList.add('active');
      state.currentFilter = chip.getAttribute('data-filter');
      renderEventTypes();
    });
  });

  // Search Input
  const searchInput = document.getElementById('filter-search-input');
  if (searchInput) {
    searchInput.addEventListener('input', (e) => {
      state.searchQuery = e.target.value;
      renderEventTypes();
    });
  }

  // View Mode Grid / List
  const btnGrid = document.getElementById('view-mode-grid');
  const btnList = document.getElementById('view-mode-list');
  if (btnGrid && btnList) {
    btnGrid.addEventListener('click', () => {
      btnGrid.classList.add('active');
      btnList.classList.remove('active');
      state.viewMode = 'grid';
      renderEventTypes();
    });
    btnList.addEventListener('click', () => {
      btnList.classList.add('active');
      btnGrid.classList.remove('active');
      state.viewMode = 'list';
      renderEventTypes();
    });
  }

  // Scheduled Filter Chips
  document.querySelectorAll('[data-scheduled-filter]').forEach(chip => {
    chip.addEventListener('click', () => {
      document.querySelectorAll('[data-scheduled-filter]').forEach(c => c.classList.remove('active'));
      chip.classList.add('active');
      state.scheduledFilter = chip.getAttribute('data-scheduled-filter');
      renderScheduledMeetings();
    });
  });

  // Cancel Meeting
  function cancelMeeting(meetingId) {
    const meet = state.scheduledMeetings.find(m => m.id === meetingId);
    if (!meet) return;

    if (confirm(`¿Deseas cancelar la reunión con ${meet.inviteeName}?`)) {
      meet.status = 'canceled';
      saveState();
      renderScheduledMeetings();
      showToast('Reunión cancelada');
    }
  }

  // Save Availability Settings
  document.getElementById('btn-save-availability').addEventListener('click', () => {
    state.timezone = document.getElementById('setting-timezone').value;
    saveState();
    showToast('Disponibilidad y horarios guardados con éxito');
  });

  function updateScheduleDayActive(dayIdx, isActive) {
    state.weeklySchedule[dayIdx].active = isActive;
    renderWeeklySchedule();
  }

  function updateScheduleTime(dayIdx, field, val) {
    state.weeklySchedule[dayIdx][field] = val;
  }

  // Theme Toggle
  const themeBtn = document.getElementById('theme-toggle-btn');
  if (themeBtn) {
    themeBtn.addEventListener('click', () => {
      const current = document.documentElement.getAttribute('data-theme') || 'light';
      const next = current === 'dark' ? 'light' : 'dark';
      document.documentElement.setAttribute('data-theme', next);
      localStorage.setItem('reuniones_theme', next);
      showToast(`Tema ${next === 'dark' ? 'oscuro' : 'claro'} activado`);
    });
  }

  // Top banner copy main page link
  document.getElementById('btn-copy-main-link').addEventListener('click', () => {
    copyToClipboard(buildPublicUserUrl(), 'Enlace de tu página principal copiado');
  });

  // =========================================================================
  // ORIGINAL CALENDLY PUBLIC PROFILE & INLINE SPLIT-SCREEN BOOKING PAGE
  // =========================================================================
  function goToPublicLanding() {
    document.querySelectorAll('.modal-overlay.show').forEach(m => m.classList.remove('show'));
    const slug = getHostSlug();
    const ht = state.auth?.publicHostToken || '';
    window.location.hash = `#/user/${slug}${ht ? '?ht=' + encodeURIComponent(ht) : ''}`;
    showPublicDirectoryMode();
    switchView('public-landing');
  }

  function showPublicDirectoryMode() {
    const dirPane = document.getElementById('public-directory-pane');
    const bookPane = document.getElementById('public-booking-pane');
    if (dirPane) dirPane.style.display = 'flex';
    if (bookPane) bookPane.style.display = 'none';
    renderPublicLandingView();
  }

  function renderPublicLandingView() {
    updateHostProfileUI();
    const list = document.getElementById('public-events-list-container');
    const pill = document.getElementById('public-cal-pill');
    const pillText = document.getElementById('public-cal-pill-text');
    const adminBanner = document.getElementById('public-admin-banner');
    if (adminBanner) {
      adminBanner.style.display = state.auth.authenticated ? 'flex' : 'none';
    }
    if (!list) return;

    const isPubConnected = (state.publicHost && state.publicHost.connected) || (state.googleCalendar && state.googleCalendar.connected);
    if (isPubConnected) {
      if (pill) pill.style.display = 'inline-flex';
      if (pillText) pillText.textContent = `Disponibilidad verificada en tiempo real con Google Calendar`;
    } else {
      if (pill) pill.style.display = 'none';
    }

    const activeEvents = state.eventTypes.filter(e => e.active);
    if (activeEvents.length === 0) {
      list.innerHTML = `<p class="form-hint" style="grid-column: 1 / -1; text-align: center; padding: 40px 0;">No hay tipos de reunión activos actualmente.</p>`;
      return;
    }

    list.innerHTML = activeEvents.map(ev => `
      <div class="calendly-public-event-card" onclick="window.ReunionesApp.openPublicEventBooking('${ev.id}')">
        <div>
          <div class="calendly-public-event-top">
            <div class="calendly-public-event-title-wrap">
              <span class="calendly-event-color-dot" style="background: ${ev.color || 'var(--primary)'};"></span>
              <h3 class="calendly-public-event-name">${escapeHtml(ev.name)}</h3>
            </div>
            <span class="calendly-public-event-arrow">&rarr;</span>
          </div>
          <p class="calendly-public-event-desc">${escapeHtml(ev.description || 'Agenda una sesión en el horario disponible que mejor te acomode.')}</p>
        </div>
        <div class="calendly-public-event-meta">
          <span>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <circle cx="12" cy="12" r="10"></circle>
              <polyline points="12 6 12 12 16 14"></polyline>
            </svg>
            ${ev.duration} min
          </span>
          <span>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <polygon points="23 7 16 12 23 17 23 7"></polygon>
              <rect x="1" y="5" width="15" height="14" rx="2" ry="2"></rect>
            </svg>
            ${escapeHtml(ev.location)}
          </span>
        </div>
      </div>
    `).join('');
  }

  function openPublicEventBooking(eventIdOrSlug) {
    const ev = state.eventTypes.find(e => e.id === eventIdOrSlug || e.slug === eventIdOrSlug) || state.eventTypes[0];
    if (!ev) return;

    state.bookingEvent = ev;
    state.selectedDate = null;
    state.selectedSlot = null;
    state.currentCalDate = new Date();

    // Ensure we are on the standalone public-landing view
    if (state.activeAppView !== 'public-landing') {
      switchView('public-landing');
    }

    const dirPane = document.getElementById('public-directory-pane');
    const bookPane = document.getElementById('public-booking-pane');
    if (dirPane) dirPane.style.display = 'none';
    if (bookPane) bookPane.style.display = 'block';

    // Preserve host and ht query parameters in the hash when opening a specific event
    const ctx = getPublicRouteContext();
    const params = new URLSearchParams();
    if (ctx.hostSlug) params.set('host', ctx.hostSlug);
    if (ctx.hostToken) params.set('ht', ctx.hostToken);
    const qs = params.toString();
    const targetHash = `#/book/${ev.slug}${qs ? '?' + qs : ''}`;
    if (window.location.hash !== targetHash) {
      history.replaceState(null, '', window.location.pathname + targetHash);
    }

    // Reset steps inside inline split view
    const stepCal = document.getElementById('pub-step-calendar');
    const stepForm = document.getElementById('pub-step-form');
    const stepSuccess = document.getElementById('pub-step-success');
    const summaryRow = document.getElementById('pub-selected-datetime-summary');
    if (stepCal) stepCal.style.display = 'flex';
    if (stepForm) stepForm.style.display = 'none';
    if (stepSuccess) stepSuccess.style.display = 'none';
    if (summaryRow) summaryRow.style.display = 'none';

    // Populate Left Column details using the Public Host's identity
    const hostName = getPublicHostName();
    const initials = getInitials(hostName);
    const mySlug = state.auth && state.auth.authenticated && state.auth.user ? getHostSlug(state.auth.user.name) : '';
    const isOwnPage = mySlug && mySlug === getHostSlug(hostName);
    const picture = isOwnPage && state.auth.user ? state.auth.user.picture : null;
    renderAvatarElement(document.getElementById('pub-book-host-avatar'), initials, picture, hostName);
    const hostEl = document.getElementById('pub-book-host-name');
    if (hostEl) hostEl.textContent = hostName;

    const titleEl = document.getElementById('pub-book-event-title');
    const durEl = document.getElementById('pub-book-event-duration');
    const locEl = document.getElementById('pub-book-event-location');
    const descEl = document.getElementById('pub-book-event-desc');
    if (titleEl) titleEl.textContent = ev.name;
    if (durEl) durEl.textContent = `${ev.duration} min`;
    if (locEl) locEl.textContent = `${ev.location} (Los detalles de la conferencia web se proporcionan en la confirmación)`;
    if (descEl) descEl.textContent = ev.description || 'Agenda una reunión en el horario disponible que mejor te acomode.';

    renderPublicCalendar();
    renderPublicTimeSlots();
  }

  function renderPublicCalendar() {
    const monthLabel = document.getElementById('pub-calendar-month-label');
    const grid = document.getElementById('pub-calendar-days-grid');
    if (!grid || !monthLabel) return;

    const year = state.currentCalDate.getFullYear();
    const month = state.currentCalDate.getMonth();

    const monthNames = [
      'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
      'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'
    ];
    monthLabel.textContent = `${monthNames[month]} ${year}`;

    const dayHeaders = ['LUN', 'MAR', 'MIÉ', 'JUE', 'VIE', 'SÁB', 'DOM'];
    let html = dayHeaders.map(h => `<div class="cal-day-header">${h}</div>`).join('');

    const firstDayIndex = new Date(year, month, 1).getDay();
    const startDay = (firstDayIndex + 6) % 7;
    const totalDays = new Date(year, month + 1, 0).getDate();

    for (let i = 0; i < startDay; i++) {
      html += `<div class="cal-day-cell empty"></div>`;
    }

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    for (let day = 1; day <= totalDays; day++) {
      const cellDate = new Date(year, month, day);
      cellDate.setHours(0, 0, 0, 0);

      const isPast = cellDate < today;
      const dayOfWeek = (cellDate.getDay() + 6) % 7;
      const daySchedule = state.weeklySchedule[dayOfWeek];
      const isDayOff = !daySchedule || !daySchedule.active;

      const isDisabled = isPast || isDayOff;
      const isSelected = state.selectedDate &&
        state.selectedDate.getFullYear() === year &&
        state.selectedDate.getMonth() === month &&
        state.selectedDate.getDate() === day;

      const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;

      html += `
        <div class="cal-day-cell ${isDisabled ? 'disabled' : ''} ${isSelected ? 'selected' : ''}"
             data-date="${dateStr}"
             onclick="window.ReunionesApp.selectPublicBookingDate('${dateStr}', this)">
          ${day}
        </div>
      `;
    }

    grid.innerHTML = html;
  }

  function selectPublicBookingDate(dateStr, cellEl) {
    document.querySelectorAll('#pub-calendar-days-grid .cal-day-cell.selected').forEach(c => c.classList.remove('selected'));
    if (cellEl) cellEl.classList.add('selected');

    const [y, m, d] = dateStr.split('-').map(Number);
    state.selectedDate = new Date(y, m - 1, d);
    state.selectedSlot = null;

    renderPublicTimeSlots();
  }

  function renderPublicTimeSlots() {
    const list = document.getElementById('pub-time-slots-list');
    const headerDate = document.getElementById('pub-selected-date-label');
    if (!list || !headerDate) return;

    if (!state.selectedDate) {
      headerDate.textContent = 'Selecciona un día';
      list.innerHTML = `<p class="form-hint" style="text-align: center; margin-top: 30px;">Haz clic en una fecha disponible del calendario para ver los horarios.</p>`;
      return;
    }

    const days = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];
    const months = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
    headerDate.textContent = `${days[state.selectedDate.getDay()]}, ${state.selectedDate.getDate()} de ${months[state.selectedDate.getMonth()]}`;

    const dayOfWeek = (state.selectedDate.getDay() + 6) % 7;
    const schedule = state.weeklySchedule[dayOfWeek];
    if (!schedule || !schedule.active) {
      list.innerHTML = `<p class="form-hint" style="text-align: center; margin-top: 20px;">No hay horarios disponibles para este día.</p>`;
      return;
    }

    const duration = (state.bookingEvent && state.bookingEvent.duration) || 15;
    const [startH, startM] = schedule.start.split(':').map(Number);
    const [endH, endM] = schedule.end.split(':').map(Number);

    const startMinutes = startH * 60 + startM;
    const endMinutes = endH * 60 + endM;

    const slots = [];
    for (let m = startMinutes; m + duration <= endMinutes; m += duration >= 30 ? 30 : 15) {
      const h = Math.floor(m / 60);
      const min = m % 60;
      const timeStr = `${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}`;
      slots.push(timeStr);
    }

    const selYear = state.selectedDate.getFullYear();
    const selMonth = state.selectedDate.getMonth();
    const selDay = state.selectedDate.getDate();

    const hostScheduled = Array.isArray(state.publicHost?.scheduledMeetings) && state.publicHost.scheduledMeetings.length > 0
      ? state.publicHost.scheduledMeetings
      : state.scheduledMeetings;

    const hostBusyEvents = Array.isArray(state.publicHost?.events) && state.publicHost.events.length > 0
      ? state.publicHost.events
      : (state.googleCalendar.connected ? (state.googleCalendar.events || []) : []);

    list.innerHTML = slots.map(timeStr => {
      const isSelected = state.selectedSlot === timeStr;
      const [slotH, slotM] = timeStr.split(':').map(Number);
      const slotStart = new Date(selYear, selMonth, selDay, slotH, slotM, 0, 0);
      const slotEnd = new Date(slotStart.getTime() + duration * 60000);

      const meetingConflict = hostScheduled.find(m => {
        if (m.status !== 'upcoming') return false;
        const mStart = new Date(m.dateTime);
        const mEnd = new Date(mStart.getTime() + (m.duration || 15) * 60000);
        return slotStart < mEnd && slotEnd > mStart;
      });

      const gcalConflict = hostBusyEvents.find(ev => {
        if (!ev.start || !ev.end) return false;
        const evStart = new Date(ev.start);
        const evEnd = new Date(ev.end);
        return slotStart < evEnd && slotEnd > evStart;
      });

      if (meetingConflict || gcalConflict) {
        return `
          <div class="slot-item-wrapper">
            <button type="button" class="slot-btn slot-busy" disabled title="Horario ocupado en el calendario del anfitrión">
              ${timeStr} <span class="slot-busy-indicator">Ocupado</span>
            </button>
          </div>
        `;
      }

      return `
        <div class="slot-item-wrapper">
          <button type="button" class="slot-btn ${isSelected ? 'selected' : ''}" onclick="window.ReunionesApp.choosePublicSlot('${timeStr}')">
            ${timeStr}
          </button>
          ${isSelected ? `
            <button type="button" class="slot-confirm-btn" onclick="window.ReunionesApp.proceedToPublicBookingForm('${timeStr}')">
              Siguiente
            </button>
          ` : ''}
        </div>
      `;
    }).join('');
  }

  function choosePublicSlot(timeStr) {
    state.selectedSlot = timeStr;
    renderPublicTimeSlots();
  }

  function proceedToPublicBookingForm(timeStr) {
    state.selectedSlot = timeStr;
    const stepCal = document.getElementById('pub-step-calendar');
    const stepForm = document.getElementById('pub-step-form');
    if (stepCal) stepCal.style.display = 'none';
    if (stepForm) stepForm.style.display = 'flex';

    const days = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'];
    const months = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];
    const dateFormatted = `${timeStr}, ${days[state.selectedDate.getDay()]}, ${state.selectedDate.getDate()} de ${months[state.selectedDate.getMonth()]} de ${state.selectedDate.getFullYear()}`;

    const summaryRow = document.getElementById('pub-selected-datetime-summary');
    const summaryText = document.getElementById('pub-selected-datetime-text');
    if (summaryRow) summaryRow.style.display = 'flex';
    if (summaryText) summaryText.textContent = dateFormatted;
  }

  // Public Back Button (Step 2 -> Step 1, or Step 1 -> Host Profile Directory)
  const btnPubBack = document.getElementById('btn-pub-back-to-directory');
  if (btnPubBack) {
    btnPubBack.addEventListener('click', () => {
      const stepForm = document.getElementById('pub-step-form');
      const stepCal = document.getElementById('pub-step-calendar');
      const summaryRow = document.getElementById('pub-selected-datetime-summary');
      if (stepForm && stepForm.style.display !== 'none') {
        stepForm.style.display = 'none';
        if (stepCal) stepCal.style.display = 'flex';
        if (summaryRow) summaryRow.style.display = 'none';
        return;
      }
      const ctx = getPublicRouteContext();
      const slug = ctx.hostSlug || getHostSlug(getPublicHostName());
      const ht = ctx.hostToken || state.auth?.publicHostToken || '';
      window.location.hash = `#/user/${slug}${ht ? '?ht=' + encodeURIComponent(ht) : ''}`;
      showPublicDirectoryMode();
    });
  }

  const btnScheduleAnother = document.getElementById('btn-pub-schedule-another');
  if (btnScheduleAnother) {
    btnScheduleAnother.addEventListener('click', () => {
      const ctx = getPublicRouteContext();
      const slug = ctx.hostSlug || getHostSlug(getPublicHostName());
      const ht = ctx.hostToken || state.auth?.publicHostToken || '';
      window.location.hash = `#/user/${slug}${ht ? '?ht=' + encodeURIComponent(ht) : ''}`;
      showPublicDirectoryMode();
    });
  }

  const btnToggleGuests = document.getElementById('btn-pub-toggle-guests');
  if (btnToggleGuests) {
    btnToggleGuests.addEventListener('click', () => {
      const box = document.getElementById('pub-guests-box');
      if (box) {
        box.style.display = box.style.display === 'none' ? 'block' : 'none';
        btnToggleGuests.style.display = 'none';
      }
    });
  }

  const pubPrevMonth = document.getElementById('pub-cal-prev-month');
  const pubNextMonth = document.getElementById('pub-cal-next-month');
  if (pubPrevMonth) {
    pubPrevMonth.addEventListener('click', () => {
      state.currentCalDate.setMonth(state.currentCalDate.getMonth() - 1);
      renderPublicCalendar();
    });
  }
  if (pubNextMonth) {
    pubNextMonth.addEventListener('click', () => {
      state.currentCalDate.setMonth(state.currentCalDate.getMonth() + 1);
      renderPublicCalendar();
    });
  }

  const pubTzSelect = document.getElementById('pub-timezone-select');
  if (pubTzSelect) {
    pubTzSelect.addEventListener('change', () => {
      const label = pubTzSelect.options[pubTzSelect.selectedIndex].text;
      const metaTz = document.getElementById('pub-book-tz-meta');
      if (metaTz) metaTz.textContent = label;
    });
  }

  const pubBookingForm = document.getElementById('pub-form-invitee-booking');
  if (pubBookingForm) {
    pubBookingForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      if (!state.selectedDate || !state.selectedSlot || !state.bookingEvent) return;

      const submitBtn = pubBookingForm.querySelector('button[type="submit"]');
      const origBtnText = submitBtn ? submitBtn.textContent : 'Programar evento';
      if (submitBtn) {
        submitBtn.disabled = true;
        submitBtn.textContent = '⏳ Agendando en el calendario...';
      }

      try {
        const name = document.getElementById('pub-invitee-name').value.trim();
        const email = document.getElementById('pub-invitee-email').value.trim();
        const phone = document.getElementById('pub-invitee-phone').value.trim();
        const notes = document.getElementById('pub-invitee-notes').value.trim();

        const y = state.selectedDate.getFullYear();
        const m = String(state.selectedDate.getMonth() + 1).padStart(2, '0');
        const d = String(state.selectedDate.getDate()).padStart(2, '0');
        const dateTimeIso = `${y}-${m}-${d}T${state.selectedSlot}:00`;
        const resolvedTz = (Intl.DateTimeFormat && Intl.DateTimeFormat().resolvedOptions().timeZone) || 'America/Santiago';

        const newMeeting = {
          id: 'meet-' + Date.now(),
          eventTypeId: state.bookingEvent.id,
          eventTitle: state.bookingEvent.name,
          eventColor: state.bookingEvent.color,
          duration: state.bookingEvent.duration,
          location: state.bookingEvent.location,
          locationUrl: 'https://meet.google.com/' + Math.random().toString(36).substring(2, 5) + '-' + Math.random().toString(36).substring(2, 6) + '-' + Math.random().toString(36).substring(2, 5),
          inviteeName: name,
          inviteeEmail: email,
          inviteePhone: phone,
          inviteeNotes: notes,
          dateTime: dateTimeIso,
          timeZone: resolvedTz,
          status: 'upcoming'
        };

        const bookResult = await submitBookingToServer(newMeeting);

        state.scheduledMeetings.unshift(newMeeting);
        saveState();

        document.getElementById('pub-step-form').style.display = 'none';
        document.getElementById('pub-step-success').style.display = 'flex';

        const hostName = getPublicHostName();
        document.getElementById('pub-success-email').textContent = email;
        document.getElementById('pub-success-title').textContent = state.bookingEvent.name;
        document.getElementById('pub-success-host').textContent = hostName;
        document.getElementById('pub-success-datetime').textContent = document.getElementById('pub-selected-datetime-text').textContent;
        document.getElementById('pub-success-location').textContent = `${state.bookingEvent.location} (${newMeeting.locationUrl})`;

        const startObj = new Date(dateTimeIso);
        const endObj = new Date(startObj.getTime() + state.bookingEvent.duration * 60000);
        const pad = (n) => String(n).padStart(2, '0');
        const gDate = (dt) => `${dt.getUTCFullYear()}${pad(dt.getUTCMonth() + 1)}${pad(dt.getUTCDate())}T${pad(dt.getUTCHours())}${pad(dt.getUTCMinutes())}00Z`;

        const gCalUrl = `https://calendar.google.com/calendar/render?action=TEMPLATE&text=${encodeURIComponent(newMeeting.eventTitle + ' con ' + hostName)}&dates=${gDate(startObj)}/${gDate(endObj)}&details=${encodeURIComponent((newMeeting.inviteeNotes || 'Reunión programada') + '\nInvitado: ' + name + ' (' + email + ')')}&location=${encodeURIComponent(newMeeting.locationUrl || newMeeting.location)}&add=${encodeURIComponent(email)}`;
        const outCalUrl = `https://outlook.live.com/calendar/0/deeplink/compose?path=/calendar/action/compose&rru=addevent&subject=${encodeURIComponent(newMeeting.eventTitle + ' con ' + hostName)}&startdt=${startObj.toISOString()}&enddt=${endObj.toISOString()}&body=${encodeURIComponent(newMeeting.inviteeNotes || 'Reunión programada')}&location=${encodeURIComponent(newMeeting.locationUrl || newMeeting.location)}`;

        const btnG = document.getElementById('pub-btn-add-gcal');
        const btnO = document.getElementById('pub-btn-add-outlook');
        if (btnG) {
          btnG.href = (bookResult && bookResult.googleEventHtmlLink) ? bookResult.googleEventHtmlLink : gCalUrl;
          btnG.textContent = (bookResult && bookResult.googleEventCreated)
            ? '✓ Agendado en Google Calendar (Ver evento)'
            : '📅 Guardar en mi Google Calendar';
        }
        if (btnO) btnO.href = outCalUrl;

        const btnIcs = document.getElementById('pub-btn-download-ics');
        if (btnIcs) btnIcs.onclick = () => downloadIcsFile(newMeeting);

        renderScheduledMeetings();

        if (bookResult && bookResult.googleEventCreated) {
          showToast('¡Reunión agendada automáticamente en Google Calendar!', '🎉');
        } else {
          showToast('¡Reunión registrada! Abriendo Google Calendar para confirmar en tu agenda...', '🎉');
          window.open(gCalUrl, '_blank', 'noopener,noreferrer');
        }
      } finally {
        if (submitBtn) {
          submitBtn.disabled = false;
          submitBtn.textContent = origBtnText;
        }
      }
    });
  }

  // Public Landing Button in Header & Login Topbar
  document.getElementById('btn-public-landing-view').addEventListener('click', (e) => {
    e.preventDefault();
    goToPublicLanding();
  });

  const authPublicBtn = document.getElementById('btn-auth-view-public');
  if (authPublicBtn) {
    authPublicBtn.addEventListener('click', (e) => {
      e.preventDefault();
      goToPublicLanding();
    });
  }

  // Return to Admin Button in Public View
  const returnAdminBtn = document.getElementById('btn-return-to-admin');
  if (returnAdminBtn) {
    returnAdminBtn.addEventListener('click', () => {
      window.location.hash = '';
      switchView('event-types');
    });
  }

  // Copy public page URL
  const copyPubBtn = document.getElementById('btn-copy-public-page-url');
  if (copyPubBtn) {
    copyPubBtn.addEventListener('click', () => {
      copyToClipboard(buildPublicUserUrl(), 'Enlace de tu página pública copiado');
    });
  }

  // Calendar Month Navigation
  document.getElementById('cal-prev-month').addEventListener('click', () => {
    state.currentCalDate.setMonth(state.currentCalDate.getMonth() - 1);
    renderCalendar();
  });
  document.getElementById('cal-next-month').addEventListener('click', () => {
    state.currentCalDate.setMonth(state.currentCalDate.getMonth() + 1);
    renderCalendar();
  });

  // Back to calendar from form
  document.getElementById('btn-back-to-calendar').addEventListener('click', () => {
    document.getElementById('booking-step-form').style.display = 'none';
    document.getElementById('booking-step-calendar').style.display = 'block';
  });

  // =========================================================================
  // GOOGLE CALENDAR INTEGRATION LOGIC
  // =========================================================================
  function switchGCalTab(tabKey) {
    document.querySelectorAll('[data-gcal-tab]').forEach(t => {
      t.classList.toggle('active', t.getAttribute('data-gcal-tab') === tabKey);
    });
    const tabs = {
      'sync': 'tab-gcal-sync',
      'feed': 'tab-gcal-feed',
      'oauth': 'tab-gcal-oauth'
    };
    Object.entries(tabs).forEach(([k, id]) => {
      const el = document.getElementById(id);
      if (el) el.style.display = k === tabKey ? 'block' : 'none';
    });
  }

  document.querySelectorAll('[data-gcal-tab]').forEach(btn => {
    btn.addEventListener('click', () => switchGCalTab(btn.getAttribute('data-gcal-tab')));
  });

  async function fetchPublicHostCalendarStatus() {
    const ctx = getPublicRouteContext();
    const params = new URLSearchParams({ public: '1' });
    if (ctx.hostSlug) params.set('slug', ctx.hostSlug);
    if (ctx.hostToken) params.set('ht', ctx.hostToken);

    try {
      const res = await fetch(`/api/calendar/status?${params.toString()}`, {
        method: 'GET',
        credentials: 'same-origin',
        cache: 'no-store'
      });
      if (!res.ok) return;
      const data = await res.json();
      if (data.success) {
        state.publicHost = {
          connected: !!data.connected,
          hostPublicName: data.hostPublicName || (ctx.hostSlug ? humanizeSlug(ctx.hostSlug) : null),
          hostSlug: data.hostSlug || ctx.hostSlug || null,
          autoBlock: data.autoBlock !== false,
          events: Array.isArray(data.events) ? data.events : [],
          scheduledMeetings: Array.isArray(data.scheduledMeetings) ? data.scheduledMeetings : []
        };
        updateHostProfileUI();
        if (state.activeAppView === 'public-landing') {
          renderPublicLandingView();
          if (state.selectedDate) {
            renderPublicTimeSlots();
          }
        }
      }
    } catch (e) {
      console.warn('Could not fetch public host calendar status:', e);
    }
  }

  async function fetchCalendarStatus() {
    if (isPublicRoute()) {
      await fetchPublicHostCalendarStatus();
    }

    if (!state.auth.authenticated || !state.auth.user) {
      resetCalendarStateInMemory();
      updateGoogleCalendarUI();
      return;
    }

    const userKey = getCurrentUserStorageKey();
    const localMeta = loadUserLocalCalendarMeta(userKey);

    try {
      const res = await fetch('/api/calendar/status', {
        method: 'GET',
        credentials: 'same-origin',
        cache: 'no-store'
      });
      if (!res.ok) return;
      const data = await res.json();
      if (data.success) {
        if (data.publicHostToken) {
          state.auth.publicHostToken = data.publicHostToken;
        }
        // If server is disconnected ONLY because of a serverless cold start,
        // restore ONLY if THIS specific user had previously connected in this browser.
        if (!data.connected && localMeta && localMeta.connected && localMeta.userKey === userKey) {
          state.googleCalendar = {
            connected: true,
            calendarName: localMeta.calendarName || `Google Calendar (${state.auth.user.email})`,
            hostPublicName: state.auth.user.name || null,
            icalUrl: localMeta.icalUrl || '',
            lastSync: localMeta.lastSync || null,
            autoBlock: localMeta.autoBlock !== false,
            eventCount: Array.isArray(localMeta.events) ? localMeta.events.length : 0,
            events: Array.isArray(localMeta.events) ? localMeta.events : [],
            isDemo: !!localMeta.isDemo,
            syncMode: localMeta.syncMode || null
          };
        } else {
          state.googleCalendar = {
            connected: !!data.connected,
            calendarName: data.connected ? (data.calendarName || null) : null,
            hostPublicName: data.hostPublicName || state.auth.user.name || null,
            icalUrl: data.connected ? (data.icalUrl || '') : '',
            lastSync: data.connected ? data.lastSync : null,
            autoBlock: data.autoBlock !== false,
            eventCount: data.connected ? (data.eventCount || (data.events || []).length) : 0,
            events: data.connected ? (data.events || []) : [],
            isDemo: data.connected ? !!data.isDemo : false,
            syncMode: data.connected ? (data.syncMode || null) : null
          };
          if (state.googleCalendar.connected) {
            saveUserLocalCalendarMeta({
              userKey,
              ...state.googleCalendar
            });
          }
        }
        updateGoogleCalendarUI();
      }
    } catch (e) {
      console.warn('Could not fetch calendar status from server:', e);
    }
  }

  function updateGoogleCalendarUI() {
    const isConn = !!state.googleCalendar.connected;
    updateHostProfileUI();

    // Show/hide 1-click Google OAuth calendar connect box if logged in with Google
    const oauthDirectBox = document.getElementById('gcal-oauth-direct-box');
    if (oauthDirectBox) {
      const isGoogleUser = !!(state.auth && state.auth.authenticated && state.auth.user && state.auth.user.provider === 'google');
      oauthDirectBox.style.display = isGoogleUser ? 'block' : 'none';
    }

    // Keep iCal input isolated per user
    const urlInput = document.getElementById('input-gcal-ical-url');
    if (urlInput) {
      urlInput.value = isConn ? (state.googleCalendar.icalUrl || '') : '';
    }
    
    // Header Badge
    const headerBadge = document.getElementById('header-gcal-badge');
    if (headerBadge) {
      headerBadge.className = `header-gcal-status ${isConn ? 'connected' : 'disconnected'}`;
      headerBadge.textContent = isConn ? 'Sincronizado' : 'Conectar';
    }

    // Availability view card
    const availBadge = document.getElementById('avail-gcal-status-badge');
    const availDesc = document.getElementById('avail-gcal-desc');
    const availSyncBtn = document.getElementById('btn-avail-sync-now');
    if (availBadge) {
      availBadge.className = `status-pill-badge ${isConn ? 'connected' : 'disconnected'}`;
      availBadge.textContent = isConn ? 'Sincronizado' : 'Desconectado';
    }
    if (availSyncBtn) {
      availSyncBtn.style.display = isConn ? 'inline-flex' : 'none';
    }
    if (availDesc) {
      if (isConn) {
        availDesc.innerHTML = `Sincronizado con <strong>${state.googleCalendar.calendarName || 'Google Calendar'}</strong> (${state.googleCalendar.eventCount} eventos bloqueantes). <a href="https://calendar.google.com/calendar/u/0/r" target="_blank" rel="noopener noreferrer" style="color: var(--primary); text-decoration: underline;">Abrir calendar.google.com/calendar/u/0/r ↗</a>`;
      } else {
        availDesc.innerHTML = `Cada usuario tiene su propia sincronización independiente. Conecta tu Google Calendar para bloquear tus horarios ocupados automáticamente.`;
      }
    }

    // Modal Status Panel
    const panel = document.getElementById('gcal-connected-panel');
    const nameEl = document.getElementById('gcal-display-name');
    const countEl = document.getElementById('gcal-display-count');
    const previewList = document.getElementById('gcal-events-preview-list');

    if (panel) {
      panel.style.display = isConn ? 'block' : 'none';
    }
    if (nameEl) nameEl.textContent = state.googleCalendar.calendarName || 'Google Calendar';
    if (countEl) countEl.textContent = `${state.googleCalendar.eventCount || (state.googleCalendar.events || []).length} eventos activos`;

    if (previewList && isConn) {
      const evs = (state.googleCalendar.events || []).slice(0, 5);
      if (evs.length === 0) {
        previewList.innerHTML = `<span style="font-size: 0.8125rem; color: var(--text-muted);">No hay eventos futuros próximos en el calendario.</span>`;
      } else {
        previewList.innerHTML = evs.map(ev => {
          const s = new Date(ev.start);
          const timeStr = `${s.getDate()}/${s.getMonth()+1} ${String(s.getHours()).padStart(2, '0')}:${String(s.getMinutes()).padStart(2, '0')}`;
          return `
            <div class="gcal-event-preview-item">
              <span class="gcal-event-preview-title" title="${ev.summary || 'Evento'}">${ev.summary || '(Sin título)'}</span>
              <span class="gcal-event-preview-time">${timeStr}</span>
            </div>
          `;
        }).join('');
      }
    }

    // Feed URL in Tab 2
    const feedInput = document.getElementById('gcal-feed-url-input');
    if (feedInput) {
      feedInput.value = `${window.location.origin}/api/calendar/feed.ics`;
    }
  }

  async function connectGoogleCalendar(icalUrl, isDemo = false, useGoogleOAuth = false) {
    const autoBlock = document.getElementById('chk-gcal-autoblock') ? document.getElementById('chk-gcal-autoblock').checked : true;
    try {
      showToast('Conectando a Google Calendar...', '⏳');
      const res = await fetch('/api/calendar/connect', {
        method: 'POST',
        credentials: 'same-origin',
        cache: 'no-store',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ icalUrl, autoBlock, isDemo, useGoogleOAuth })
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        if (data.isBrowserUrl) {
          alert(data.error);
        } else {
          showToast(data.error || 'Error al conectar Google Calendar', '⚠️');
        }
        return false;
      }

      const syncMode = useGoogleOAuth ? 'google_oauth' : (isDemo ? 'demo' : 'ical');
      state.googleCalendar = {
        connected: true,
        calendarName: data.calendarName,
        hostPublicName: (state.auth.user && state.auth.user.name) || state.googleCalendar.hostPublicName || null,
        icalUrl: data.icalUrl || icalUrl || '',
        lastSync: new Date().toISOString(),
        autoBlock: autoBlock,
        eventCount: typeof data.count === 'number' ? data.count : (data.events || []).length,
        events: data.events || [],
        isDemo: !!isDemo,
        syncMode
      };
      saveUserLocalCalendarMeta({
        userKey: getCurrentUserStorageKey(),
        ...state.googleCalendar
      });
      updateGoogleCalendarUI();
      showToast(`¡Conectado exitosamente con ${data.calendarName}!`, '🎉');
      if (state.selectedDate) {
        renderTimeSlots();
        renderPublicTimeSlots();
      }
      return true;
    } catch (err) {
      showToast('Error de red al conectar', '⚠️');
      return false;
    }
  }

  async function syncGoogleCalendarNow() {
    const syncBtn = document.getElementById('btn-gcal-sync-now');
    const availSyncBtn = document.getElementById('btn-avail-sync-now');
    if (syncBtn) {
      syncBtn.disabled = true;
      syncBtn.textContent = '↻ Sincronizando...';
    }
    if (availSyncBtn) {
      availSyncBtn.disabled = true;
      availSyncBtn.textContent = '↻ Sincronizando...';
    }

    try {
      showToast('Sincronizando eventos con Google Calendar...', '↻');
      // Also make sure local scheduled meetings are pushed to server before syncing
      await syncMeetingsToServer();

      const urlInput = document.getElementById('input-gcal-ical-url');
      const inputIcal = urlInput && urlInput.value ? urlInput.value.trim() : '';

      const res = await fetch('/api/calendar/sync-now', {
        method: 'POST',
        credentials: 'same-origin',
        cache: 'no-store',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          icalUrl: inputIcal || state.googleCalendar.icalUrl || '',
          isDemo: !!state.googleCalendar.isDemo,
          syncMode: state.googleCalendar.syncMode || null
        })
      });
      const data = await res.json();
      if (res.ok && data.success) {
        const events = Array.isArray(data.events) ? data.events : [];
        state.googleCalendar.connected = true;
        if (data.calendarName) state.googleCalendar.calendarName = data.calendarName;
        state.googleCalendar.events = events;
        state.googleCalendar.eventCount = typeof data.count === 'number' ? data.count : events.length;
        state.googleCalendar.lastSync = new Date().toISOString();
        saveUserLocalCalendarMeta({
          userKey: getCurrentUserStorageKey(),
          ...state.googleCalendar
        });
        updateGoogleCalendarUI();
        if (state.selectedDate) {
          renderTimeSlots();
          renderPublicTimeSlots();
        }
        if (data.warning && data.source === 'local_fallback') {
          showToast(`Sincronizado (${state.googleCalendar.eventCount} eventos). Nota: habilita Google Calendar API en Google Cloud Console o usa el enlace iCal para leer eventos privados externos.`, 'ℹ️');
        } else {
          showToast(`Google Calendar sincronizado al día (${state.googleCalendar.eventCount} eventos activos)`, '✓');
        }
      } else {
        showToast(data.error || 'Error al sincronizar', '⚠️');
      }
    } catch (e) {
      showToast('Error al actualizar calendario: ' + e.message, '⚠️');
    } finally {
      if (syncBtn) {
        syncBtn.disabled = false;
        syncBtn.textContent = '↻ Sincronizar ahora';
      }
      if (availSyncBtn) {
        availSyncBtn.disabled = false;
        availSyncBtn.textContent = '↻ Sincronizar eventos';
      }
    }
  }

  async function disconnectGoogleCalendar() {
    if (!confirm('¿Deseas desconectar Google Calendar? Los horarios ocupados ya no se bloquearán.')) return;
    try {
      const res = await fetch('/api/calendar/disconnect', {
        method: 'POST',
        credentials: 'same-origin',
        cache: 'no-store'
      });
      const data = await res.json();
      if (data.success) {
        clearUserLocalCalendarMeta();
        resetCalendarStateInMemory();
        updateGoogleCalendarUI();
        if (state.selectedDate) {
          renderTimeSlots();
          renderPublicTimeSlots();
        }
        showToast('Google Calendar desconectado para este usuario', 'ℹ️');
      }
    } catch (e) {
      showToast('Error al desconectar', '⚠️');
    }
  }

  async function syncMeetingsToServer() {
    try {
      await fetch('/api/calendar/sync-meetings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ meetings: state.scheduledMeetings })
      });
    } catch (e) {
      console.warn('Failed to sync meetings to server iCal feed:', e);
    }
  }

  function openGoogleCalModal() {
    openModal('modal-google-calendar');
    updateGoogleCalendarUI();
  }

  // Google Calendar Listeners
  const headerGcalBtn = document.getElementById('btn-open-google-cal-modal');
  if (headerGcalBtn) headerGcalBtn.addEventListener('click', openGoogleCalModal);

  const availConfigGcalBtn = document.getElementById('btn-avail-config-gcal');
  if (availConfigGcalBtn) availConfigGcalBtn.addEventListener('click', openGoogleCalModal);

  const availOpenGcalBtn = document.getElementById('btn-avail-open-gcal');
  if (availOpenGcalBtn) {
    availOpenGcalBtn.addEventListener('click', () => {
      window.open('https://calendar.google.com/calendar/u/0/r', '_blank');
    });
  }

  const connectSubmitBtn = document.getElementById('btn-gcal-connect-submit');
  if (connectSubmitBtn) {
    connectSubmitBtn.addEventListener('click', () => {
      const urlInput = document.getElementById('input-gcal-ical-url');
      const url = urlInput ? urlInput.value.trim() : '';
      if (!url) {
        showToast('Pega tu enlace iCal de Google Calendar primero', '⚠️');
        return;
      }
      connectGoogleCalendar(url, false, false);
    });
  }

  const oauthConnectBtn = document.getElementById('btn-gcal-oauth-connect');
  if (oauthConnectBtn) {
    oauthConnectBtn.addEventListener('click', () => {
      connectGoogleCalendar('', false, true);
    });
  }

  const demoSubmitBtn = document.getElementById('btn-gcal-demo-submit');
  if (demoSubmitBtn) {
    demoSubmitBtn.addEventListener('click', () => {
      connectGoogleCalendar('', true, false);
    });
  }

  const syncNowBtn = document.getElementById('btn-gcal-sync-now');
  if (syncNowBtn) syncNowBtn.addEventListener('click', syncGoogleCalendarNow);

  const availSyncNowBtn = document.getElementById('btn-avail-sync-now');
  if (availSyncNowBtn) availSyncNowBtn.addEventListener('click', syncGoogleCalendarNow);

  const disconnectBtn = document.getElementById('btn-gcal-disconnect');
  if (disconnectBtn) disconnectBtn.addEventListener('click', disconnectGoogleCalendar);

  const copyFeedBtn = document.getElementById('btn-copy-feed-url');
  if (copyFeedBtn) {
    copyFeedBtn.addEventListener('click', () => {
      const feedInput = document.getElementById('gcal-feed-url-input');
      if (feedInput) copyToClipboard(feedInput.value, 'Enlace de suscripción copiado al portapapeles');
    });
  }

  const saveOauthBtn = document.getElementById('btn-save-oauth-settings');
  if (saveOauthBtn) {
    saveOauthBtn.addEventListener('click', () => {
      const clientId = document.getElementById('oauth-client-id').value;
      if (clientId) localStorage.setItem('reuniones_google_client_id', clientId);
      showToast('Configuración OAuth guardada', '✓');
    });
  }

  // Direct button from Google Calendar modal to public page
  const gcalPublicBtn = document.getElementById('btn-gcal-open-public-page');
  if (gcalPublicBtn) {
    gcalPublicBtn.addEventListener('click', () => {
      closeModal('modal-google-calendar');
      goToPublicLanding();
    });
  }

  // =========================================================================
  // GOOGLE AUTH & USER PROFILE EVENT LISTENERS (CALENDLY CLONE)
  // =========================================================================

  // 1. Header User Profile Dropdown Toggle
  const headerUserBtn = document.getElementById('header-user-btn');
  const userProfileDropdown = document.getElementById('user-profile-dropdown');

  if (headerUserBtn && userProfileDropdown) {
    headerUserBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      userProfileDropdown.classList.toggle('show');
    });

    document.addEventListener('click', (e) => {
      if (!userProfileDropdown.contains(e.target) && !headerUserBtn.contains(e.target)) {
        userProfileDropdown.classList.remove('show');
      }
    });
  }

  // 2. Dropdown Menu Items
  const menuMyMeetings = document.getElementById('menu-item-my-meetings');
  if (menuMyMeetings) {
    menuMyMeetings.addEventListener('click', () => {
      if (userProfileDropdown) userProfileDropdown.classList.remove('show');
      switchView('event-types');
      window.location.hash = '';
    });
  }

  const menuGcal = document.getElementById('menu-item-gcal');
  if (menuGcal) {
    menuGcal.addEventListener('click', () => {
      if (userProfileDropdown) userProfileDropdown.classList.remove('show');
      openGoogleCalModal();
    });
  }

  const menuEnvSetup = document.getElementById('menu-item-env-setup');
  if (menuEnvSetup) {
    menuEnvSetup.addEventListener('click', () => {
      if (userProfileDropdown) userProfileDropdown.classList.remove('show');
      const modal = document.getElementById('modal-env-setup');
      if (modal) modal.classList.add('show');
    });
  }

  const menuLogout = document.getElementById('menu-item-logout');
  if (menuLogout) {
    menuLogout.addEventListener('click', () => {
      logoutUser();
    });
  }

  // 3. Login & Registration Page Actions (Unique Per User)
  let isSignupMode = false;

  function setLoginSignupMode(signup) {
    isSignupMode = !!signup;
    const nameGroup = document.getElementById('login-group-name');
    const titleEl = document.getElementById('login-card-title');
    const subtitleEl = document.getElementById('login-card-subtitle');
    const submitBtn = document.getElementById('btn-login-email-continue');
    const footerPrompt = document.getElementById('login-footer-prompt');
    const linkSignupEl = document.getElementById('link-login-signup');

    if (nameGroup) nameGroup.style.display = isSignupMode ? 'block' : 'none';
    if (titleEl) {
      titleEl.textContent = isSignupMode
        ? 'Crea tu cuenta en Reuniones'
        : 'Inicia sesión en tu cuenta';
    }
    if (subtitleEl) {
      subtitleEl.textContent = isSignupMode
        ? 'Cada cuenta tiene su propio calendario y enlaces de reserva independientes.'
        : 'Ingresa tu correo para comenzar.';
    }
    if (submitBtn) {
      submitBtn.textContent = isSignupMode ? 'Crear cuenta' : 'Continuar';
    }
    if (footerPrompt) {
      footerPrompt.textContent = isSignupMode ? '¿Ya tienes una cuenta?' : '¿No tienes una cuenta?';
    }
    if (linkSignupEl) {
      linkSignupEl.textContent = isSignupMode ? 'Inicia sesión.' : 'Regístrate.';
    }
  }

  const btnLoginGoogle = document.getElementById('btn-login-google');
  if (btnLoginGoogle) {
    btnLoginGoogle.addEventListener('click', () => {
      initiateGoogleLogin();
    });
  }

  const btnLoginMicrosoft = document.getElementById('btn-login-microsoft');
  if (btnLoginMicrosoft) {
    btnLoginMicrosoft.addEventListener('click', () => {
      showToast('Inicio con Microsoft en desarrollo. Usa tu correo o Google.', 'ℹ️');
    });
  }

  const btnLoginDemo = document.getElementById('btn-login-demo');
  if (btnLoginDemo) {
    btnLoginDemo.addEventListener('click', () => {
      loginDemoUser();
    });
  }

  const formLoginEmail = document.getElementById('form-login-email');
  if (formLoginEmail) {
    formLoginEmail.addEventListener('submit', async (e) => {
      e.preventDefault();
      const emailInput = document.getElementById('login-input-email');
      const nameInput = document.getElementById('login-input-name');
      const email = emailInput ? emailInput.value.trim() : '';
      const name = nameInput ? nameInput.value.trim() : '';
      if (!email) {
        showToast('Ingresa un correo electrónico válido', '⚠️');
        return;
      }
      if (isSignupMode && !name) {
        showToast('Ingresa tu nombre completo para registrarte', '⚠️');
        if (nameInput) nameInput.focus();
        return;
      }
      await loginOrRegisterByEmail(email, name, isSignupMode);
    });
  }

  const linkSignup = document.getElementById('link-login-signup');
  if (linkSignup) {
    linkSignup.addEventListener('click', (e) => {
      e.preventDefault();
      setLoginSignupMode(!isSignupMode);
      const targetInput = document.getElementById(isSignupMode ? 'login-input-name' : 'login-input-email');
      if (targetInput) targetInput.focus();
    });
  }

  const btnOpenEnvInfo = document.getElementById('btn-open-env-info');
  if (btnOpenEnvInfo) {
    btnOpenEnvInfo.addEventListener('click', () => {
      const modal = document.getElementById('modal-env-setup');
      if (modal) modal.classList.add('show');
    });
  }

  const btnModalTestDemo = document.getElementById('btn-modal-test-demo');
  if (btnModalTestDemo) {
    btnModalTestDemo.addEventListener('click', () => {
      const modal = document.getElementById('modal-env-setup');
      if (modal) modal.classList.remove('show');
      loginDemoUser();
    });
  }

  const btnCopyRedirectUri = document.getElementById('btn-copy-redirect-uri');
  if (btnCopyRedirectUri) {
    btnCopyRedirectUri.addEventListener('click', () => {
      const val = document.getElementById('copy-redirect-uri-val').value;
      copyToClipboard(val, 'URI de redireccionamiento copiada al portapapeles');
    });
  }

  const btnCopyEnvSnippet = document.getElementById('btn-copy-env-snippet');
  if (btnCopyEnvSnippet) {
    btnCopyEnvSnippet.addEventListener('click', () => {
      const snippet = `GOOGLE_CLIENT_ID=tu_google_client_id_aqui.apps.googleusercontent.com\nGOOGLE_CLIENT_SECRET=tu_google_client_secret_aqui\nGOOGLE_REDIRECT_URI=http://localhost:3000/api/auth/google/callback\nGOOGLE_SCOPES="openid email profile https://www.googleapis.com/auth/calendar.events"\nSESSION_SECRET=reuniones_super_secret_jwt_key_2026_change_in_production\nPORT=3000`;
      copyToClipboard(snippet, 'Variables para .env copiadas');
    });
  }

  // =========================================================================
  // URL Hash & Deep Link Routing (with Strict Per-Browser Auth Guard)
  // =========================================================================
  function handleRouting() {
    const hash = window.location.hash || '';
    const path = window.location.pathname || '';
    const urlParams = new URLSearchParams(window.location.search);

    // Query params feedback
    if (urlParams.get('login') === 'success') {
      showToast('¡Bienvenido! Has iniciado sesión con Google en este navegador.', '🎉');
      history.replaceState(null, '', window.location.pathname + (window.location.hash || '#meeting_types'));
    }

    if (urlParams.get('error')) {
      const err = urlParams.get('error');
      if (err === 'missing_credentials') {
        const modal = document.getElementById('modal-env-setup');
        if (modal) modal.classList.add('show');
        showToast('Credenciales pendientes en .env', '⚠️');
      } else {
        showToast('Aviso de autenticación: ' + decodeURIComponent(err), '⚠️');
      }
      history.replaceState(null, '', window.location.pathname + (window.location.hash || ''));
    }

    // 1. Public Direct Event Booking Link (#/book/:slug or /book/:slug)
    if (hash.startsWith('#/book/') || path.startsWith('/book/')) {
      const ctx = getPublicRouteContext();
      const rawSlug = hash.startsWith('#/book/') ? hash.replace('#/book/', '') : path.replace('/book/', '');
      const cleanSlug = ctx.eventSlug || rawSlug.split('?')[0];
      document.querySelectorAll('.modal-overlay.show').forEach(m => m.classList.remove('show'));
      fetchPublicHostCalendarStatus();
      switchView('public-landing');
      openPublicEventBooking(cleanSlug);
      return;
    }

    // 2. Public Host Profile Directory (#public, #/user/:slug, /public, /user/:slug)
    if (hash === '#public' || hash.startsWith('#/user') || path === '/public' || path.startsWith('/user/')) {
      document.querySelectorAll('.modal-overlay.show').forEach(m => m.classList.remove('show'));
      fetchPublicHostCalendarStatus();
      showPublicDirectoryMode();
      switchView('public-landing');
      return;
    }

    // 3. Explicit Login Route
    if (hash === '#login' || path === '/login') {
      document.querySelectorAll('.modal-overlay.show').forEach(m => m.classList.remove('show'));
      if (state.auth.authenticated) {
        window.location.hash = '#meeting_types';
        switchView('event-types');
      } else {
        switchView('login');
      }
      return;
    }

    // 4. Protected Admin Routes (/ or /app/... or #meeting_types)
    // STRICT GUARD: If this browser is NOT authenticated, always show Login!
    if (!state.auth.authenticated) {
      document.querySelectorAll('.modal-overlay.show').forEach(m => m.classList.remove('show'));
      switchView('login');
      return;
    }

    // Authenticated browser -> show Admin Dashboard
    document.querySelectorAll('.modal-overlay.show').forEach(m => m.classList.remove('show'));
    switchView('event-types');
  }

  window.addEventListener('hashchange', handleRouting);

  // Expose public API for inline handlers
  window.ReunionesApp = {
    openBookingModal,
    openPublicEventBooking,
    selectPublicBookingDate,
    choosePublicSlot,
    proceedToPublicBookingForm,
    showPublicDirectoryMode,
    openCreateModal,
    openEditModal,
    openShareModal,
    openInternalNoteModal,
    duplicateEvent,
    deleteEvent,
    toggleEventActive,
    toggleCardMenu,
    copyEventLink,
    cancelMeeting,
    selectBookingDate,
    chooseSlot,
    proceedToBookingForm,
    updateScheduleDayActive,
    updateScheduleTime,
    openGoogleCalModal,
    connectGoogleCalendar,
    syncGoogleCalendarNow,
    disconnectGoogleCalendar,
    goToPublicLanding,
    initiateGoogleLogin,
    loginDemoUser,
    logoutUser,
    checkAuthStatus,
    showToast
  };

  // --- Initial Mount (Strict Per-Browser Auth First) ---
  async function initApp() {
    loadState();
    renderEventTypes();
    renderScheduledMeetings();
    renderWeeklySchedule();
    syncMeetingsToServer();

    // If on a public route, render public page immediately while checking auth in parallel
    if (isPublicRoute()) {
      handleRouting();
    } else {
      // Default to Login view until per-browser session cookie is verified
      switchView('login');
    }

    await checkAuthStatus();
    await fetchCalendarStatus();
    handleRouting();
  }

  initApp();

  console.log('✨ Reuniones (Calendly Clone) con Login aislado por navegador y Página Pública estilo Calendly original listo.');
})();


