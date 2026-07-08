const { Router } = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { db, TABLES, GetCommand, PutCommand, UpdateCommand, ScanCommand } = require('../db/dynamo');
const { requireAuth, requireSuperAdmin } = require('../middleware/auth');

const router = Router();

// Admin login → JWT
router.post('/login', async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) return res.status(400).json({ error: 'Missing credentials' });

  try {
    const result = await db.send(new GetCommand({
      TableName: TABLES.ADMINS,
      Key: { username },
    }));

    const admin = result.Item;
    if (!admin) return res.status(401).json({ error: 'Invalid credentials' });

    const valid = await bcrypt.compare(password, admin.password_hash);
    if (!valid) return res.status(401).json({ error: 'Invalid credentials' });

    const token = jwt.sign(
      { username, role: admin.role },
      process.env.JWT_SECRET,
      { expiresIn: '8h' }
    );

    // Stamp last_seen at login so Active tab reflects it immediately
    await db.send(new UpdateCommand({
      TableName: TABLES.ADMINS,
      Key: { username },
      UpdateExpression: 'SET last_seen = :now',
      ExpressionAttributeValues: { ':now': new Date().toISOString() },
    }));

    res.json({ token, role: admin.role, username });
  } catch (err) {
    console.error('auth/login', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// Create admin account (super-admin only)
router.post('/create', requireSuperAdmin, async (req, res) => {
  const { username, password, role = 'admin' } = req.body;
  if (!username || !password) return res.status(400).json({ error: 'Missing fields' });
  if (!['admin', 'super_admin'].includes(role)) return res.status(400).json({ error: 'Invalid role' });

  try {
    const existing = await db.send(new GetCommand({ TableName: TABLES.ADMINS, Key: { username } }));
    if (existing.Item) return res.status(409).json({ error: 'Username already exists' });

    const password_hash = await bcrypt.hash(password, 12);
    await db.send(new PutCommand({
      TableName: TABLES.ADMINS,
      Item: {
        username,
        password_hash,
        role,
        created_at: new Date().toISOString(),
        created_by: req.admin.username,
      },
    }));

    res.json({ ok: true, username, role });
  } catch (err) {
    console.error('auth/create', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// List admin accounts (super-admin only)
router.get('/admins', requireSuperAdmin, async (req, res) => {
  try {
    const result = await db.send(new ScanCommand({
      TableName: TABLES.ADMINS,
      ProjectionExpression: 'username, #r, created_at, created_by, last_seen',
      ExpressionAttributeNames: { '#r': 'role' },
    }));
    res.json({ admins: result.Items || [] });
  } catch (err) {
    console.error('auth/admins', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// Delete an admin account (super-admin only, cannot delete self)
router.delete('/admins/:username', requireSuperAdmin, async (req, res) => {
  const { username } = req.params;
  if (username === req.admin.username) return res.status(400).json({ error: 'Cannot delete your own account' });
  try {
    const { DeleteCommand } = require('../db/dynamo');
    await db.send(new DeleteCommand({
      TableName: TABLES.ADMINS,
      Key: { username },
    }));
    res.json({ ok: true });
  } catch (err) {
    console.error('auth/admins/delete', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// Verify token (for client-side auth checks)
router.get('/me', requireAuth, (req, res) => {
  res.json({ username: req.admin.username, role: req.admin.role });
});

module.exports = router;
