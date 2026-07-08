// ── Shrinking-pool draw (breadth-first) ──────────────────────────────────────
// Atomically reserves N SONA items from the pool. Items with the LOWEST
// current pool-counter value are filled before items at any higher count —
// true breadth-first across the pool.
//
// The pool counter column is configurable via POOL_COUNTER_COLUMN env var
// (default `assigned_count`). Sister projects that share `paa-sona-items`
// content but need an isolated pool override this so their draws/sweeps/
// resets only touch their own column.
//
// `excludeIds` are skipped (e.g. items already assigned to the same returning
// annotator). Returns { ok: true, claimed: [sona_id...] } or
// { ok: false, pool_remaining, required } when the pool can't satisfy N.
//
// Used by:
//   - /api/session/start  (first-time + returning draws)
//   - /api/admin/reassign (bulk top-up)
//
// Concurrency note: each Update runs with a ConditionExpression
// (`<counter> < :target AND eligible = :true`) so over-target draws are
// physically impossible. Two annotators racing on the same count-0 item: one
// wins, the other moves on to the next candidate in its (independently
// shuffled) ordered list.

const {
  db, TABLES, POOL_COUNTER_COLUMN,
  UpdateCommand, ScanCommand,
} = require('../db/dynamo');
const { getEligibleSet } = require('./llmEligibility');

// All DynamoDB expressions reference the column via a single `#col` alias so
// the literal column name only appears in one place. ExpressionAttributeNames
// expects a key->name map; we reuse the same object across all expressions.
const COL_NAMES = { '#col': POOL_COUNTER_COLUMN };

async function drawFromPool(N, target, excludeIds = []) {
  if (N <= 0) return { ok: true, claimed: [] };
  const excludeSet = new Set(excludeIds);

  const allMeta = await db.send(new ScanCommand({
    TableName: TABLES.SONA_ITEMS,
    FilterExpression: 'answer_num = :meta AND eligible = :true',
    ExpressionAttributeNames: COL_NAMES,
    ExpressionAttributeValues: { ':meta': 'meta', ':true': true },
    // sona_id is a reserved-word-clean attribute name, but #col is reserved
    // (assigned_count is not, but the alias future-proofs any rename).
    ProjectionExpression: 'sona_id, #col',
  }));

  // CALIBER-only restriction: only sonas that have LLM grades for the chosen
  // model can be drawn (the grading UI relies on hydrated highlights).
  // llmEligibility caches the set; null = not yet loaded → don't filter.
  const llmEligible = getEligibleSet();

  const pool = (allMeta.Items || [])
    .map(i => ({ sona_id: i.sona_id, count: i[POOL_COUNTER_COLUMN] || 0 }))
    .filter(i => i.count < target && !excludeSet.has(i.sona_id))
    .filter(i => llmEligible === null || llmEligible.has(i.sona_id));

  if (pool.length < N) {
    return { ok: false, pool_remaining: pool.length, required: N };
  }

  // ── Stratified shuffle (breadth-first ordering) ────────────────────────────
  // Group by count, Fisher–Yates shuffle within each tier, then concatenate
  // tiers in ascending-count order.
  const tiers = new Map();
  for (const it of pool) {
    const arr = tiers.get(it.count) || [];
    arr.push(it);
    tiers.set(it.count, arr);
  }
  const sortedCounts = [...tiers.keys()].sort((a, b) => a - b);
  const ordered = [];
  for (const c of sortedCounts) {
    const tier = tiers.get(c);
    for (let i = tier.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [tier[i], tier[j]] = [tier[j], tier[i]];
    }
    ordered.push(...tier);
  }

  const claimed = [];
  for (const cand of ordered) {
    if (claimed.length >= N) break;
    try {
      await db.send(new UpdateCommand({
        TableName: TABLES.SONA_ITEMS,
        Key: { sona_id: cand.sona_id, answer_num: 'meta' },
        UpdateExpression: 'SET #col = if_not_exists(#col, :zero) + :one',
        ConditionExpression: '(attribute_not_exists(#col) OR #col < :target) AND eligible = :true',
        ExpressionAttributeNames: COL_NAMES,
        ExpressionAttributeValues: { ':zero': 0, ':one': 1, ':target': target, ':true': true },
      }));
      claimed.push(cand.sona_id);
    } catch (_) { /* lost the race or hit cap — try the next candidate */ }
  }

  if (claimed.length < N) {
    // Couldn't satisfy the full request — release what we did claim so the
    // pool returns to its prior state, and signal STUDY_FULL to the caller.
    await Promise.all(claimed.map(sid =>
      db.send(new UpdateCommand({
        TableName: TABLES.SONA_ITEMS,
        Key: { sona_id: sid, answer_num: 'meta' },
        UpdateExpression: 'SET #col = #col - :one',
        ConditionExpression: '#col > :zero',
        ExpressionAttributeNames: COL_NAMES,
        ExpressionAttributeValues: { ':one': 1, ':zero': 0 },
      })).catch(() => {})
    ));
    return { ok: false, pool_remaining: claimed.length, required: N };
  }

  return { ok: true, claimed };
}

// ── Sweep stale assignments ───────────────────────────────────────────────────
// Releases items from annotators whose tabs have been closed / idle long enough
// that `last_seen` is older than `timeoutMs`. Items go back to the pool by
// decrementing the configured pool counter, and the annotator's record is
// updated so that the next /session/start call issues them a fresh draw.
//
// Returns: { scanned, swept, items_released }
async function sweepStaleAssignments(timeoutMs = 60 * 60 * 1000) {
  const cutoff = new Date(Date.now() - timeoutMs).toISOString();
  const nowIso = new Date().toISOString();

  // Paginated scan of annotators whose last_seen is older than cutoff
  let candidates = [];
  let lastKey;
  do {
    const r = await db.send(new ScanCommand({
      TableName: TABLES.ANNOTATORS,
      FilterExpression: 'attribute_exists(last_seen) AND last_seen < :cutoff',
      ExpressionAttributeValues: { ':cutoff': cutoff },
      ExclusiveStartKey: lastKey,
    }));
    candidates = candidates.concat(r.Items || []);
    lastKey = r.LastEvaluatedKey;
  } while (lastKey);

  let totalReleased = 0;
  let totalSwept    = 0;

  for (const a of candidates) {
    const assigned     = a.assigned_sona_ids || [];
    const completed    = new Set(a.completed_sona_ids || []);
    const toRelease    = assigned.filter(sid => !completed.has(sid));
    if (toRelease.length === 0) continue;

    // Decrement pool counters on the released items (this project's column only)
    await Promise.all(toRelease.map(sid =>
      db.send(new UpdateCommand({
        TableName: TABLES.SONA_ITEMS,
        Key: { sona_id: sid, answer_num: 'meta' },
        UpdateExpression: 'SET #col = #col - :one',
        ConditionExpression: '#col > :zero',
        ExpressionAttributeNames: COL_NAMES,
        ExpressionAttributeValues: { ':one': 1, ':zero': 0 },
      })).catch(() => {})
    ));

    // Build the new annotator state
    const newAssigned  = assigned.filter(sid => !toRelease.includes(sid));
    const releasedSet  = new Set([...(a.released_sona_ids || []), ...toRelease]);
    const newReleased  = [...releasedSet];

    const sessions = Array.isArray(a.sessions) ? a.sessions.slice() : [];
    if (sessions.length) {
      const last = sessions[sessions.length - 1];
      if (!last.submitted_at && !last.released_at) {
        sessions[sessions.length - 1] = { ...last, released_at: nowIso };
      }
    }

    await db.send(new UpdateCommand({
      TableName: TABLES.ANNOTATORS,
      Key: { prolific_id: a.prolific_id },
      UpdateExpression:
        'SET assigned_sona_ids = :ass, released_sona_ids = :rel, ' +
        'current_session_items = :empty, sessions = :sess, last_sweep_at = :now',
      ExpressionAttributeValues: {
        ':ass':   newAssigned,
        ':rel':   newReleased,
        ':empty': [],
        ':sess':  sessions,
        ':now':   nowIso,
      },
    }));

    totalReleased += toRelease.length;
    totalSwept++;
  }

  return { scanned: candidates.length, swept: totalSwept, items_released: totalReleased };
}

module.exports = { drawFromPool, sweepStaleAssignments };
