import { sendTelemetryBatch } from './api.js';

const FLUSH_INTERVAL_MS = 10_000; // flush every 10 s
const FLUSH_BATCH_SIZE  = 50;     // or when buffer hits 50 events
const MOUSE_SAMPLE_MS   = 1_000;  // record mouse position at most once per second

const SS_CURRENT = 'caliber_current_grader';

const _telemetry = {
  sessionId:    `sess_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
  sessionStart: Date.now(),
  queue:        [],  // pending events waiting to be flushed to the server
  // Cached annotator ID — stamped on every event so global mouse/click handlers
  // (which run outside React) still know who is using the app. Read once at
  // module load from sessionStorage; setGrader keeps it in sync with React.
  graderId: (() => {
    try { return sessionStorage.getItem(SS_CURRENT) || ''; }
    catch { return ''; }
  })(),

  setGrader(id) { this.graderId = id || ''; },

  // ── One-shot device / environment fingerprint ─────────────────────────────
  // Emitted once at module load. Repeating per-event would waste hundreds of
  // bytes × thousands of rows; one `session_meta` row per session is enough
  // to join against the rest of the events via session_id.
  _emitSessionMeta() {
    const conn = navigator.connection || navigator.mozConnection || navigator.webkitConnection || null;
    const uad  = navigator.userAgentData || null;
    let timezone = '';
    let locale   = '';
    try { timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || ''; } catch { /* ignore */ }
    try { locale   = navigator.language || ''; } catch { /* ignore */ }

    this.track('session_meta', {
      // Screen (physical / full screen, not the app viewport)
      screen_w:   window.screen?.width,
      screen_h:   window.screen?.height,
      screen_avail_w: window.screen?.availWidth,
      screen_avail_h: window.screen?.availHeight,
      dpr:        window.devicePixelRatio || 1,
      // Viewport at session start (will drift if user resizes — mouse events
      // also carry vw/vh so resize behavior is still observable)
      vw:         window.innerWidth,
      vh:         window.innerHeight,
      // UA / platform
      ua:         navigator.userAgent,
      platform:   navigator.platform,
      ua_brands:  uad?.brands ? uad.brands.map(b => `${b.brand} ${b.version}`).join('; ') : undefined,
      ua_mobile:  uad?.mobile,
      ua_platform: uad?.platform,
      // Locale + time
      language:   locale,
      languages:  (navigator.languages || []).join(','),
      timezone,
      tz_offset_min: new Date().getTimezoneOffset(),
      // Connection (Chrome / Edge; undefined on Safari/Firefox)
      net_effective_type: conn?.effectiveType,
      net_downlink_mbps:  conn?.downlink,
      net_rtt_ms:         conn?.rtt,
      net_save_data:      conn?.saveData,
      // Hardware
      hw_concurrency:     navigator.hardwareConcurrency,
      device_memory_gb:   navigator.deviceMemory,
      // Capability
      touch:         ('ontouchstart' in window) || (navigator.maxTouchPoints || 0) > 0,
      max_touch_pts: navigator.maxTouchPoints,
      cookie_enabled: navigator.cookieEnabled,
      // Page context
      referrer:   document.referrer || '',
      origin:     window.location.origin,
      path:       window.location.pathname,
    });
  },

  // ── Flush queue to server ──────────────────────────────────────────────────
  async _flush() {
    if (!this.queue.length) return;
    const batch = this.queue.splice(0, this.queue.length);
    await sendTelemetryBatch(batch);
  },

  // ── Core track function ────────────────────────────────────────────────────
  track(event, props = {}) {
    const entry = {
      event,
      ...props,
      // Default graderId to the cached one if the caller didn't pass it
      graderId:  props.graderId || this.graderId || undefined,
      sessionId: this.sessionId,
      ts:        new Date().toISOString(),
      elapsed_s: Math.round((Date.now() - this.sessionStart) / 1000),
    };

    this.queue.push(entry);

    if (this.queue.length >= FLUSH_BATCH_SIZE) this._flush();
  },
};

// ── Emit one-shot device/env fingerprint at session start ─────────────────────
try { _telemetry._emitSessionMeta(); } catch (e) { /* never block the app on telemetry */ }

// ── Periodic flush ─────────────────────────────────────────────────────────────
setInterval(() => _telemetry._flush(), FLUSH_INTERVAL_MS);

// ── Flush on page unload ───────────────────────────────────────────────────────
window.addEventListener('beforeunload', () => {
  if (_telemetry.queue.length) {
    navigator.sendBeacon(
      '/api/telemetry/batch',
      JSON.stringify({ events: _telemetry.queue })
    );
  }
});

// ── Global mouse + click tracking ─────────────────────────────────────────────
let _lastMouseTs = 0;

document.addEventListener('mousemove', (e) => {
  const now = Date.now();
  if (now - _lastMouseTs < MOUSE_SAMPLE_MS) return;
  _lastMouseTs = now;

  _telemetry.track('mouse_move', {
    x: e.clientX,
    y: e.clientY,
    vw: window.innerWidth,
    vh: window.innerHeight,
  });
}, { passive: true });

document.addEventListener('click', (e) => {
  const target = e.target;
  _telemetry.track('click', {
    x:    e.clientX,
    y:    e.clientY,
    tag:  target.tagName?.toLowerCase(),
    id:   target.id || undefined,
    cls:  target.className ? String(target.className).trim().slice(0, 80) : undefined,
    text: target.textContent?.trim().slice(0, 60) || undefined,
  });
}, { passive: true });

// ── Exports ───────────────────────────────────────────────────────────────────

export function track(event, props = {}) {
  _telemetry.track(event, props);
}

export function setTelemetryGrader(id) {
  _telemetry.setGrader(id);
}

export default _telemetry;
