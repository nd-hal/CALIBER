#!/usr/bin/env node
// ── Import LLM-graded STAR data into paa-llm-grades ──────────────────────────
// Reads a CSV (default: Output.csv at the repo root) where each row has
// per-sona LLM grades for both questions (a1_* = Q1, a2_* = Q2), and writes
// two DynamoDB rows per sona — one for Q1 and one for Q2, keyed by
// (sona_id, "{model}#{question}").
//
// Usage:
//   node server/scripts/import-llm-grades.js Output.csv
//   node server/scripts/import-llm-grades.js Output.csv --model=opus4.8max
//   node server/scripts/import-llm-grades.js Output.csv --dry-run
//
// Or via the npm script (note the `--` to forward args):
//   npm run import-llm-grades -- Output.csv
//   npm run import-llm-grades -- Output.csv --model=gpt4_zeroshot

const fs   = require('fs');
const path = require('path');
const { parse } = require('csv-parse/sync');

// ── Argument parsing ─────────────────────────────────────────────────────────
const args     = process.argv.slice(2);
const flags    = {};
const positional = [];
for (const a of args) {
  if (a.startsWith('--')) {
    const [k, v] = a.slice(2).split('=');
    flags[k] = v === undefined ? true : v;
  } else {
    positional.push(a);
  }
}

const csvPath    = positional[0] || 'Output.csv';
const model      = flags.model || 'opus4.8max';
const dryRun     = !!flags['dry-run'];
const skipCreate = !!flags['skip-create'];

const csvAbs = path.resolve(process.cwd(), csvPath);
if (!fs.existsSync(csvAbs)) {
  console.error(`CSV not found: ${csvAbs}`);
  process.exit(1);
}
if (!/^[\w.\-]+$/.test(model)) {
  console.error(`Invalid --model "${model}". Use alphanumerics, dot, underscore, hyphen.`);
  process.exit(1);
}

// ── Helpers ──────────────────────────────────────────────────────────────────
function toNumOrNull(v) {
  if (v === undefined || v === null) return null;
  const s = String(v).trim();
  if (!s) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}
function toStrOrNull(v) {
  if (v === undefined || v === null) return null;
  const s = String(v).trim();
  return s === '' ? null : s;
}

function buildRow({ sonaId, q, cohort, transcript, phrases, scores, present }, meta) {
  return {
    sona_id:        sonaId,
    model_question: `${meta.model}#${q}`,
    llm_model:      meta.model,
    question:       q,
    source_file:    meta.sourceFile,
    imported_at:    meta.importedAt,
    treatment:      cohort.treatment,
    exp:            cohort.exp,
    round:          cohort.round,
    transcript,
    s_phrases:      phrases.s,
    t_phrases:      phrases.t,
    a_phrases:      phrases.a,
    r_phrases:      phrases.r,
    s_score:        scores.s,
    t_score:        scores.t,
    a_score:        scores.a,
    r_score:        scores.r,
    bars:           scores.bars,
    s_present:      present.s,
    t_present:      present.t,
    a_present:      present.a,
    r_present:      present.r,
  };
}

function rowToItems(row, meta) {
  const sonaId = toStrOrNull(row.sona_id);
  if (!sonaId) return [];

  const cohort = {
    treatment: toStrOrNull(row.treatment),
    exp:       toStrOrNull(row.exp),
    round:     toNumOrNull(row.round),
  };

  const q1 = buildRow({
    sonaId, q: 'q1', cohort,
    transcript: toStrOrNull(row.a1_transcript),
    phrases: {
      s: toStrOrNull(row.a1_S_phrases),
      t: toStrOrNull(row.a1_T_phrases),
      a: toStrOrNull(row.a1_A_phrases),
      r: toStrOrNull(row.a1_R_phrases),
    },
    scores: {
      s:    toNumOrNull(row.a1_S_score),
      t:    toNumOrNull(row.a1_T_score),
      a:    toNumOrNull(row.a1_A_score),
      r:    toNumOrNull(row.a1_R_score),
      bars: toNumOrNull(row.a1_BARS),
    },
    present: {
      s: toStrOrNull(row.a1_S_present),
      t: toStrOrNull(row.a1_T_present),
      a: toStrOrNull(row.a1_A_present),
      r: toStrOrNull(row.a1_R_present),
    },
  }, meta);

  const q2 = buildRow({
    sonaId, q: 'q2', cohort,
    transcript: toStrOrNull(row.a2_transcript),
    phrases: {
      s: toStrOrNull(row.a2_S_phrases),
      t: toStrOrNull(row.a2_T_phrases),
      a: toStrOrNull(row.a2_A_phrases),
      r: toStrOrNull(row.a2_R_phrases),
    },
    scores: {
      s:    toNumOrNull(row.a2_S_score),
      t:    toNumOrNull(row.a2_T_score),
      a:    toNumOrNull(row.a2_A_score),
      r:    toNumOrNull(row.a2_R_score),
      bars: toNumOrNull(row.a2_BARS),
    },
    present: {
      s: toStrOrNull(row.a2_S_present),
      t: toStrOrNull(row.a2_T_present),
      a: toStrOrNull(row.a2_A_present),
      r: toStrOrNull(row.a2_R_present),
    },
  }, meta);

  return [q1, q2];
}

// ── Table provisioning ───────────────────────────────────────────────────────
// Delegates to the shared helper in server/lib/tableBootstrap.js (used by
// server/index.js on startup too). Idempotent — safe to call on every run.
async function ensureTable(tableName) {
  const { ensureTable: ensure } = require('../lib/tableBootstrap');
  const r = await ensure(tableName, { pk: 'sona_id', sk: 'model_question' });
  console.log(`${tableName} ${r.action === 'created' ? 'created and ACTIVE' : 'already exists — skipping create'}.`);
}

// ── Main ─────────────────────────────────────────────────────────────────────
async function main() {
  const csvText = fs.readFileSync(csvAbs, 'utf8');
  const records = parse(csvText, {
    columns: true,
    skip_empty_lines: true,
    relax_quotes: true,
    trim: false,
  });

  const meta = {
    model,
    sourceFile: path.basename(csvAbs),
    importedAt: new Date().toISOString(),
  };

  console.log(`Parsed ${records.length} rows from ${csvAbs}`);
  console.log(`Model identifier:      ${model}`);
  console.log(`Will write to table:   paa-llm-grades`);
  console.log(`Expected items:        ${records.length * 2}`);
  console.log('');

  if (dryRun) {
    const sample = rowToItems(records[0], meta);
    console.log('── Dry run — first parsed row (no writes) ──');
    console.log(JSON.stringify(sample, null, 2));
    console.log('');
    console.log('Re-run without --dry-run to write to DynamoDB.');
    return;
  }

  // Lazy-require so --dry-run doesn't need AWS creds in the shell
  const { db, TABLES, PutCommand } = require('../db/dynamo');

  // ── Provision the table if it doesn't exist yet ────────────────────────────
  // Uses the low-level DynamoDB client (not the document client) because the
  // table-management commands aren't re-exported from server/db/dynamo.js.
  if (!skipCreate) {
    await ensureTable(TABLES.LLM_GRADES);
  } else {
    console.log('--skip-create set; assuming table already exists.');
  }

  let written = 0;
  let failed  = 0;
  const failures = [];

  for (let i = 0; i < records.length; i++) {
    const items = rowToItems(records[i], meta);
    for (const item of items) {
      try {
        await db.send(new PutCommand({ TableName: TABLES.LLM_GRADES, Item: item }));
        written++;
      } catch (err) {
        failed++;
        failures.push({ sona_id: item.sona_id, mq: item.model_question, error: err.message });
      }
    }
    if ((i + 1) % 50 === 0) {
      console.log(`imported ${i + 1}/${records.length} rows (${written} items, ${failed} failed)`);
    }
  }

  console.log('');
  console.log(`Done. ${written} items written, ${failed} failed, model=${model}`);
  if (failures.length) {
    console.log('── Failures (first 10) ──');
    failures.slice(0, 10).forEach(f => console.log(`  ${f.sona_id} ${f.mq}: ${f.error}`));
  }
}

main().catch(err => {
  console.error('Fatal:', err);
  process.exit(1);
});
