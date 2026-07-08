const { Router } = require('express');
const { db, TABLES, GetCommand, PutCommand, UpdateCommand } = require('../db/dynamo');

function touchLastSeen(prolific_id) {
  db.send(new UpdateCommand({
    TableName: TABLES.ANNOTATORS,
    Key: { prolific_id },
    UpdateExpression: 'SET last_seen = :now',
    ExpressionAttributeValues: { ':now': new Date().toISOString() },
  })).catch(() => {});
}

const router = Router();

// POST /api/annotations  — save annotation + grades for one question
router.post('/', async (req, res) => {
  const { prolific_id, sona_id, question, grades, annotation_html, step } = req.body;

  if (!prolific_id || !sona_id || !question) {
    return res.status(400).json({ error: 'Missing required fields' });
  }

  const sort_key = `${sona_id}#${question}`;

  touchLastSeen(prolific_id);

  try {
    await db.send(new PutCommand({
      TableName: TABLES.ANNOTATIONS,
      Item: {
        prolific_id,
        sort_key,
        sona_id,
        question,
        grades:          grades || {},
        annotation_html: annotation_html || '',
        step:            step || 1,
        updated_at:      new Date().toISOString(),
      },
    }));

    // Stamp task-milestone flags on the annotator (fire-and-forget, no await)
    // step=2 means annotation (step 1) just finished; step=3 → scoring done; etc.
    const flagMap = { 2: 'task_annotation_done', 3: 'task_scoring_done', 4: 'task_bars_done' };
    if (flagMap[step]) {
      db.send(new UpdateCommand({
        TableName: TABLES.ANNOTATORS,
        Key: { prolific_id },
        UpdateExpression: 'SET #f = if_not_exists(#f, :t)',
        ExpressionAttributeNames: { '#f': flagMap[step] },
        ExpressionAttributeValues: { ':t': true },
      })).catch(() => {});
    }

    // When a question is marked done, check if both questions for this SONA ID are done
    // and if so, add sona_id to completed_sona_ids (set deduplicates automatically)
    if (step === 'done') {
      const otherQ = question === 'q1' ? 'q2' : 'q1';
      const other = await db.send(new GetCommand({
        TableName: TABLES.ANNOTATIONS,
        Key: { prolific_id, sort_key: `${sona_id}#${otherQ}` },
      }));

      if (other.Item?.step === 'done') {
        // Use a conditional to only append if not already present — catch silently on duplicate
        db.send(new UpdateCommand({
          TableName: TABLES.ANNOTATORS,
          Key: { prolific_id },
          UpdateExpression: 'SET completed_sona_ids = list_append(if_not_exists(completed_sona_ids, :empty), :id)',
          ConditionExpression: 'not contains(completed_sona_ids, :sid)',
          ExpressionAttributeValues: { ':id': [sona_id], ':empty': [], ':sid': sona_id },
        })).catch(() => {});
        // Also do an unconditional save of the step so it's guaranteed in the annotation record
        await db.send(new UpdateCommand({
          TableName: TABLES.ANNOTATIONS,
          Key: { prolific_id, sort_key: `${sona_id}#${question}` },
          UpdateExpression: 'SET #s = :done',
          ExpressionAttributeNames: { '#s': 'step' },
          ExpressionAttributeValues: { ':done': 'done' },
        })).catch(() => {});
        // Stamp checklist milestone on first fully-completed annotation
        db.send(new UpdateCommand({
          TableName: TABLES.ANNOTATORS,
          Key: { prolific_id },
          UpdateExpression: 'SET task_checklist_done = :t',
          ConditionExpression: 'attribute_not_exists(task_checklist_done)',
          ExpressionAttributeValues: { ':t': true },
        })).catch(() => {});
      }
    }

    res.json({ ok: true });
  } catch (err) {
    console.error('annotations/post', err);
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;
