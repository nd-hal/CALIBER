const { Router } = require('express');
const { v4: uuidv4 } = require('uuid');
const { db, TABLES, PutCommand } = require('../db/dynamo');

const router = Router();

// POST /api/telemetry/batch  — receives a batch of events from the client
router.post('/batch', async (req, res) => {
  const { events } = req.body;

  // Always return 200 so UI is never blocked by telemetry failures
  if (!Array.isArray(events) || events.length === 0) return res.json({ ok: true });

  // Request-level metadata stamped on every row in this batch. Cheaper than
  // making the client send these (the headers are already on the wire) and
  // useful as an independent cross-check against the client-reported UA.
  const xff       = req.headers['x-forwarded-for'];
  const clientIp  = (typeof xff === 'string' && xff.length ? xff.split(',')[0].trim() : req.ip) || '';
  const serverUa  = req.headers['user-agent']     || '';
  const acceptLang= req.headers['accept-language'] || '';
  const referrer  = req.headers['referer']        || req.headers['referrer'] || '';
  const receivedAt = new Date().toISOString();

  const writes = events.slice(0, 200).map(ev =>
    db.send(new PutCommand({
      TableName: TABLES.TELEMETRY,
      Item: {
        event_id:        uuidv4(),
        prolific_id:     ev.graderId || ev.prolific_id || 'anonymous',
        ts:              ev.ts || receivedAt,
        session_id:      ev.sessionId || '',
        event_type:      ev.event || 'unknown',
        event_data:      ev,
        // Server-stamped request metadata (one source of truth even if the
        // client UA can be spoofed)
        client_ip:       clientIp,
        server_ua:       serverUa,
        accept_language: acceptLang,
        server_referrer: referrer,
        received_at:     receivedAt,
      },
    })).catch(() => {})
  );

  Promise.all(writes).catch(() => {});

  res.json({ ok: true, received: events.length });
});

module.exports = router;
