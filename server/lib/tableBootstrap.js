// ── Table bootstrap ──────────────────────────────────────────────────────────
// Auto-provision every DynamoDB table this Express env points at. Idempotent:
// each call DescribeTables first, only CreateTable + waitUntilTableExists when
// the table doesn't exist. Safe to run on every server boot.
//
// Used by:
//   - server/index.js startup
//   - server/scripts/import-llm-grades.js (one-off CSV ingest)
//
// Why this lives in server/lib (not server/db/dynamo.js): the DynamoDB
// DocumentClient in dynamo.js is for runtime CRUD — schema-management
// commands (DescribeTable/CreateTable) are different SDK module entry points
// and have no business being in every request's hot path. Keeping them in a
// lazy-required helper means dynamo.js stays focused.

const {
  DynamoDBClient,
  DescribeTableCommand,
  CreateTableCommand,
  waitUntilTableExists,
} = require('@aws-sdk/client-dynamodb');

const { TABLES } = require('../db/dynamo');

// Mirror server/db/dynamo.js's client config so the same AWS_REGION /
// AWS_ACCESS_KEY_ID env vars (or default profile chain) are used.
function buildClient() {
  const cfg = { region: process.env.AWS_REGION || 'us-east-1' };
  if (process.env.AWS_ACCESS_KEY_ID) {
    cfg.credentials = {
      accessKeyId:     process.env.AWS_ACCESS_KEY_ID,
      secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
    };
  }
  return new DynamoDBClient(cfg);
}

/**
 * ensureTable(tableName, schema)
 *   schema: { pk: 'name', pkType: 'S' | 'N', sk?: 'name', skType?: 'S' | 'N' }
 * Idempotent. If the table exists, returns immediately. If it doesn't, calls
 * CreateTable + waits up to 120 s for it to become ACTIVE.
 */
async function ensureTable(tableName, schema, client = null) {
  const c = client || buildClient();

  try {
    await c.send(new DescribeTableCommand({ TableName: tableName }));
    return { table: tableName, action: 'exists' };
  } catch (err) {
    if (err.name !== 'ResourceNotFoundException') throw err;
  }

  const AttributeDefinitions = [
    { AttributeName: schema.pk, AttributeType: schema.pkType || 'S' },
  ];
  const KeySchema = [
    { AttributeName: schema.pk, KeyType: 'HASH' },
  ];
  if (schema.sk) {
    AttributeDefinitions.push({ AttributeName: schema.sk, AttributeType: schema.skType || 'S' });
    KeySchema.push({ AttributeName: schema.sk, KeyType: 'RANGE' });
  }

  await c.send(new CreateTableCommand({
    TableName: tableName,
    AttributeDefinitions,
    KeySchema,
    BillingMode: 'PAY_PER_REQUEST',
  }));
  await waitUntilTableExists({ client: c, maxWaitTime: 120 }, { TableName: tableName });
  return { table: tableName, action: 'created' };
}

// Canonical schemas for every table the app ever uses. server/index.js calls
// bootstrapAllTables on startup; the same env vars that drive table NAMES
// drive what gets auto-created (e.g. CALIBER-full has TABLE_ANNOTATORS=
// caliber-annotators, so 'caliber-annotators' gets created here).
const TABLE_SCHEMAS = [
  { name: TABLES.ADMINS,      schema: { pk: 'username'    } },
  { name: TABLES.CONFIG,      schema: { pk: 'pk'          } },
  { name: TABLES.SONA_ITEMS,  schema: { pk: 'sona_id',     sk: 'answer_num'     } },
  { name: TABLES.ANNOTATORS,  schema: { pk: 'prolific_id' } },
  { name: TABLES.ANNOTATIONS, schema: { pk: 'prolific_id', sk: 'sort_key'       } },
  { name: TABLES.TELEMETRY,   schema: { pk: 'event_id'    } },
  { name: TABLES.LLM_GRADES,  schema: { pk: 'sona_id',     sk: 'model_question' } },
];

async function bootstrapAllTables() {
  const client = buildClient();
  const created = [];
  for (const { name, schema } of TABLE_SCHEMAS) {
    try {
      const r = await ensureTable(name, schema, client);
      if (r.action === 'created') created.push(name);
    } catch (err) {
      console.warn(`[tableBootstrap] failed to ensure ${name}:`, err.message);
    }
  }
  if (created.length) {
    console.log(`[tableBootstrap] created tables: ${created.join(', ')}`);
  }
  return created;
}

module.exports = { ensureTable, bootstrapAllTables, TABLE_SCHEMAS };
