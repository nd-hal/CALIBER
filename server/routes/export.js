const { Router } = require('express');
const { db, TABLES, POOL_COUNTER_COLUMN, ScanCommand, GetCommand } = require('../db/dynamo');
const { requireAuth } = require('../middleware/auth');

const router = Router();

// ── CSV helpers ──────────────────────────────────────────────────────────────
function csvCell(v) {
  if (v === null || v === undefined) return '';
  let s = typeof v === 'object' ? JSON.stringify(v) : String(v);
  // Escape: if contains comma, quote, newline, or CR, wrap in quotes and double up internal quotes
  if (/[",\n\r]/.test(s)) s = '"' + s.replace(/"/g, '""') + '"';
  return s;
}

function csvRow(cells) {
  return cells.map(csvCell).join(',') + '\n';
}

function sendCsv(res, filename, headerRow, rows) {
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.write(csvRow(headerRow));
  for (const r of rows) res.write(csvRow(r));
  res.end();
}

// Extract the annotated text for each STAR frame from annotation HTML.
//
// Highlights may be NESTED — a region tagged with more than one frame produces
// `<span hl-s>…<span hl-t>…</span>…</span>` — so a flat regex per frame can't
// work (it stops at the first inner </span> and truncates the outer frame). We
// tokenise the HTML once, keep a stack of the spans currently open, and
// attribute each text chunk to every frame on the stack. Frames are identified
// by the `hl-{s|t|a|r}` class (present on both human- and LLM-made spans); the
// small `hl-badge` label spans are skipped. Disjoint runs of a frame are joined
// with " | "; adjacent spans of the same frame merge into one run.
//
// Returns { S, T, A, R } with each value a cleaned string ('' when absent).
function extractFrames(html) {
  if (!html) return { S: '', T: '', A: '', R: '' };

  const chunks = [];        // { text, frames: Set<'S'|'T'|'A'|'R'> }
  const stack  = [];        // one entry per open <span>: { frame, badge }
  let badgeDepth = 0;

  const pushText = (raw) => {
    if (!raw || badgeDepth > 0) return; // skip text inside S/T/A/R label badges
    const frames = new Set();
    for (const s of stack) if (s.frame) frames.add(s.frame);
    chunks.push({ text: raw, frames });
  };

  const FRAME_OF = { 'hl-s': 'S', 'hl-t': 'T', 'hl-a': 'A', 'hl-r': 'R' };
  const tagRe = /<(\/?)(\w+)([^>]*)>/g;
  let last = 0;
  let m;
  while ((m = tagRe.exec(String(html))) !== null) {
    pushText(String(html).slice(last, m.index));
    last = tagRe.lastIndex;
    if (m[2].toLowerCase() !== 'span') continue; // only spans carry framing
    if (m[1] === '/') {
      const top = stack.pop();
      if (top && top.badge) badgeDepth--;
      continue;
    }
    const attrs = m[3] || '';
    const clsMatch = attrs.match(/class\s*=\s*["']([^"']*)["']/i);
    const classes = clsMatch ? clsMatch[1].split(/\s+/) : [];
    const badge = classes.includes('hl-badge');
    let frame = null;
    if (!badge) for (const c of classes) if (FRAME_OF[c]) frame = FRAME_OF[c];
    stack.push({ frame, badge });
    if (badge) badgeDepth++;
  }
  pushText(String(html).slice(last));

  const out = {};
  for (const F of ['S', 'T', 'A', 'R']) {
    const runs = [];
    let cur = '';
    for (const c of chunks) {
      if (c.frames.has(F)) cur += c.text;
      else if (cur) { runs.push(cur); cur = ''; }
    }
    if (cur) runs.push(cur);
    out[F] = runs.map(r => r.replace(/\s+/g, ' ').trim()).filter(Boolean).join(' | ');
  }
  return out;
}

// Paginated scan helper — returns all items across all pages
async function scanAll(params) {
  let items = [];
  let lastKey;
  do {
    const r = await db.send(new ScanCommand({ ...params, ExclusiveStartKey: lastKey }));
    items = items.concat(r.Items || []);
    lastKey = r.LastEvaluatedKey;
  } while (lastKey);
  return items;
}

// ── GET /api/admin/export/annotations.csv ────────────────────────────────────
router.get('/annotations.csv', requireAuth, async (req, res) => {
  try {
    const items = await scanAll({ TableName: TABLES.ANNOTATIONS });
    const header = [
      'prolific_id', 'sona_id', 'question', 'step', 'updated_at',
      'g_s_yn', 'g_s_sc', 'g_s_skip',
      'g_t_yn', 'g_t_sc', 'g_t_skip',
      'g_a_yn', 'g_a_sc', 'g_a_skip',
      'g_r_yn', 'g_r_sc', 'g_r_skip',
      'g_bars',
      'situation_text', 'task_text', 'action_text', 'result_text',
      'annotation_html',
    ];
    const rows = items.map(it => {
      const g    = it.grades || {};
      const html = it.annotation_html;
      const f    = extractFrames(html);
      return [
        it.prolific_id, it.sona_id, it.question, it.step, it.updated_at,
        g.g_s_yn, g.g_s_sc, g.g_s_skip,
        g.g_t_yn, g.g_t_sc, g.g_t_skip,
        g.g_a_yn, g.g_a_sc, g.g_a_skip,
        g.g_r_yn, g.g_r_sc, g.g_r_skip,
        g.g_bars,
        f.S, f.T, f.A, f.R,
        html,
      ];
    });
    sendCsv(res, `annotations_${new Date().toISOString().slice(0,10)}.csv`, header, rows);
  } catch (err) {
    console.error('export/annotations', err);
    res.status(500).json({ error: 'Export failed: ' + err.message });
  }
});

// ── GET /api/admin/export/annotators.csv ─────────────────────────────────────
// Annotator metadata: assignment, survey answers (flattened), milestones, timestamps
router.get('/annotators.csv', requireAuth, async (req, res) => {
  try {
    const items = await scanAll({ TableName: TABLES.ANNOTATORS });

    // Collect all survey-answer keys across annotators so columns are consistent
    const surveyKeys = new Set();
    const susKeys    = new Set();
    for (const a of items) {
      for (const k of Object.keys(a.survey_answers || {})) surveyKeys.add(k);
      for (const k of Object.keys(a.sus_answers    || {})) susKeys.add(k);
    }
    // Post-task AI survey (Automation Desire / Human Agency / AI Attitudes / GAAIS).
    const aiKeys = new Set();
    for (const a of items) for (const k of Object.keys(a.ai_survey_answers || {})) aiKeys.add(k);
    // Natural sort (zero-pad embedded numbers) so e.g. gaais_pos_2 precedes gaais_pos_10.
    const natCmp = (a, b) =>
      a.replace(/\d+/g, n => n.padStart(6, '0')).localeCompare(b.replace(/\d+/g, n => n.padStart(6, '0')));

    const sortedSurveyKeys = [...surveyKeys].sort();
    const sortedSusKeys    = [...susKeys].sort();
    const sortedAiKeys     = [...aiKeys].sort(natCmp);

    const header = [
      'prolific_id', 'study_id', 'session_id', 'session_count',
      'created_at', 'last_seen', 'submitted_at',
      'consent_done', 'survey_done', 'tutorial_done', 'onboarding_done', 'sus_done',
      'task_annotation_done', 'task_scoring_done', 'task_bars_done', 'task_checklist_done',
      'audio_opt_in', 'reset_version', 'is_returning_session',
      'assigned_sona_ids', 'completed_sona_ids', 'assigned_count', 'completed_count',
      'sessions_count', 'sessions_history', 'current_session_items',
      ...sortedSurveyKeys.flatMap(k => [`${k}_value`, `${k}_label`]),
      ...sortedSusKeys.flatMap(k => [`${k}_value`, `${k}_label`]),
      // Post-task AI survey
      'ai_survey_done',
      ...sortedAiKeys.flatMap(k => [`${k}_value`, `${k}_label`]),
    ];

    const flatten = (obj, keys) => keys.flatMap(k => {
      const ans = obj?.[k];
      if (ans && typeof ans === 'object') return [ans.response_value, ans.response_label];
      return [ans ?? '', ''];
    });

    // Format each session as "n=1;items=A,B,C;started=ISO;submitted=ISO" and join with " | "
    const formatSessions = (sessions) => {
      if (!Array.isArray(sessions) || !sessions.length) return '';
      return sessions.map(s => {
        const items = Array.isArray(s.items) ? s.items.join(',') : '';
        return `n=${s.n};items=${items};started=${s.started_at || ''};submitted=${s.submitted_at || ''}`;
      }).join(' | ');
    };

    const rows = items.map(a => [
      a.prolific_id, a.study_id, a.session_id, a.session_count,
      a.created_at, a.last_seen, a.submitted_at,
      a.consent_done, a.survey_done, a.tutorial_done, a.onboarding_done, a.sus_done,
      a.task_annotation_done, a.task_scoring_done, a.task_bars_done, a.task_checklist_done,
      a.audio_opt_in, a.reset_version, a.is_returning_session,
      (a.assigned_sona_ids || []).join('|'),
      (a.completed_sona_ids || []).join('|'),
      (a.assigned_sona_ids || []).length,
      (a.completed_sona_ids || []).length,
      Array.isArray(a.sessions) ? a.sessions.length : 0,
      formatSessions(a.sessions),
      (a.current_session_items || []).join('|'),
      ...flatten(a.survey_answers, sortedSurveyKeys),
      ...flatten(a.sus_answers,    sortedSusKeys),
      a.ai_survey_done || false,
      ...flatten(a.ai_survey_answers, sortedAiKeys),
    ]);
    sendCsv(res, `annotators_${new Date().toISOString().slice(0,10)}.csv`, header, rows);
  } catch (err) {
    console.error('export/annotators', err);
    res.status(500).json({ error: 'Export failed: ' + err.message });
  }
});

// ── GET /api/admin/export/pool.csv ───────────────────────────────────────────
// Snapshot of the shrinking-pool / breadth-first randomization state. One row
// per SONA item with its pool counter, target, remaining draws, and the list
// of annotators who got / completed it.
router.get('/pool.csv', requireAuth, async (req, res) => {
  try {
    const [sonaResult, annotatorsResult, annotationsResult, configResult] = await Promise.all([
      scanAll({
        TableName: TABLES.SONA_ITEMS,
        FilterExpression: 'answer_num = :m',
        ExpressionAttributeValues: { ':m': 'meta' },
      }),
      scanAll({
        TableName: TABLES.ANNOTATORS,
        ProjectionExpression: 'prolific_id, assigned_sona_ids, completed_sona_ids',
      }),
      scanAll({
        TableName: TABLES.ANNOTATIONS,
        ProjectionExpression: 'prolific_id, sona_id, question, #s',
        ExpressionAttributeNames: { '#s': 'step' },
      }),
      db.send(new GetCommand({ TableName: TABLES.CONFIG, Key: { pk: 'global' } })),
    ]);
    const target = configResult.Item?.target_annotations_per_item || 1;

    // Per-SONA: who got it, who finished both Q1+Q2, who's mid-grading
    const assignedBy = {}, completedBy = {};
    for (const a of annotatorsResult) {
      for (const sid of (a.assigned_sona_ids || []))   (assignedBy[sid]  ||= []).push(a.prolific_id);
      for (const sid of (a.completed_sona_ids || []))  (completedBy[sid] ||= []).push(a.prolific_id);
    }
    // Cross-check completed against the annotations table — sometimes the
    // annotator's `completed_sona_ids` is stale. Build a separate ground-truth
    // set of "(prolific_id, sona_id) where both Q1 and Q2 are step='done'".
    const stepsBy = {}; // sona_id -> prolific_id -> { q1, q2 }
    for (const ann of annotationsResult) {
      const s = stepsBy[ann.sona_id] ||= {};
      const p = s[ann.prolific_id] ||= {};
      p[ann.question] = ann.step;
    }
    const completedFromAnnotationsBy = {};
    const inProgressBy = {};
    for (const [sid, byPid] of Object.entries(stepsBy)) {
      for (const [pid, qs] of Object.entries(byPid)) {
        if (qs.q1 === 'done' && qs.q2 === 'done') (completedFromAnnotationsBy[sid] ||= []).push(pid);
        else (inProgressBy[sid] ||= []).push(pid);
      }
    }

    const header = [
      'sona_id', 'experiment', 'group', 'eligible',
      'pool_count', 'target', 'remaining', 'status',
      'assigned_count', 'completed_count', 'in_progress_count',
      'annotators_assigned',
      'annotators_completed_per_record',
      'annotators_completed_from_annotations',
      'annotators_in_progress',
      'last_scanned',
    ];

    const rows = sonaResult.map(it => {
      // Project-scoped pool counter — paa uses `assigned_count`, sister
      // projects override via POOL_COUNTER_COLUMN env var.
      const poolCount = it[POOL_COUNTER_COLUMN] || 0;
      const remaining = target - poolCount;
      const status =
        !it.eligible           ? 'Ineligible' :
        poolCount === 0        ? 'Untouched' :
        poolCount <  target    ? 'Available' :
        poolCount === target   ? 'Filled' :
                                 'Over-target';
      const assigned    = assignedBy[it.sona_id] || [];
      const completedR  = completedBy[it.sona_id] || [];
      const completedA  = completedFromAnnotationsBy[it.sona_id] || [];
      const inProgress  = inProgressBy[it.sona_id] || [];
      return [
        it.sona_id, it.experiment || '—', it.group || '—', it.eligible ? 'yes' : 'no',
        poolCount, target, remaining, status,
        assigned.length, completedA.length, inProgress.length,
        assigned.join('|'),
        completedR.join('|'),
        completedA.join('|'),
        inProgress.join('|'),
        it.last_scanned || '',
      ];
    }).sort((a, b) => String(a[0]).localeCompare(String(b[0])));

    sendCsv(res, `pool_status_${new Date().toISOString().slice(0,10)}.csv`, header, rows);
  } catch (err) {
    console.error('export/pool', err);
    res.status(500).json({ error: 'Export failed: ' + err.message });
  }
});

// ── GET /api/admin/export/telemetry.csv?type=click|mouse_move|step_time|screen_time|all ──
router.get('/telemetry.csv', requireAuth, async (req, res) => {
  const type = String(req.query.type || 'all');
  try {
    const params = { TableName: TABLES.TELEMETRY };
    if (type !== 'all') {
      params.FilterExpression = 'event_type = :t';
      params.ExpressionAttributeValues = { ':t': type };
    }
    const items = await scanAll(params);

    // Click event_data shape: { x, y, tag, id, cls, text, graderId, sessionId, ts, elapsed_s }
    // Mouse event_data shape: { x, y, vw, vh, graderId, sessionId, ts, elapsed_s }
    // step_time:    { participant, question, from_step, ms, graderId, ts }
    // screen_time:  { from_screen, ms, graderId, ts }
    //
    // We export a wide CSV with every column that any event type might fill.
    const header = [
      'event_id', 'prolific_id', 'event_type', 'ts', 'session_id', 'elapsed_s',
      // mouse / click coords
      'x', 'y', 'vw', 'vh',
      // click target
      'tag', 'element_id', 'cls', 'text',
      // step_time / annotation events
      'participant', 'question', 'from_step', 'ms', 'frame',
      // annotation span detail (annotation_created / _updated / _removed)
      'selected_text', 'span_start', 'span_end', 'html_len', 'char_count',
      // grade_changed
      'grade_name', 'grade_value', 'grade_prev_value', 'grading_step',
      // scroll
      'scroll_top', 'scroll_height', 'client_height',
      // screen_time
      'from_screen',
      // session_meta — device / environment fingerprint (set once per session)
      'screen_w', 'screen_h', 'screen_avail_w', 'screen_avail_h', 'dpr',
      'ua', 'platform', 'ua_brands', 'ua_mobile', 'ua_platform',
      'language', 'languages', 'timezone', 'tz_offset_min',
      'net_effective_type', 'net_downlink_mbps', 'net_rtt_ms', 'net_save_data',
      'hw_concurrency', 'device_memory_gb',
      'touch', 'max_touch_pts', 'cookie_enabled',
      'referrer', 'origin', 'path',
      // server-stamped request metadata (every row)
      'client_ip', 'server_ua', 'accept_language', 'server_referrer', 'received_at',
    ];

    const rows = items.map(it => {
      const e = it.event_data || {};
      return [
        it.event_id, it.prolific_id, it.event_type, it.ts, it.session_id, e.elapsed_s,
        e.x, e.y, e.vw, e.vh,
        e.tag, e.id, e.cls, e.text,
        e.participant, e.question, e.from_step, e.ms, e.frame,
        e.selected_text, e.span_start, e.span_end, e.html_len, e.char_count,
        e.name, e.value, e.prev_value, e.grading_step,
        e.scroll_top, e.scroll_height, e.client_height,
        e.from_screen,
        // session_meta fields — only populated on rows where event_type='session_meta'
        e.screen_w, e.screen_h, e.screen_avail_w, e.screen_avail_h, e.dpr,
        e.ua, e.platform, e.ua_brands, e.ua_mobile, e.ua_platform,
        e.language, e.languages, e.timezone, e.tz_offset_min,
        e.net_effective_type, e.net_downlink_mbps, e.net_rtt_ms, e.net_save_data,
        e.hw_concurrency, e.device_memory_gb,
        e.touch, e.max_touch_pts, e.cookie_enabled,
        e.referrer, e.origin, e.path,
        // server-stamped (every row)
        it.client_ip, it.server_ua, it.accept_language, it.server_referrer, it.received_at,
      ];
    });

    const suffix = type === 'all' ? 'all' : type;
    sendCsv(res, `telemetry_${suffix}_${new Date().toISOString().slice(0,10)}.csv`, header, rows);
  } catch (err) {
    console.error('export/telemetry', err);
    res.status(500).json({ error: 'Export failed: ' + err.message });
  }
});

module.exports = router;
module.exports.extractFrames = extractFrames; // exposed for unit testing
