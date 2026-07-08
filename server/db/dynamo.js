const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const {
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  UpdateCommand,
  QueryCommand,
  ScanCommand,
  DeleteCommand,
} = require('@aws-sdk/lib-dynamodb');

const clientConfig = { region: process.env.AWS_REGION || 'us-east-1' };

if (process.env.AWS_ACCESS_KEY_ID) {
  clientConfig.credentials = {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  };
}

const client = new DynamoDBClient(clientConfig);

const db = DynamoDBDocumentClient.from(client, {
  marshallOptions: { removeUndefinedValues: true },
});

const TABLES = {
  ADMINS:      process.env.TABLE_ADMINS      || 'paa-admins',
  CONFIG:      process.env.TABLE_CONFIG      || 'paa-config',
  SONA_ITEMS:  process.env.TABLE_SONA_ITEMS  || 'paa-sona-items',
  ANNOTATORS:  process.env.TABLE_ANNOTATORS  || 'paa-annotators',
  ANNOTATIONS: process.env.TABLE_ANNOTATIONS || 'paa-annotations',
  TELEMETRY:   process.env.TABLE_TELEMETRY   || 'paa-telemetry',
  LLM_GRADES:  process.env.TABLE_LLM_GRADES  || 'paa-llm-grades',
};

// Per-project pool counter column on `paa-sona-items` meta rows. The Prolific
// app uses `assigned_count` (the original); sister projects that share the
// SONA content but need their own pool (e.g. CALIBER-full) override this via
// the POOL_COUNTER_COLUMN env var so their draws / sweeps / resets never
// touch the original project's counters.
const POOL_COUNTER_COLUMN = process.env.POOL_COUNTER_COLUMN || 'assigned_count';

module.exports = {
  db, TABLES, POOL_COUNTER_COLUMN,
  GetCommand, PutCommand, UpdateCommand, QueryCommand, ScanCommand, DeleteCommand,
};
