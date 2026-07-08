const jwt = require('jsonwebtoken');
const { db, TABLES, UpdateCommand } = require('../db/dynamo');

function requireAuth(req, res, next) {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) return res.status(401).json({ error: 'No token' });

  const token = header.slice(7);
  try {
    req.admin = jwt.verify(token, process.env.JWT_SECRET);
    // Fire-and-forget — stamp last_seen without blocking the request
    db.send(new UpdateCommand({
      TableName: TABLES.ADMINS,
      Key: { username: req.admin.username },
      UpdateExpression: 'SET last_seen = :now',
      ExpressionAttributeValues: { ':now': new Date().toISOString() },
    })).catch(() => {});
    next();
  } catch {
    res.status(401).json({ error: 'Invalid or expired token' });
  }
}

function requireSuperAdmin(req, res, next) {
  requireAuth(req, res, () => {
    if (req.admin.role !== 'super_admin') {
      return res.status(403).json({ error: 'Super admin required' });
    }
    next();
  });
}

module.exports = { requireAuth, requireSuperAdmin };
