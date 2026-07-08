require('dotenv').config();

const express = require('express');
const cors    = require('cors');
const path    = require('path');

const authRoutes        = require('./routes/auth');
const sessionRoutes     = require('./routes/session');
const annotationRoutes  = require('./routes/annotations');
const adminRoutes       = require('./routes/admin');
const telemetryRoutes   = require('./routes/telemetry');
const sonaItemsRoutes   = require('./routes/sonaItems');
const exportRoutes      = require('./routes/export');

const app  = express();
const PORT = process.env.PORT || 3001;

// Behind the EB ALB the real client IP arrives in X-Forwarded-For. Trust one
// proxy hop so req.ip resolves to the client (not the load balancer's address).
app.set('trust proxy', 1);

app.use(cors({ origin: process.env.CORS_ORIGIN || '*' }));
app.use(express.json({ limit: '4mb' }));

// ── API routes ────────────────────────────────────────────────────────────────
app.use('/api/auth',              authRoutes);
app.use('/api/session',          sessionRoutes);
app.use('/api/annotations',      annotationRoutes);
app.use('/api/admin',            adminRoutes);
app.use('/api/admin/sona-items', sonaItemsRoutes);
app.use('/api/admin/export',     exportRoutes);
app.use('/api/telemetry',        telemetryRoutes);

// ── Health check (used by EB) ─────────────────────────────────────────────────
app.get('/health', (_, res) => res.json({ status: 'ok' }));

// ── Serve React app in production ─────────────────────────────────────────────
if (process.env.NODE_ENV === 'production') {
  const distPath = path.join(__dirname, '..', 'dist');
  app.use(express.static(distPath));
  app.get('*', (_, res) => res.sendFile(path.join(distPath, 'index.html')));
}

// ── Bootstrap super-admin if not present ─────────────────────────────────────
async function ensureSuperAdmin() {
  const user = process.env.SUPER_ADMIN_USERNAME;
  const pass = process.env.SUPER_ADMIN_PASSWORD;
  if (!user || !pass) return;

  const { db, TABLES, GetCommand, PutCommand } = require('./db/dynamo');
  const bcrypt = require('bcryptjs');

  try {
    const existing = await db.send(new GetCommand({ TableName: TABLES.ADMINS, Key: { username: user } }));
    if (!existing.Item) {
      const hash = await bcrypt.hash(pass, 12);
      await db.send(new PutCommand({
        TableName: TABLES.ADMINS,
        Item: { username: user, password_hash: hash, role: 'super_admin', created_at: new Date().toISOString() },
      }));
      console.log(`Super-admin "${user}" created.`);
    }
  } catch (err) {
    console.warn('Could not bootstrap super-admin (DynamoDB may not be reachable):', err.message);
  }
}

// ── Periodic stale-assignment sweep ───────────────────────────────────────────
// Items assigned to annotators whose tabs have been closed / idle for more
// than STALE_TIMEOUT_MIN (default 60) are released back to the pool so
// incoming annotators can pick them up. Active annotators heartbeat every 60s
// so they are never affected. Single instance is fine — EB defaults to one;
// adding a second instance later would cause duplicate decrements unless we
// add a lock.
const STALE_TIMEOUT_MIN  = Number(process.env.STALE_TIMEOUT_MIN)  || 60;
const STALE_SWEEP_EVERY  = Number(process.env.STALE_SWEEP_EVERY_MIN) || 10;
function startStaleSweep() {
  const { sweepStaleAssignments } = require('./lib/pool');
  const run = async () => {
    try {
      const r = await sweepStaleAssignments(STALE_TIMEOUT_MIN * 60 * 1000);
      if (r.items_released > 0) {
        console.log(`[stale-sweep] released ${r.items_released} items across ${r.swept} annotators (scanned ${r.scanned})`);
      }
    } catch (err) {
      console.warn('[stale-sweep] error:', err.message);
    }
  };
  // Kick off once at startup, then every STALE_SWEEP_EVERY minutes
  setTimeout(run, 30_000); // 30s after boot so we don't compete with bootstrap
  setInterval(run, STALE_SWEEP_EVERY * 60 * 1000);
}

// ── CALIBER-only: periodic refresh of the LLM-graded sona set ────────────────
// drawFromPool consults this set to ensure only sonas with LLM grades for the
// configured model are assignable. Refresh on the same cadence as the stale
// sweep so any new imports show up within ~10 min without a restart.
function startEligibilityRefresh() {
  const { refreshEligibility } = require('./lib/llmEligibility');
  refreshEligibility(); // fire and forget on boot
  setInterval(() => refreshEligibility(), STALE_SWEEP_EVERY * 60 * 1000);
}

app.listen(PORT, async () => {
  console.log(`Server listening on port ${PORT}`);
  // Provision any DynamoDB tables this env points at that don't exist yet.
  // For Prolific app's paa-* tables this is a no-op on every boot; for
  // sister projects (e.g. CALIBER-full) it creates their tables on first
  // boot. Best-effort — failures are logged and don't block startup.
  try {
    const { bootstrapAllTables } = require('./lib/tableBootstrap');
    await bootstrapAllTables();
  } catch (err) {
    console.warn('[tableBootstrap] startup failed:', err.message);
  }
  await ensureSuperAdmin();
  startStaleSweep();
  console.log(`[stale-sweep] enabled — timeout=${STALE_TIMEOUT_MIN} min, every ${STALE_SWEEP_EVERY} min`);
  startEligibilityRefresh();
  console.log(`[caliber-eligibility] refresh enabled — every ${STALE_SWEEP_EVERY} min`);
});
