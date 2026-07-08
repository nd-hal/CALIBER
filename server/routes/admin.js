const { Router } = require('express');
const { db, TABLES, POOL_COUNTER_COLUMN, GetCommand, PutCommand, UpdateCommand, ScanCommand, QueryCommand, DeleteCommand } = require('../db/dynamo');
const { requireAuth, requireSuperAdmin } = require('../middleware/auth');
const { drawFromPool, sweepStaleAssignments } = require('../lib/pool');
const { refreshEligibility, getDiagnostics: getEligibilityDiagnostics } = require('../lib/llmEligibility');

// Same alias trick as server/lib/pool.js — keeps the column name in one place.
const COL_NAMES = { '#col': POOL_COUNTER_COLUMN };

const router = Router();

// GET /api/admin/config
router.get('/config', requireAuth, async (_req, res) => {
  try {
    const result = await db.send(new GetCommand({ TableName: TABLES.CONFIG, Key: { pk: 'global' } }));
    const item = result.Item || {};
    // CALIBER-only: live eligibility diagnostics so the admin UI can show
    // "X / Y sonas currently eligible" alongside the allowlist textarea.
    const elig = getEligibilityDiagnostics();
    res.json({
      annotations_per_user:           item.annotations_per_user           || 2,
      returning_annotations_per_user: item.returning_annotations_per_user || 4,
      target_annotations_per_item:    item.target_annotations_per_item    || 1,
      completion_code:                item.completion_code                || '',
      allowed_sona_ids:               Array.isArray(item.allowed_sona_ids) ? item.allowed_sona_ids : [],
      eligibility:                    elig,
      updated_at:                     item.updated_at                     || null,
      updated_by:                     item.updated_by                     || null,
    });
  } catch (err) {
    console.error('admin/config GET', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// PUT /api/admin/config
router.put('/config', requireAuth, async (req, res) => {
  const n = Number(req.body.annotations_per_user);
  if (!n || n < 1 || n > 1000) return res.status(400).json({ error: 'annotations_per_user must be 1–1000' });
  const t = req.body.target_annotations_per_item === undefined
    ? undefined
    : Number(req.body.target_annotations_per_item);
  if (t !== undefined && (!Number.isInteger(t) || t < 1 || t > 100)) {
    return res.status(400).json({ error: 'target_annotations_per_item must be an integer 1–100' });
  }
  const r = req.body.returning_annotations_per_user === undefined
    ? undefined
    : Number(req.body.returning_annotations_per_user);
  if (r !== undefined && (!Number.isInteger(r) || r < 1 || r > 1000)) {
    return res.status(400).json({ error: 'returning_annotations_per_user must be an integer 1–1000' });
  }
  // Accept either the raw code (e.g. CWFE83FY) or the full Prolific URL
  // (https://app.prolific.com/submissions/complete?cc=CWFE83FY) and extract
  // just the code so admins can paste either form.
  let completion_code = typeof req.body.completion_code === 'string'
    ? req.body.completion_code.trim()
    : '';
  if (completion_code) {
    const ccMatch = completion_code.match(/[?&]cc=([^&\s]+)/i);
    if (ccMatch) completion_code = decodeURIComponent(ccMatch[1]);
  }

  // CALIBER-only: optional admin-curated allowlist of sona_ids. Normalise:
  // trim each, drop empties, dedupe, sort. Empty array = clear the filter
  // (fail-open to all LLM-graded sonas).
  let allowed_sona_ids;
  if (req.body.allowed_sona_ids !== undefined) {
    if (!Array.isArray(req.body.allowed_sona_ids)) {
      return res.status(400).json({ error: 'allowed_sona_ids must be an array of strings' });
    }
    const cleaned = req.body.allowed_sona_ids
      .map(v => (typeof v === 'string' ? v.trim() : ''))
      .filter(Boolean);
    if (cleaned.some(v => v.length > 64)) {
      return res.status(400).json({ error: 'allowed_sona_ids entries must be ≤ 64 chars' });
    }
    allowed_sona_ids = [...new Set(cleaned)].sort();
  }

  try {
    const existing = await db.send(new GetCommand({ TableName: TABLES.CONFIG, Key: { pk: 'global' } }));
    await db.send(new PutCommand({
      TableName: TABLES.CONFIG,
      Item: {
        ...(existing.Item || {}),
        pk: 'global',
        annotations_per_user: n,
        ...(t !== undefined ? { target_annotations_per_item: t } : {}),
        ...(r !== undefined ? { returning_annotations_per_user: r } : {}),
        completion_code,
        ...(allowed_sona_ids !== undefined ? { allowed_sona_ids } : {}),
        updated_at: new Date().toISOString(),
        updated_by: req.admin.username,
      },
    }));

    // If the allowlist was touched, kick off an immediate eligibility refresh
    // (fire-and-forget) so the change is visible within seconds instead of
    // waiting for the next 10-min interval tick.
    if (allowed_sona_ids !== undefined) {
      refreshEligibility().catch(() => {});
    }

    res.json({
      ok: true,
      annotations_per_user: n,
      target_annotations_per_item: t,
      returning_annotations_per_user: r,
      completion_code,
      ...(allowed_sona_ids !== undefined ? { allowed_sona_ids } : {}),
    });
  } catch (err) {
    console.error('admin/config PUT', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// GET /api/admin/progress  — annotator completion overview
router.get('/progress', requireAuth, async (req, res) => {
  try {
    const [annotatorsResult, configResult] = await Promise.all([
      db.send(new ScanCommand({
        TableName: TABLES.ANNOTATORS,
        ProjectionExpression:
          'prolific_id, completed_sona_ids, assigned_sona_ids, ' +
          'survey_done, tutorial_done, onboarding_done, created_at, ' +
          'task_annotation_done, task_scoring_done, task_bars_done, task_checklist_done, ' +
          'submitted_at, sessions, session_count',
      })),
      db.send(new GetCommand({ TableName: TABLES.CONFIG, Key: { pk: 'global' } })),
    ]);

    const config = configResult.Item || { annotations_per_user: 2 };

    const annotators = (annotatorsResult.Items || []).map(a => {
      const completedIds = a.completed_sona_ids || [];
      const completedSet = new Set(completedIds);

      // Per-session breakdown. If `sessions` is missing (legacy annotator),
      // synthesize a single session entry from assigned_sona_ids.
      const sessionsArr = Array.isArray(a.sessions) && a.sessions.length
        ? a.sessions
        : [{
            n: 1,
            items: a.assigned_sona_ids || [],
            started_at: a.created_at || null,
            submitted_at: a.submitted_at || null,
          }];
      const sessions = sessionsArr.map(s => {
        const items = s.items || [];
        const completed = items.filter(id => completedSet.has(id)).length;
        return {
          n:            s.n,
          assigned:     items.length,
          completed,
          started_at:   s.started_at || null,
          submitted_at: s.submitted_at || null,
        };
      });

      return {
        prolific_id:            a.prolific_id,
        survey_done:            a.survey_done || false,
        tutorial_done:          a.tutorial_done || false,
        onboarding_done:        a.onboarding_done || false,
        task_annotation_done:   a.task_annotation_done || false,
        task_scoring_done:      a.task_scoring_done || false,
        task_bars_done:         a.task_bars_done || false,
        task_checklist_done:    a.task_checklist_done || false,
        assigned_count:         (a.assigned_sona_ids || []).length,
        completed_count:        completedIds.length,
        submitted_at:           a.submitted_at || null,
        session_count:          a.session_count || sessionsArr.length || 1,
        sessions,
        created_at:             a.created_at,
      };
    });

    res.json({
      annotators,
      annotations_per_user: config.annotations_per_user,
      total: annotators.length,
    });
  } catch (err) {
    console.error('admin/progress', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// POST /api/admin/annotators/:prolific_id/reset  — super-admin only
// Deletes all annotation records for the annotator and clears their completed list.
// Keeps assignment, survey, tutorial, and onboarding state intact.
router.post('/annotators/:prolific_id/reset', requireSuperAdmin, async (req, res) => {
  const { prolific_id } = req.params;

  try {
    // Fetch all annotation records for this annotator (prolific_id is partition key)
    const annResult = await db.send(new QueryCommand({
      TableName: TABLES.ANNOTATIONS,
      KeyConditionExpression: 'prolific_id = :pid',
      ExpressionAttributeValues: { ':pid': prolific_id },
      ProjectionExpression: 'prolific_id, sort_key',
    }));

    const items = annResult.Items || [];

    // Delete all annotation records in parallel
    await Promise.all(items.map(item =>
      db.send(new DeleteCommand({
        TableName: TABLES.ANNOTATIONS,
        Key: { prolific_id: item.prolific_id, sort_key: item.sort_key },
      }))
    ));

    // Clear completed_sona_ids and bump reset_version so the annotator's
    // browser knows to discard its local annotation cache on next load.
    await db.send(new UpdateCommand({
      TableName: TABLES.ANNOTATORS,
      Key: { prolific_id },
      UpdateExpression: 'SET completed_sona_ids = :empty, reset_version = if_not_exists(reset_version, :zero) + :one',
      ExpressionAttributeValues: { ':empty': [], ':zero': 0, ':one': 1 },
    }));

    res.json({ ok: true, deleted: items.length });
  } catch (err) {
    console.error('admin/annotators/reset', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// POST /api/admin/annotators/:prolific_id/reset-tasks  — super-admin only
// Wipes onboarding state: consent, survey, tutorial, onboarding, and all task flags.
// Annotator will redo the entire intro flow on next login.
router.post('/annotators/:prolific_id/reset-tasks', requireSuperAdmin, async (req, res) => {
  const { prolific_id } = req.params;
  try {
    await db.send(new UpdateCommand({
      TableName: TABLES.ANNOTATORS,
      Key: { prolific_id },
      UpdateExpression:
        'REMOVE consent_done, survey_done, tutorial_done, onboarding_done, ' +
        'task_annotation_done, task_scoring_done, task_bars_done, task_checklist_done, ' +
        'survey_answers ' +
        'SET reset_version = if_not_exists(reset_version, :zero) + :one',
      ExpressionAttributeValues: { ':zero': 0, ':one': 1 },
    }));
    res.json({ ok: true });
  } catch (err) {
    console.error('admin/annotators/reset-tasks', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// DELETE /api/admin/annotators/:prolific_id  — super-admin only
// Permanently removes the annotator and all their annotation records.
// Also decrements the assigned_count on each of their assigned SONA items
// so those items go back into the draw pool.
router.delete('/annotators/:prolific_id', requireSuperAdmin, async (req, res) => {
  const { prolific_id } = req.params;
  try {
    // Read the annotator first so we know which items to release
    const annotator = (await db.send(new GetCommand({
      TableName: TABLES.ANNOTATORS,
      Key: { prolific_id },
    }))).Item;

    // Delete all annotation records
    const annResult = await db.send(new QueryCommand({
      TableName: TABLES.ANNOTATIONS,
      KeyConditionExpression: 'prolific_id = :pid',
      ExpressionAttributeValues: { ':pid': prolific_id },
      ProjectionExpression: 'prolific_id, sort_key',
    }));
    const items = annResult.Items || [];
    await Promise.all(items.map(item =>
      db.send(new DeleteCommand({
        TableName: TABLES.ANNOTATIONS,
        Key: { prolific_id: item.prolific_id, sort_key: item.sort_key },
      }))
    ));

    // Release the annotator's assigned items back into this project's pool
    let released = 0;
    if (annotator?.assigned_sona_ids?.length) {
      await Promise.all(annotator.assigned_sona_ids.map(sid =>
        db.send(new UpdateCommand({
          TableName: TABLES.SONA_ITEMS,
          Key: { sona_id: sid, answer_num: 'meta' },
          UpdateExpression: 'SET #col = #col - :one',
          ConditionExpression: '#col > :zero',
          ExpressionAttributeNames: COL_NAMES,
          ExpressionAttributeValues: { ':one': 1, ':zero': 0 },
        })).then(() => { released++; }).catch(() => {})
      ));
    }

    // Delete the annotator record itself
    await db.send(new DeleteCommand({
      TableName: TABLES.ANNOTATORS,
      Key: { prolific_id },
    }));

    res.json({ ok: true, deletedAnnotations: items.length, releasedItems: released });
  } catch (err) {
    console.error('admin/annotators/delete', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// GET /api/admin/active  — super-admin only, returns who's been active recently
router.get('/active', requireSuperAdmin, async (req, res) => {
  try {
    const now      = Date.now();
    const cut24h   = new Date(now - 24 * 60 * 60 * 1000).toISOString();
    const cut7d    = new Date(now - 7 * 24 * 60 * 60 * 1000).toISOString();
    const nowIso   = new Date(now).toISOString();

    // Await the stamp for the requesting admin so the scan sees it immediately
    await db.send(new UpdateCommand({
      TableName: TABLES.ADMINS,
      Key: { username: req.admin.username },
      UpdateExpression: 'SET last_seen = :now',
      ExpressionAttributeValues: { ':now': nowIso },
    }));

    const [adminsResult, annotatorsAll] = await Promise.all([
      db.send(new ScanCommand({
        TableName: TABLES.ADMINS,
        ProjectionExpression: 'username, #r, last_seen',
        ExpressionAttributeNames: { '#r': 'role' },
      })),
      db.send(new ScanCommand({
        TableName: TABLES.ANNOTATORS,
        FilterExpression: 'attribute_exists(last_seen) AND last_seen >= :cut7d',
        ExpressionAttributeValues: { ':cut7d': cut7d },
        ProjectionExpression:
          'prolific_id, last_seen, survey_done, onboarding_done, tutorial_done, ' +
          'task_annotation_done, task_scoring_done, task_bars_done, task_checklist_done, ' +
          'completed_sona_ids, assigned_sona_ids',
      })),
    ]);

    const allAnnotators = annotatorsAll.Items || [];

    // Show ALL admins who have ever signed in, sorted by recency
    const admins = (adminsResult.Items || [])
      .filter(a => a.last_seen)
      .map(a => ({
        username:    a.username,
        role:        a.role,
        last_seen:   a.last_seen,
        minutes_ago: Math.floor((now - new Date(a.last_seen).getTime()) / 60000),
      }))
      .sort((a, b) => a.minutes_ago - b.minutes_ago);

    // Show all annotators seen in the last 24h
    const annotators = allAnnotators
      .filter(a => a.last_seen >= cut24h)
      .map(a => {
        // Derive task progress: 5 milestone flags
        const taskProgress =
          (a.survey_done ? 1 : 0) +
          (a.task_annotation_done ? 1 : 0) +
          (a.task_scoring_done ? 1 : 0) +
          (a.task_bars_done ? 1 : 0) +
          (a.task_checklist_done ? 1 : 0);
        return {
          prolific_id:     a.prolific_id,
          last_seen:       a.last_seen,
          survey_done:     a.survey_done || false,
          tutorial_done:   a.tutorial_done || false,
          onboarding_done: a.onboarding_done || false,
          task_progress:   taskProgress,
          completed:       (a.completed_sona_ids || []).length,
          assigned:        (a.assigned_sona_ids || []).length,
          minutes_ago:     Math.floor((now - new Date(a.last_seen).getTime()) / 60000),
        };
      })
      .sort((a, b) => a.minutes_ago - b.minutes_ago);

    const counts = {
      annotators_now: annotators.filter(a => a.minutes_ago <= 5).length,
      annotators_30m: annotators.filter(a => a.minutes_ago <= 30).length,
      annotators_24h: annotators.length,
      annotators_7d:  allAnnotators.length,
    };

    res.json({ admins, annotators, counts, as_of: new Date().toISOString() });
  } catch (err) {
    console.error('admin/active', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// GET /api/admin/insights  — all admins, aggregate annotation stats
router.get('/insights', requireAuth, async (req, res) => {
  try {
    const result = await db.send(new ScanCommand({
      TableName: TABLES.ANNOTATIONS,
      FilterExpression: '#s = :done',
      ExpressionAttributeNames: { '#s': 'step' },
      ExpressionAttributeValues: { ':done': 'done' },
      ProjectionExpression: 'prolific_id, question, grades',
    }));

    const items = result.Items || [];
    const frames = ['s', 't', 'a', 'r'];

    const init = () => ({
      count: 0,
      bars_dist: { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 },
      bars_sum: 0, bars_n: 0,
      frame_yes: { s: 0, t: 0, a: 0, r: 0 },
      frame_n:   { s: 0, t: 0, a: 0, r: 0 },
      score_sum: { s: 0, t: 0, a: 0, r: 0 },
      score_n:   { s: 0, t: 0, a: 0, r: 0 },
      score_dist: {
        s: { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 },
        t: { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 },
        a: { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 },
        r: { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 },
      },
    });

    const by = { q1: init(), q2: init() };
    const annotatorSet = new Set();

    for (const item of items) {
      const q = item.question === 'q1' ? 'q1' : 'q2';
      const g = item.grades || {};
      const b = by[q];
      b.count++;
      if (item.prolific_id) annotatorSet.add(item.prolific_id);

      const bars = parseInt(g.g_bars);
      if (bars >= 1 && bars <= 5) { b.bars_dist[bars]++; b.bars_sum += bars; b.bars_n++; }

      for (const f of frames) {
        if (g[`g_${f}_yn`]) {
          b.frame_n[f]++;
          if (g[`g_${f}_yn`] === 'yes') b.frame_yes[f]++;
        }
        const sc = parseInt(g[`g_${f}_sc`]);
        if (sc >= 1 && sc <= 5) {
          b.score_n[f]++;
          b.score_sum[f] += sc;
          b.score_dist[f][sc]++;
        }
      }
    }

    const summarize = b => ({
      count:     b.count,
      bars_avg:  b.bars_n ? Math.round((b.bars_sum / b.bars_n) * 10) / 10 : null,
      bars_dist: b.bars_dist,
      frame_pct: Object.fromEntries(
        frames.map(f => [f, b.frame_n[f] ? Math.round(b.frame_yes[f] / b.frame_n[f] * 100) : null])
      ),
      score_avg: Object.fromEntries(
        frames.map(f => [f, b.score_n[f] ? Math.round((b.score_sum[f] / b.score_n[f]) * 10) / 10 : null])
      ),
      score_dist: b.score_dist,
    });

    res.json({
      q1: summarize(by.q1),
      q2: summarize(by.q2),
      total: items.length,
      annotators: annotatorSet.size,
    });
  } catch (err) {
    console.error('admin/insights', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// POST /api/admin/reassign  — top up all annotators to current annotations_per_user
// Only adds new items; never removes items already worked on. Uses the shared
// breadth-first drawFromPool so the top-up obeys the same fill-lowest-count-
// first ordering as /session/start AND atomically bumps assigned_count on each
// chosen item (the old in-place shuffle skipped the counter update entirely,
// causing pool_count to diverge from reality).
router.post('/reassign', requireAuth, async (_req, res) => {
  try {
    const [configResult, annotatorsResult] = await Promise.all([
      db.send(new GetCommand({ TableName: TABLES.CONFIG, Key: { pk: 'global' } })),
      db.send(new ScanCommand({
        TableName: TABLES.ANNOTATORS,
        ProjectionExpression: 'prolific_id, assigned_sona_ids, completed_sona_ids',
      })),
    ]);

    const cfg            = configResult.Item || {};
    const targetPerUser  = cfg.annotations_per_user           || 5;
    const targetPerItem  = cfg.target_annotations_per_item    || 1;
    const annotators     = annotatorsResult.Items || [];

    // Run sequentially so concurrent drawFromPool calls don't race on the same
    // pool scan — the per-item ConditionExpression already prevents over-target
    // draws, but sequential keeps the breadth-first ordering predictable.
    let updated = 0;
    let poolExhausted = 0;
    for (const annotator of annotators) {
      const assigned = annotator.assigned_sona_ids || [];
      if (assigned.length >= targetPerUser) continue; // already at or above target — don't remove
      const needed = targetPerUser - assigned.length;

      const draw = await drawFromPool(needed, targetPerItem, assigned);
      if (!draw.ok) { poolExhausted++; continue; }

      await db.send(new UpdateCommand({
        TableName: TABLES.ANNOTATORS,
        Key: { prolific_id: annotator.prolific_id },
        UpdateExpression: 'SET assigned_sona_ids = :ids',
        ExpressionAttributeValues: { ':ids': [...assigned, ...draw.claimed] },
      }));
      updated++;
    }

    res.json({ ok: true, updated, total: annotators.length, pool_exhausted: poolExhausted });
  } catch (err) {
    console.error('admin/reassign', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// GET /api/admin/time-spent  — aggregate time-on-task from telemetry
// Reads `step_time` (grading task transitions) and `screen_time` (initial-flow
// screens) events and groups them by annotator.
router.get('/time-spent', requireAuth, async (req, res) => {
  try {
    // Pull all step_time + screen_time events. Single scan with OR filter.
    let items = [];
    let lastKey;
    do {
      const r = await db.send(new ScanCommand({
        TableName: TABLES.TELEMETRY,
        FilterExpression: 'event_type = :st OR event_type = :sc',
        ExpressionAttributeValues: { ':st': 'step_time', ':sc': 'screen_time' },
        ProjectionExpression: 'prolific_id, event_type, event_data',
        ExclusiveStartKey: lastKey,
      }));
      items = items.concat(r.Items || []);
      lastKey = r.LastEvaluatedKey;
    } while (lastKey);

    // Build: annotators[pid] = { totalMs, initial:{consent,welcome,survey,tutorial}, byParticipant: {...} }
    const annotators = {};
    let stepEvents = 0, screenEvents = 0;

    for (const it of items) {
      const ev  = it.event_data || {};
      const pid = it.prolific_id;
      const ms  = Number(ev.ms) || 0;
      if (!pid || ms <= 0) continue;

      if (!annotators[pid]) annotators[pid] = { totalMs: 0, initial: {}, byParticipant: {} };
      const A = annotators[pid];

      if (it.event_type === 'screen_time') {
        if (ms > 60 * 60 * 1000) continue; // > 1 h = tab-left-open
        const screen = ev.from_screen;
        if (!screen) continue;
        A.initial[screen] = (A.initial[screen] || 0) + ms;
        A.totalMs += ms;
        screenEvents++;
        continue;
      }

      // step_time event
      const sona = ev.participant;
      const q    = ev.question;
      const step = String(ev.from_step ?? '');
      if (!sona || !q || !step) continue;
      if (ms > 30 * 60 * 1000) continue; // > 30 min outlier

      A.totalMs += ms;
      if (!A.byParticipant[sona]) A.byParticipant[sona] = { totalMs: 0, q1: {}, q2: {} };
      const P = A.byParticipant[sona];
      P.totalMs += ms;
      const Q = P[q] || (P[q] = {});
      Q[step] = (Q[step] || 0) + ms;
      stepEvents++;
    }

    const annotatorsArr = Object.entries(annotators)
      .map(([pid, d]) => {
        const participants = Object.entries(d.byParticipant)
          .map(([sona, p]) => ({ sona_id: sona, total_ms: p.totalMs, q1: p.q1, q2: p.q2 }))
          .sort((a, b) => b.total_ms - a.total_ms);
        const initial_total = Object.values(d.initial).reduce((s, x) => s + x, 0);
        return {
          prolific_id: pid,
          total_ms:    d.totalMs,
          initial:     d.initial,        // { consent, welcome, survey, tutorial }
          initial_total,
          participants,
        };
      })
      .sort((a, b) => b.total_ms - a.total_ms);

    res.json({
      annotators:  annotatorsArr,
      event_count: stepEvents + screenEvents,
      step_events: stepEvents,
      screen_events: screenEvents,
    });
  } catch (err) {
    console.error('admin/time-spent', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// POST /api/admin/sweep-stale  — super-admin only
// Manually trigger the stale-assignment sweep. The server also runs this on a
// timer (see server/index.js) but admins can force a sweep at any time.
// Body: { timeout_minutes?: number } — defaults to 60 (matches the periodic
// sweep). Returns counts of how many annotators were touched.
router.post('/sweep-stale', requireSuperAdmin, async (req, res) => {
  try {
    const minutes = Number(req.body?.timeout_minutes);
    const timeoutMs = (Number.isFinite(minutes) && minutes > 0 ? minutes : 60) * 60 * 1000;
    const result = await sweepStaleAssignments(timeoutMs);
    res.json({
      ok: true,
      timeout_minutes: timeoutMs / 60000,
      ...result,
      performed_by: req.admin.username,
      performed_at: new Date().toISOString(),
    });
  } catch (err) {
    console.error('admin/sweep-stale', err);
    res.status(500).json({ error: 'Sweep failed: ' + err.message });
  }
});

// POST /api/admin/reset-all  — super-admin only
// NUCLEAR pilot-reset: wipes all annotators, annotations, and telemetry rows,
// and resets pool counters on every SONA item meta row back to zero so the
// real study starts from a clean slate. Preserves admins, config, and the
// SONA item content itself (transcripts, audio URLs, eligibility flags).
//
// Body must include { confirm: 'RESET ALL' } as a safety check.
router.post('/reset-all', requireSuperAdmin, async (req, res) => {
  if ((req.body || {}).confirm !== 'RESET ALL') {
    return res.status(400).json({ error: 'Confirmation phrase missing or incorrect' });
  }

  async function scanAllKeys(TableName, ProjectionExpression) {
    let items = [];
    let lastKey;
    do {
      const r = await db.send(new ScanCommand({
        TableName, ProjectionExpression, ExclusiveStartKey: lastKey,
      }));
      items = items.concat(r.Items || []);
      lastKey = r.LastEvaluatedKey;
    } while (lastKey);
    return items;
  }

  async function deleteAll(TableName, keys, keyFn) {
    let deleted = 0;
    // Chunk into 25-parallel deletes to keep concurrent connection count sane
    for (let i = 0; i < keys.length; i += 25) {
      const chunk = keys.slice(i, i + 25);
      await Promise.all(chunk.map(it =>
        db.send(new DeleteCommand({ TableName, Key: keyFn(it) }))
          .then(() => { deleted++; })
          .catch(() => {})
      ));
    }
    return deleted;
  }

  try {
    // 1. Annotators (PK: prolific_id)
    const annotatorKeys = await scanAllKeys(TABLES.ANNOTATORS, 'prolific_id');
    const annotatorsDeleted = await deleteAll(
      TABLES.ANNOTATORS, annotatorKeys, it => ({ prolific_id: it.prolific_id })
    );

    // 2. Annotations (PK: prolific_id, SK: sort_key)
    const annotationKeys = await scanAllKeys(TABLES.ANNOTATIONS, 'prolific_id, sort_key');
    const annotationsDeleted = await deleteAll(
      TABLES.ANNOTATIONS, annotationKeys, it => ({ prolific_id: it.prolific_id, sort_key: it.sort_key })
    );

    // 3. Telemetry (PK: event_id)
    const telemetryKeys = await scanAllKeys(TABLES.TELEMETRY, 'event_id');
    const telemetryDeleted = await deleteAll(
      TABLES.TELEMETRY, telemetryKeys, it => ({ event_id: it.event_id })
    );

    // 4. SONA meta rows — reset THIS project's pool counter to 0 (keep the
    //    rows themselves so eligibility and metadata survive, and DO NOT
    //    touch other projects' counter columns on the same shared rows).
    const metaRows = await scanAllKeys(TABLES.SONA_ITEMS, 'sona_id, answer_num');
    const metaToReset = metaRows.filter(r => r.answer_num === 'meta');
    let poolReset = 0;
    for (let i = 0; i < metaToReset.length; i += 25) {
      const chunk = metaToReset.slice(i, i + 25);
      await Promise.all(chunk.map(r =>
        db.send(new UpdateCommand({
          TableName: TABLES.SONA_ITEMS,
          Key: { sona_id: r.sona_id, answer_num: 'meta' },
          UpdateExpression: 'SET #col = :zero',
          ExpressionAttributeNames: COL_NAMES,
          ExpressionAttributeValues: { ':zero': 0 },
        })).then(() => { poolReset++; }).catch(() => {})
      ));
    }

    res.json({
      ok: true,
      annotators_deleted:  annotatorsDeleted,
      annotations_deleted: annotationsDeleted,
      telemetry_deleted:   telemetryDeleted,
      pool_counters_reset: poolReset,
      performed_by:        req.admin.username,
      performed_at:        new Date().toISOString(),
    });
  } catch (err) {
    console.error('admin/reset-all', err);
    res.status(500).json({ error: 'Reset failed: ' + err.message });
  }
});

module.exports = router;
