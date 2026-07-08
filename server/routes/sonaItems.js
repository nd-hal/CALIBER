const { Router } = require('express');
const { S3Client, ListObjectsV2Command, GetObjectCommand, HeadObjectCommand } = require('@aws-sdk/client-s3');
const { db, TABLES, POOL_COUNTER_COLUMN, GetCommand, PutCommand, UpdateCommand, ScanCommand } = require('../db/dynamo');

// Reuse the same #col alias as server/lib/pool.js and server/routes/admin.js
const COL_NAMES = { '#col': POOL_COUNTER_COLUMN };
const { requireAuth } = require('../middleware/auth');

const router = Router();
const s3 = new S3Client({ region: process.env.AWS_REGION || 'us-east-1' });

const DATA_BUCKET = process.env.DATA_BUCKET || 'researchdata-mendozaresearch';
const DATA_PREFIX  = 'researchdata/behavioral_interview_recordings/data/';

// ── S3 helpers ────────────────────────────────────────────────────────────────

async function s3GetJson(key) {
  const resp = await s3.send(new GetObjectCommand({ Bucket: DATA_BUCKET, Key: key }));
  const chunks = [];
  for await (const chunk of resp.Body) chunks.push(chunk);
  return JSON.parse(Buffer.concat(chunks).toString('utf-8'));
}

async function s3Exists(key) {
  try { await s3.send(new HeadObjectCommand({ Bucket: DATA_BUCKET, Key: key })); return true; }
  catch { return false; }
}

async function listAllObjects(prefix) {
  const keys = [];
  let token;
  do {
    const resp = await s3.send(new ListObjectsV2Command({
      Bucket: DATA_BUCKET, Prefix: prefix, MaxKeys: 1000, ContinuationToken: token,
    }));
    (resp.Contents || []).forEach(o => keys.push(o.Key));
    token = resp.NextContinuationToken;
  } while (token);
  return keys;
}

// ── POST /api/admin/sona-items/scan ───────────────────────────────────────────
// Discover all SONA IDs in S3 with an annotated/ folder and populate DynamoDB.
// Presence of annotated/ means the data has been manually validated.
router.post('/scan', requireAuth, async (req, res) => {
  try {
    const allKeys = await listAllObjects(DATA_PREFIX);
    const metaKeys = allKeys.filter(k => k.endsWith('annotated/metadata.json'));

    const results = await Promise.all(metaKeys.map(async metaKey => {
      // Path: ...data/{exp}/{group}/{sona_id}/annotated/metadata.json
      const parts    = metaKey.split('/');
      const annotIdx = parts.indexOf('annotated');
      const sona_id   = parts[annotIdx - 1];
      const group      = parts[annotIdx - 2];
      const experiment = parts[annotIdx - 3];
      const base       = metaKey.replace('metadata.json', '');

      try {
        const [hasQ1Audio, hasQ2Audio, hasQ1Trans, hasQ2Trans] = await Promise.all([
          s3Exists(`${base}answer1.wav`),
          s3Exists(`${base}answer2.wav`),
          s3Exists(`${base}answer1_transcript.json`),
          s3Exists(`${base}answer2_transcript.json`),
        ]);

        const [q1Trans, q2Trans] = await Promise.all([
          hasQ1Trans
            ? s3GetJson(`${base}answer1_transcript.json`).then(j => j?.results?.transcripts?.[0]?.transcript || '').catch(() => '')
            : Promise.resolve(''),
          hasQ2Trans
            ? s3GetJson(`${base}answer2_transcript.json`).then(j => j?.results?.transcripts?.[0]?.transcript || '').catch(() => '')
            : Promise.resolve(''),
        ]);

        const hasCompleteData = hasQ1Audio && hasQ1Trans && hasQ2Audio && hasQ2Trans;

        // Use UpdateCommand (not Put) on the meta row so any per-project pool
        // counter columns (assigned_count, assigned_count_caliber, etc.) and
        // any other admin-set fields are preserved by default. Eligibility is
        // preserved with `if_not_exists` so the admin's manual toggle survives
        // a re-scan; only the first scan sets it from hasCompleteData.
        await Promise.all([
          db.send(new UpdateCommand({
            TableName: TABLES.SONA_ITEMS,
            Key: { sona_id, answer_num: 'meta' },
            UpdateExpression:
              'SET experiment = :exp, #grp = :grp, ' +
              'has_q1_audio = :h1a, has_q1_transcript = :h1t, ' +
              'has_q2_audio = :h2a, has_q2_transcript = :h2t, ' +
              'eligible = if_not_exists(eligible, :elig), ' +
              'last_scanned = :ts',
            ExpressionAttributeNames: { '#grp': 'group' },
            ExpressionAttributeValues: {
              ':exp':  experiment,
              ':grp':  group,
              ':h1a':  hasQ1Audio,
              ':h1t':  hasQ1Trans,
              ':h2a':  hasQ2Audio,
              ':h2t':  hasQ2Trans,
              ':elig': hasCompleteData,
              ':ts':   new Date().toISOString(),
            },
          })),
          db.send(new PutCommand({
            TableName: TABLES.SONA_ITEMS,
            Item: { sona_id, answer_num: 'q1', transcript: q1Trans, audio_s3_key: hasQ1Audio ? `${base}answer1.wav` : null },
          })),
          db.send(new PutCommand({
            TableName: TABLES.SONA_ITEMS,
            Item: { sona_id, answer_num: 'q2', transcript: q2Trans, audio_s3_key: hasQ2Audio ? `${base}answer2.wav` : null },
          })),
        ]);

        return { sona_id, experiment, group, hasCompleteData, eligible, status: 'ok' };
      } catch (err) {
        return { sona_id, status: 'error', error: err.message };
      }
    }));

    const imported = results.filter(r => r.status === 'ok').length;
    const errors   = results.filter(r => r.status === 'error').length;
    res.json({ ok: true, scanned: results.length, imported, errors, results });
  } catch (err) {
    console.error('sona-items/scan', err);
    res.status(500).json({ error: 'Scan failed: ' + err.message });
  }
});

// ── GET /api/admin/sona-items ─────────────────────────────────────────────────
router.get('/', requireAuth, async (req, res) => {
  try {
    const [sonaResult, annotResult, annotatorsResult, configResult] = await Promise.all([
      db.send(new ScanCommand({
        TableName: TABLES.SONA_ITEMS,
        FilterExpression: 'answer_num = :m',
        ExpressionAttributeValues: { ':m': 'meta' },
      })),
      db.send(new ScanCommand({
        TableName: TABLES.ANNOTATIONS,
        ProjectionExpression: 'prolific_id, sona_id, question, #s',
        ExpressionAttributeNames: { '#s': 'step' },
      })),
      db.send(new ScanCommand({
        TableName: TABLES.ANNOTATORS,
        ProjectionExpression: 'assigned_sona_ids',
      })),
      db.send(new GetCommand({ TableName: TABLES.CONFIG, Key: { pk: 'global' } })),
    ]);
    const target = configResult.Item?.target_annotations_per_item || 1;

    // Admin-curated allowlist (Config tab → "Allowed SONA IDs"). When set, it
    // narrows the draw pool to this subset (intersected with LLM eligibility in
    // server/lib/llmEligibility.js). Surface it here so the SONA Items page can
    // filter by it too. Empty / absent list = fail-open (every item allowed).
    const allowedRaw = configResult.Item?.allowed_sona_ids;
    const allowlist  = Array.isArray(allowedRaw) && allowedRaw.length > 0
      ? new Set(allowedRaw.map(String))
      : null;

    // Count completions per sona_id at two levels:
    //   - fully done (both q1+q2 are step='done' by same annotator)
    //   - in progress (any annotation exists, but not fully done)
    const byId = {};
    for (const ann of (annotResult.Items || [])) {
      if (!byId[ann.sona_id]) byId[ann.sona_id] = {};
      if (!byId[ann.sona_id][ann.prolific_id]) byId[ann.sona_id][ann.prolific_id] = { q1: null, q2: null };
      byId[ann.sona_id][ann.prolific_id][ann.question] = ann.step;
    }
    const doneCount = {}, progressCount = {};
    for (const [sid, pids] of Object.entries(byId)) {
      doneCount[sid] = 0;
      progressCount[sid] = 0;
      for (const qs of Object.values(pids)) {
        if (qs.q1 === 'done' && qs.q2 === 'done') doneCount[sid]++;
        else progressCount[sid]++;
      }
    }

    // Count assignments per sona_id across all annotators
    const assignedCount = {};
    for (const a of (annotatorsResult.Items || [])) {
      for (const sid of (a.assigned_sona_ids || [])) {
        assignedCount[sid] = (assignedCount[sid] || 0) + 1;
      }
    }

    const items = (sonaResult.Items || []).map(it => ({
      sona_id:           it.sona_id,
      experiment:        it.experiment        || '—',
      group:             it.group             || '—',
      has_q1_audio:      it.has_q1_audio      || false,
      has_q1_transcript: it.has_q1_transcript || false,
      has_q2_audio:      it.has_q2_audio      || false,
      has_q2_transcript: it.has_q2_transcript || false,
      eligible:          it.eligible          ?? false,
      // Whether this item is in the admin allowlist. Fail-open (no list) → true.
      allowed:           allowlist ? allowlist.has(it.sona_id) : true,
      last_scanned:      it.last_scanned      || null,
      annotation_count:  doneCount[it.sona_id]     || 0,
      in_progress:       progressCount[it.sona_id] || 0,
      // Authoritative pool counter on the meta row (incremented atomically on
      // draw). Uses the project's configured POOL_COUNTER_COLUMN so paa and
      // sister projects each see their own counter here.
      pool_count:        it[POOL_COUNTER_COLUMN] || 0,
      // Computed from current annotator records (may differ from pool_count if
      // an annotator's record was deleted without releasing items)
      assigned_count:    assignedCount[it.sona_id] || 0,
    })).sort((a, b) => a.sona_id.localeCompare(b.sona_id));

    // Pool summary: how many eligible items are still under the target draw count
    const eligibleItems = items.filter(i => i.eligible);
    const poolRemaining = eligibleItems.filter(i => i.pool_count < target).length;
    const poolFilled    = eligibleItems.filter(i => i.pool_count >= target).length;

    res.json({
      items,
      total: items.length,
      target_annotations_per_item: target,
      pool_remaining: poolRemaining,
      pool_filled: poolFilled,
      pool_total: eligibleItems.length,
      // Allowlist state for the SONA Items page filter.
      allowlist_active: !!allowlist,
      allowed_count: allowlist ? items.filter(i => i.allowed).length : items.length,
    });
  } catch (err) {
    console.error('sona-items/list', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// ── POST /api/admin/sona-items/backfill-pool ─────────────────────────────────
// Reconcile the atomic pool counter (assigned_count on each meta row) with
// the ground truth derived from annotators' assigned_sona_ids[]. Fixes
// historical divergences from before the shrinking-pool system or after a
// scan that wiped the counter.
router.post('/backfill-pool', requireAuth, async (req, res) => {
  try {
    const [sonaResult, annotatorsResult] = await Promise.all([
      db.send(new ScanCommand({
        TableName: TABLES.SONA_ITEMS,
        FilterExpression: 'answer_num = :m',
        ExpressionAttributeNames: COL_NAMES,
        ExpressionAttributeValues: { ':m': 'meta' },
        ProjectionExpression: 'sona_id, #col',
      })),
      db.send(new ScanCommand({
        TableName: TABLES.ANNOTATORS,
        ProjectionExpression: 'assigned_sona_ids',
      })),
    ]);
    const truth = {};
    for (const a of (annotatorsResult.Items || [])) {
      for (const sid of (a.assigned_sona_ids || [])) {
        truth[sid] = (truth[sid] || 0) + 1;
      }
    }
    let updated = 0;
    for (const it of (sonaResult.Items || [])) {
      const want = truth[it.sona_id] || 0;
      const have = it[POOL_COUNTER_COLUMN] || 0;
      if (want !== have) {
        await db.send(new UpdateCommand({
          TableName: TABLES.SONA_ITEMS,
          Key: { sona_id: it.sona_id, answer_num: 'meta' },
          UpdateExpression: 'SET #col = :v',
          ExpressionAttributeNames: COL_NAMES,
          ExpressionAttributeValues: { ':v': want },
        }));
        updated++;
      }
    }
    res.json({ ok: true, updated, total: (sonaResult.Items || []).length });
  } catch (err) {
    console.error('sona-items/backfill-pool', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// ── PATCH /api/admin/sona-items/:sona_id/eligible ────────────────────────────
router.patch('/:sona_id/eligible', requireAuth, async (req, res) => {
  const { sona_id } = req.params;
  const { eligible } = req.body;
  if (typeof eligible !== 'boolean') return res.status(400).json({ error: 'eligible must be boolean' });

  try {
    await db.send(new UpdateCommand({
      TableName: TABLES.SONA_ITEMS,
      Key: { sona_id, answer_num: 'meta' },
      UpdateExpression: 'SET eligible = :e',
      ExpressionAttributeValues: { ':e': eligible },
    }));
    res.json({ ok: true, sona_id, eligible });
  } catch (err) {
    console.error('sona-items/eligible', err);
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;
