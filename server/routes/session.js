const { Router } = require('express');
const { S3Client, GetObjectCommand } = require('@aws-sdk/client-s3');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');
const {
  db, TABLES, POOL_COUNTER_COLUMN,
  GetCommand, PutCommand, UpdateCommand,
} = require('../db/dynamo');
const { drawFromPool } = require('../lib/pool');
const { hydratePhrases } = require('../lib/hydrate');
const { getModel: getLlmModel } = require('../lib/llmEligibility');

function touchLastSeen(prolific_id) {
  db.send(new UpdateCommand({
    TableName: TABLES.ANNOTATORS,
    Key: { prolific_id },
    UpdateExpression: 'SET last_seen = :now',
    ExpressionAttributeValues: { ':now': new Date().toISOString() },
  })).catch(() => {});
}

const router = Router();

const s3 = new S3Client({ region: process.env.AWS_REGION || 'us-east-1' });

const DATA_BUCKET = process.env.DATA_BUCKET || 'researchdata-mendozaresearch';

async function signedAudioUrl(s3Key) {
  if (!s3Key) return null;
  const cmd = new GetObjectCommand({ Bucket: DATA_BUCKET, Key: s3Key });
  return getSignedUrl(s3, cmd, { expiresIn: 3600 });
}

const TUTORIAL_AUDIO_KEYS = {
  1: ['researchdata/behavioral_interview_recordings/data/tutorial_audios/Slide_2.mp3'],
  2: ['researchdata/behavioral_interview_recordings/data/tutorial_audios/Slide3.mp3'],
  3: [
    'researchdata/behavioral_interview_recordings/data/tutorial_audios/Slide3_a.mp3',
    'researchdata/behavioral_interview_recordings/data/tutorial_audios/Slide3b.m4a',
  ],
  5: ['researchdata/behavioral_interview_recordings/data/tutorial_audios/Slide8.mp3'],
  tour_0: ['researchdata/behavioral_interview_recordings/data/tutorial_audios/Slide14.mp3'],
  tour_1: ['researchdata/behavioral_interview_recordings/data/tutorial_audios/Slide15a.mp3'],
  tour_2: ['researchdata/behavioral_interview_recordings/data/tutorial_audios/Slide15b.mp3'],
  tour_3: ['researchdata/behavioral_interview_recordings/data/tutorial_audios/Slide15c.mp3'],
  tour_4:  ['researchdata/behavioral_interview_recordings/data/tutorial_audios/Slide15d.mp3'],
  tour_6:  ['researchdata/behavioral_interview_recordings/data/tutorial_audios/Slide17b.mp3'],
  tour_7:  ['researchdata/behavioral_interview_recordings/data/tutorial_audios/Slide17c.mp3'],
  tour_8:  ['researchdata/behavioral_interview_recordings/data/tutorial_audios/Slide18a.mp3'],
  tour_9:  ['researchdata/behavioral_interview_recordings/data/tutorial_audios/Slide18b.mp3'],
  tour_10: ['researchdata/behavioral_interview_recordings/data/tutorial_audios/Slide19.mp3'],
  tour_11: ['researchdata/behavioral_interview_recordings/data/tutorial_audios/Slide21and22.mp3'],
  tour_16: ['researchdata/behavioral_interview_recordings/data/tutorial_audios/Slide23.mp3'],
  tour_18: ['researchdata/behavioral_interview_recordings/data/tutorial_audios/Slide25.mp3'],
};

async function getConfig() {
  const r = await db.send(new GetCommand({ TableName: TABLES.CONFIG, Key: { pk: 'global' } }));
  return r.Item || { annotations_per_user: 2 };
}

// POST /api/session/start  — create or resume an annotator session
router.post('/start', async (req, res) => {
  const { prolific_id, study_id, session_id } = req.body;
  if (!prolific_id?.trim()) return res.status(400).json({ error: 'Missing prolific_id' });

  const pid = prolific_id.trim();

  try {
    let annotator = (await db.send(new GetCommand({
      TableName: TABLES.ANNOTATORS,
      Key: { prolific_id: pid },
    }))).Item;

    const config = await getConfig();

    if (!annotator) {
      // ── First-time annotator: draw N items from the shrinking pool ──
      const target = config.target_annotations_per_item || 1;
      const N      = config.annotations_per_user || 2;
      const draw   = await drawFromPool(N, target);
      if (!draw.ok) {
        return res.status(409).json({
          error: 'STUDY_FULL',
          message: 'This study is currently full. Please contact the researcher if you believe this is a mistake.',
          pool_remaining: draw.pool_remaining,
          required: draw.required,
        });
      }

      const nowIso = new Date().toISOString();
      annotator = {
        prolific_id: pid,
        assigned_sona_ids: draw.claimed,
        completed_sona_ids: [],
        // Per-session bookkeeping. Each session entry tracks the items drawn
        // that session, when it started, and when (if ever) the annotator hit
        // Submit to Prolific. The current_session_items field is what the
        // annotator UI iterates over so returning annotators only see the
        // items they were just drawn (not their historical completed ones).
        sessions: [{ n: 1, items: draw.claimed, started_at: nowIso, submitted_at: null }],
        current_session_items: draw.claimed,
        session_count: 1,
        survey_done: false,
        tutorial_done: false,
        onboarding_done: false,
        survey_answers: {},
        created_at: nowIso,
        ...(study_id   ? { study_id }   : {}),
        ...(session_id ? { session_id } : {}),
      };

      try {
        await db.send(new PutCommand({
          TableName: TABLES.ANNOTATORS,
          Item: annotator,
          ConditionExpression: 'attribute_not_exists(prolific_id)',
        }));
      } catch (condErr) {
        // Race: another request just created this annotator. Release our claims
        // back into the pool and re-fetch the existing record.
        await Promise.all(draw.claimed.map(sid =>
          db.send(new UpdateCommand({
            TableName: TABLES.SONA_ITEMS,
            Key: { sona_id: sid, answer_num: 'meta' },
            UpdateExpression: 'SET #col = #col - :one',
            ConditionExpression: '#col > :zero',
            ExpressionAttributeNames: { '#col': POOL_COUNTER_COLUMN },
            ExpressionAttributeValues: { ':one': 1, ':zero': 0 },
          })).catch(() => {})
        ));
        annotator = (await db.send(new GetCommand({
          TableName: TABLES.ANNOTATORS,
          Key: { prolific_id: pid },
        }))).Item;
      }
    } else if (
      // ── Released/orphan: needs a fresh draw because either ──
      //   (a) a previous session's items were released by the stale-sweep
      //       (current_session_items emptied, sessions[last].released_at set), or
      //   (b) the record exists with no items at all (admin Reset All while
      //       the browser kept a stale onboarding flag).
      // Detection: current_session_items is empty AND this isn't a fresh
      // post-submit returning visit (that's the next branch). The branch
      // appends a NEW session entry so the per-session history grows; items
      // already shown to this annotator (assigned / completed / released /
      // any prior session.items) are excluded so they get genuinely NEW ones.
      (!Array.isArray(annotator.current_session_items) || annotator.current_session_items.length === 0) &&
      !(annotator.submitted_at && !annotator.is_returning_session)
    ) {
      const target = config.target_annotations_per_item || 1;
      // Use the returning N if they've ever submitted (a previous full visit
      // ended cleanly); otherwise the first-time N.
      const N = annotator.submitted_at
        ? (config.returning_annotations_per_user || 4)
        : (config.annotations_per_user || 2);

      // Exclude every item this annotator has ever seen: currently assigned
      // (typically just their completed items at this point), explicitly
      // completed, released by the sweep, and any items from prior session
      // entries (covers legacy records without released_sona_ids).
      const seenSet = new Set([
        ...(annotator.assigned_sona_ids || []),
        ...(annotator.completed_sona_ids || []),
        ...(annotator.released_sona_ids || []),
        ...((annotator.sessions || []).flatMap(s => Array.isArray(s.items) ? s.items : [])),
      ]);
      const draw = await drawFromPool(N, target, [...seenSet]);
      if (!draw.ok) {
        return res.status(409).json({
          error: 'STUDY_FULL',
          message: 'This study is currently full. Please contact the researcher if you believe this is a mistake.',
          pool_remaining: draw.pool_remaining,
          required: draw.required,
        });
      }

      const nowIso       = new Date().toISOString();
      const priorSessions = Array.isArray(annotator.sessions) ? annotator.sessions : [];
      const lastN        = priorSessions.reduce((m, s) => Math.max(m, s.n || 0), 0);
      const newN         = lastN + 1 || 1;
      const newSessions  = [
        ...priorSessions,
        { n: newN, items: draw.claimed, started_at: nowIso, submitted_at: null },
      ];
      const newAssigned  = [...(annotator.assigned_sona_ids || []), ...draw.claimed];

      await db.send(new UpdateCommand({
        TableName: TABLES.ANNOTATORS,
        Key: { prolific_id: pid },
        UpdateExpression:
          'SET assigned_sona_ids = :ids, sessions = :sess, current_session_items = :cur, ' +
          'session_count = :sc, is_returning_session = :true, ' +
          'created_at = if_not_exists(created_at, :now) ' +
          'REMOVE consent_done, submitted_at',
        ExpressionAttributeValues: {
          ':ids':  newAssigned,
          ':sess': newSessions,
          ':cur':  draw.claimed,
          ':sc':   newN,
          ':true': true,
          ':now':  nowIso,
        },
      }));
      annotator.assigned_sona_ids     = newAssigned;
      annotator.sessions              = newSessions;
      annotator.current_session_items = draw.claimed;
      annotator.session_count         = newN;
      annotator.is_returning_session  = true;
      annotator.consent_done          = false;
      annotator.submitted_at          = null;
    } else if (annotator.submitted_at && !annotator.is_returning_session) {
      // ── Returning annotator: previously submitted, this is a NEW session ──
      // Draw additional items, append to assigned_sona_ids, force re-consent,
      // and skip training. Flag persists until they submit this session.
      const target  = config.target_annotations_per_item || 1;
      const Nreturn = config.returning_annotations_per_user || 4;
      const existing = annotator.assigned_sona_ids || [];
      const draw     = await drawFromPool(Nreturn, target, existing);
      if (!draw.ok) {
        return res.status(409).json({
          error: 'STUDY_FULL',
          message: 'This study is currently full. Please contact the researcher if you believe this is a mistake.',
          pool_remaining: draw.pool_remaining,
          required: draw.required,
        });
      }
      const newAssigned  = [...existing, ...draw.claimed];
      const sessionCount = (annotator.session_count || 1) + 1;
      const nowIso       = new Date().toISOString();
      // Backfill `sessions` if this annotator predates the per-session tracking
      const priorSessions = Array.isArray(annotator.sessions) && annotator.sessions.length
        ? annotator.sessions
        : [{
            n: 1,
            items: existing,
            started_at: annotator.created_at || null,
            submitted_at: annotator.submitted_at || null,
          }];
      const newSessions = [
        ...priorSessions,
        { n: sessionCount, items: draw.claimed, started_at: nowIso, submitted_at: null },
      ];
      await db.send(new UpdateCommand({
        TableName: TABLES.ANNOTATORS,
        Key: { prolific_id: pid },
        UpdateExpression:
          'SET assigned_sona_ids = :ids, is_returning_session = :true, session_count = :sc, ' +
          'sessions = :sess, current_session_items = :cur ' +
          'REMOVE consent_done, submitted_at',
        ExpressionAttributeValues: {
          ':ids': newAssigned,
          ':true': true,
          ':sc': sessionCount,
          ':sess': newSessions,
          ':cur': draw.claimed,
        },
      }));
      annotator.assigned_sona_ids    = newAssigned;
      annotator.is_returning_session = true;
      annotator.session_count        = sessionCount;
      annotator.sessions             = newSessions;
      annotator.current_session_items = draw.claimed;
      annotator.consent_done         = false;
      annotator.submitted_at        = null;
    }

    touchLastSeen(pid);

    // Update study_id / session_id if we received them and they're not yet set.
    // This catches returning annotators who first arrived without URL params.
    if ((study_id && !annotator.study_id) || (session_id && !annotator.session_id)) {
      const updates = [];
      const vals = {};
      if (study_id && !annotator.study_id)     { updates.push('study_id = :sid');   vals[':sid'] = study_id;   annotator.study_id = study_id; }
      if (session_id && !annotator.session_id) { updates.push('session_id = :sess'); vals[':sess'] = session_id; annotator.session_id = session_id; }
      db.send(new UpdateCommand({
        TableName: TABLES.ANNOTATORS,
        Key: { prolific_id: pid },
        UpdateExpression: 'SET ' + updates.join(', '),
        ExpressionAttributeValues: vals,
      })).catch(() => {});
    }

    // Backfill task flags: legacy annotators who finished onboarding before the
    // task_*_done flags existed (or the legacy onboarding modal was removed)
    // never got these flags set. If onboarding_done is true, they must have
    // completed all 4 grading tasks during the tour — set them now.
    if (annotator.onboarding_done && !annotator.task_checklist_done) {
      const backfill = {
        task_annotation_done: true,
        task_scoring_done:    true,
        task_bars_done:       true,
        task_checklist_done:  true,
      };
      Object.assign(annotator, backfill);
      db.send(new UpdateCommand({
        TableName: TABLES.ANNOTATORS,
        Key: { prolific_id: pid },
        UpdateExpression: 'SET task_annotation_done = :t, task_scoring_done = :t, task_bars_done = :t, task_checklist_done = :t',
        ExpressionAttributeValues: { ':t': true },
      })).catch(() => {});
    }

    res.json({
      prolific_id: pid,
      survey_done: annotator.survey_done || false,
      tutorial_done: annotator.tutorial_done || false,
      onboarding_done: annotator.onboarding_done || false,
      consent_done: annotator.consent_done || false,
      audio_opt_in: annotator.audio_opt_in,
      reset_version: annotator.reset_version || 0,
      submitted_at: annotator.submitted_at || null,
      is_returning_session: annotator.is_returning_session || false,
      session_count: annotator.session_count || 1,
      current_session_items: annotator.current_session_items || annotator.assigned_sona_ids || [],
      sessions: annotator.sessions || null,
      sus_done: annotator.sus_done || false,
      ai_survey_done: annotator.ai_survey_done || false,
      completion_code: config.completion_code || '',
      survey_answers: annotator.survey_answers || {},
      assigned_sona_ids: annotator.assigned_sona_ids || [],
      completed_count: (annotator.completed_sona_ids || []).length,
      annotations_per_user: config.annotations_per_user,
    });
  } catch (err) {
    console.error('session/start', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// PATCH /api/session/profile  — save survey/tutorial/onboarding progress
router.patch('/profile', async (req, res) => {
  const {
    prolific_id, survey_done, tutorial_done, onboarding_done, consent_done, audio_opt_in, survey_answers,
    task_annotation_done, task_scoring_done, task_bars_done, task_checklist_done,
    sus_done, sus_answers,
    ai_survey_done, ai_survey_answers,
  } = req.body;
  if (!prolific_id) return res.status(400).json({ error: 'Missing prolific_id' });

  const updates = {};
  if (survey_done            !== undefined) updates.survey_done            = survey_done;
  if (tutorial_done          !== undefined) updates.tutorial_done          = tutorial_done;
  if (onboarding_done        !== undefined) updates.onboarding_done        = onboarding_done;
  if (consent_done           !== undefined) updates.consent_done           = consent_done;
  if (audio_opt_in           !== undefined) updates.audio_opt_in           = audio_opt_in;
  if (survey_answers         !== undefined) updates.survey_answers         = survey_answers;
  if (task_annotation_done   !== undefined) updates.task_annotation_done   = task_annotation_done;
  if (task_scoring_done      !== undefined) updates.task_scoring_done      = task_scoring_done;
  if (task_bars_done         !== undefined) updates.task_bars_done         = task_bars_done;
  if (task_checklist_done    !== undefined) updates.task_checklist_done    = task_checklist_done;
  if (sus_done               !== undefined) updates.sus_done               = sus_done;
  if (sus_answers            !== undefined) updates.sus_answers            = sus_answers;
  if (ai_survey_done         !== undefined) updates.ai_survey_done         = ai_survey_done;
  if (ai_survey_answers      !== undefined) updates.ai_survey_answers      = ai_survey_answers;

  if (!Object.keys(updates).length) return res.json({ ok: true });

  try {
    const setExprs  = Object.keys(updates).map(k => `#${k} = :${k}`);
    const exprNames = Object.fromEntries(Object.keys(updates).map(k => [`#${k}`, k]));
    const exprVals  = Object.fromEntries(Object.keys(updates).map(k => [`:${k}`, updates[k]]));

    await db.send(new UpdateCommand({
      TableName: TABLES.ANNOTATORS,
      Key: { prolific_id },
      UpdateExpression: `SET ${setExprs.join(', ')}`,
      ExpressionAttributeNames: exprNames,
      ExpressionAttributeValues: exprVals,
    }));

    res.json({ ok: true });
  } catch (err) {
    console.error('session/profile', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// GET /api/session/items/:prolific_id  — return assigned SONA items with signed URLs + saved progress
router.get('/items/:prolific_id', async (req, res) => {
  const { prolific_id } = req.params;

  try {
    const annotator = (await db.send(new GetCommand({
      TableName: TABLES.ANNOTATORS,
      Key: { prolific_id },
    }))).Item;

    if (!annotator) return res.status(404).json({ error: 'Annotator not found' });

    touchLastSeen(prolific_id);

    const { assigned_sona_ids = [] } = annotator;
    const items = {};

    const llmModel = getLlmModel();

    for (const sona_id of assigned_sona_ids) {
      const [q1Item, q2Item, ann_q1, ann_q2, llm_q1, llm_q2] = await Promise.all([
        db.send(new GetCommand({ TableName: TABLES.SONA_ITEMS,  Key: { sona_id, answer_num: 'q1' } })),
        db.send(new GetCommand({ TableName: TABLES.SONA_ITEMS,  Key: { sona_id, answer_num: 'q2' } })),
        db.send(new GetCommand({ TableName: TABLES.ANNOTATIONS, Key: { prolific_id, sort_key: `${sona_id}#q1` } })),
        db.send(new GetCommand({ TableName: TABLES.ANNOTATIONS, Key: { prolific_id, sort_key: `${sona_id}#q2` } })),
        db.send(new GetCommand({ TableName: TABLES.LLM_GRADES,  Key: { sona_id, model_question: `${llmModel}#q1` } })),
        db.send(new GetCommand({ TableName: TABLES.LLM_GRADES,  Key: { sona_id, model_question: `${llmModel}#q2` } })),
      ]);

      const [url_q1, url_q2] = await Promise.all([
        signedAudioUrl(q1Item.Item?.audio_s3_key),
        signedAudioUrl(q2Item.Item?.audio_s3_key),
      ]);

      // Hydrate from the LLM ONLY when the annotator has no saved work yet
      // for this (sona, q). Once they save, their edits become source of truth.
      function hydrateOrUse(savedAnn, sonaQ, llmRow) {
        const transcript = sonaQ.Item?.transcript || '';
        if (savedAnn.Item) {
          return {
            transcript,
            grades:          savedAnn.Item.grades || {},
            annotation_html: savedAnn.Item.annotation_html || null,
            step:            savedAnn.Item.step || 1,
          };
        }
        if (llmRow.Item) {
          // Pre-populate ONLY the STAR highlights from the LLM. Scores
          // (presence Yes/No, structural 1–5, BARS) are intentionally left
          // blank so the annotator grades those themselves — the task copy
          // tells them the AI provides annotations only, not scores.
          const { html } = hydratePhrases(transcript, llmRow.Item);
          return {
            transcript,
            grades:          {},
            annotation_html: html,
            step:            1,
            llm_hydrated:    true,
          };
        }
        return { transcript, grades: {}, annotation_html: null, step: 1 };
      }

      items[sona_id] = {
        q1: { ...hydrateOrUse(ann_q1, q1Item, llm_q1), audio_url: url_q1 },
        q2: { ...hydrateOrUse(ann_q2, q2Item, llm_q2), audio_url: url_q2 },
      };
    }

    res.json({
      items,
      reset_version: annotator.reset_version || 0,
      // Subset of assigned_sona_ids that were drawn in the latest session;
      // the annotator UI uses this to hide previously-completed items on returns.
      current_session_items: annotator.current_session_items || annotator.assigned_sona_ids || [],
    });
  } catch (err) {
    console.error('session/items', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// GET /api/session/tutorial-audio  — pre-signed URLs for tutorial narration files
router.get('/tutorial-audio', async (_req, res) => {
  try {
    const result = {};
    for (const [step, keys] of Object.entries(TUTORIAL_AUDIO_KEYS)) {
      result[step] = await Promise.all(keys.map(k => signedAudioUrl(k)));
    }
    res.json({ urls: result });
  } catch (err) {
    console.error('session/tutorial-audio', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// POST /api/session/heartbeat  — keeps annotator last_seen fresh while on the app
router.post('/heartbeat', async (req, res) => {
  const { prolific_id } = req.body;
  if (!prolific_id) return res.status(400).json({ error: 'Missing prolific_id' });
  touchLastSeen(prolific_id.trim());
  res.json({ ok: true });
});

// POST /api/session/complete  — stamp submitted_at when annotator finishes
router.post('/complete', async (req, res) => {
  const pid = req.body?.prolific_id?.trim();
  if (!pid) return res.status(400).json({ error: 'Missing prolific_id' });
  try {
    const [config, annotatorResult] = await Promise.all([
      getConfig(),
      db.send(new GetCommand({ TableName: TABLES.ANNOTATORS, Key: { prolific_id: pid } })),
    ]);
    const nowIso = new Date().toISOString();

    // Stamp submitted_at on the annotator AND on the latest session entry so
    // the admin can see per-session submit times in the export / progress view.
    // Clear is_returning_session so the NEXT visit triggers another fresh draw.
    const annotator = annotatorResult.Item || {};
    const sessions  = Array.isArray(annotator.sessions) ? annotator.sessions.slice() : [];
    if (sessions.length) {
      sessions[sessions.length - 1] = { ...sessions[sessions.length - 1], submitted_at: nowIso };
    }
    await db.send(new UpdateCommand({
      TableName: TABLES.ANNOTATORS,
      Key: { prolific_id: pid },
      UpdateExpression:
        'SET submitted_at = :now' + (sessions.length ? ', sessions = :sess' : '') +
        ' REMOVE is_returning_session',
      ExpressionAttributeValues: sessions.length
        ? { ':now': nowIso, ':sess': sessions }
        : { ':now': nowIso },
    }));
    res.json({ ok: true, completion_code: config.completion_code || '' });
  } catch (err) {
    console.error('session/complete', err);
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;
