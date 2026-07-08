// ── CALIBER LLM-eligibility cache ────────────────────────────────────────────
// CALIBER-full's annotators may only see sonas for which the configured LLM
// has produced grades (so the grading UI can hydrate highlights + scores).
// We maintain a module-level Set of eligible sona_ids, populated by scanning
// `paa-llm-grades` for the chosen model on boot and refreshed periodically.
//
// Empty / not-yet-loaded state is represented as `null` (NOT an empty Set) so
// the pool draw can distinguish "no data loaded yet — don't filter" from
// "loaded and confirmed zero items" (the latter signals STUDY_FULL).

const { db, TABLES, GetCommand, ScanCommand } = require('../db/dynamo');

const MODEL = process.env.CALIBER_LLM_MODEL || 'opus4.8max';

let eligibleSet = null;     // Set<string> | null
let llmSize = 0;            // diagnostic: how many sonas had LLM grades pre-allowlist
let allowlistSize = 0;      // diagnostic: how many IDs the admin's allowlist held
let lastRefreshAt = 0;
let inFlight = null;

// Scan paa-llm-grades for the configured model and return a Set of sona_ids
// that have grades. One row per (sona, question) — we project q1 to get one
// row per sona.
async function loadLlmSet() {
  const collected = new Set();
  let lastKey;
  do {
    const r = await db.send(new ScanCommand({
      TableName: TABLES.LLM_GRADES,
      FilterExpression: 'llm_model = :m AND question = :q',
      ExpressionAttributeValues: { ':m': MODEL, ':q': 'q1' },
      ProjectionExpression: 'sona_id',
      ExclusiveStartKey: lastKey,
    }));
    for (const it of (r.Items || [])) collected.add(it.sona_id);
    lastKey = r.LastEvaluatedKey;
  } while (lastKey);
  return collected;
}

// Read the admin-curated allowlist from caliber-config. Returns an array of
// sona_ids (possibly empty) or null when the field is absent. Empty array
// and null both mean "no narrowing filter" (fail-open).
async function loadAllowlist() {
  try {
    const cfg = await db.send(new GetCommand({
      TableName: TABLES.CONFIG,
      Key: { pk: 'global' },
    }));
    const v = cfg.Item?.allowed_sona_ids;
    if (Array.isArray(v) && v.length > 0) return v;
    return null;
  } catch (_) {
    return null;
  }
}

async function loadEligibleSet() {
  const llm = await loadLlmSet();
  const allowlist = await loadAllowlist();
  llmSize = llm.size;
  allowlistSize = allowlist ? allowlist.length : 0;

  if (!allowlist) return llm; // fail-open: no admin filter set

  const allow = new Set(allowlist);
  for (const sid of [...llm]) {
    if (!allow.has(sid)) llm.delete(sid);
  }
  return llm;
}

async function refreshEligibility() {
  if (inFlight) return inFlight;
  inFlight = (async () => {
    try {
      const next = await loadEligibleSet();
      eligibleSet = next;
      lastRefreshAt = Date.now();
      console.log(`[caliber-eligibility] refreshed: ${next.size} sonas eligible (LLM=${MODEL} pool=${llmSize}, allowlist=${allowlistSize})`);
    } catch (err) {
      console.warn(`[caliber-eligibility] refresh failed: ${err.message}`);
    } finally {
      inFlight = null;
    }
  })();
  return inFlight;
}

function getEligibleSet() {
  return eligibleSet;
}

function getModel() {
  return MODEL;
}

function getLastRefreshAt() {
  return lastRefreshAt;
}

// Diagnostics for the admin Config tab — exposes how the eligible Set was
// computed so the UI can show "X / Y" (allowlisted / total LLM-graded).
function getDiagnostics() {
  return {
    model:           MODEL,
    eligible_count:  eligibleSet ? eligibleSet.size : 0,
    llm_pool_size:   llmSize,
    allowlist_size:  allowlistSize,
    last_refresh_at: lastRefreshAt ? new Date(lastRefreshAt).toISOString() : null,
  };
}

module.exports = { refreshEligibility, getEligibleSet, getModel, getLastRefreshAt, getDiagnostics };
