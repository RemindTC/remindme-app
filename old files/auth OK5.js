const express = require('express');
const router = express.Router();
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const pool = require('./db');

const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key-change-in-production';

// Middleware to verify token
function requireAuth(req, res, next) {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'Access token required' });
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    req.userId = decoded.userId;
    next();
  } catch {
    return res.status(403).json({ error: 'Invalid token' });
  }
}

// Register
router.post('/register', function(req, res) {
  const { name, email, password } = req.body;
  if (!email || !password) return res.status(400).json({ error: 'Email and password required' });
  bcrypt.hash(password, 10).then(function(hashedPassword) {
    pool.query(
      'INSERT INTO users (name, email, password) VALUES ($1, $2, $3) RETURNING id, email, name',
      [name || null, email, hashedPassword]
    ).then(function(result) {
      const user = result.rows[0];
      const token = jwt.sign({ userId: user.id, email: user.email }, JWT_SECRET, { expiresIn: '7d' });
      res.json({ token, user });
    }).catch(function(err) {
      res.status(400).json({ error: err.message });
    });
  }).catch(function(err) {
    res.status(500).json({ error: err.message });
  });
});

// Login
router.post('/login', function(req, res) {
  const { email, password } = req.body;
  if (!email || !password) return res.status(400).json({ error: 'Email and password required' });
  pool.query('SELECT * FROM users WHERE email = $1', [email]).then(function(result) {
    if (result.rows.length === 0) return res.status(401).json({ error: 'Invalid email or password' });
    const user = result.rows[0];
    if (user.blocked) return res.status(403).json({ error: 'Your account has been blocked. Please contact support.' });
    bcrypt.compare(password, user.password).then(function(match) {
      if (!match) return res.status(401).json({ error: 'Invalid email or password' });
      const token = jwt.sign({ userId: user.id, email: user.email }, JWT_SECRET, { expiresIn: '7d' });
      res.json({ token, user: { id: user.id, email: user.email, name: user.name } });
    });
  }).catch(function(err) {
    res.status(500).json({ error: err.message });
  });
});

// ── Admin routes ──────────────────────────────────────────────────────────────

// Get all users
router.get('/admin/users', requireAuth, function(req, res) {
  pool.query('SELECT id, email, name, created_at, blocked FROM users ORDER BY created_at DESC')
    .then(function(result) { res.json(result.rows); })
    .catch(function(err) { res.status(500).json({ error: err.message }); });
});

// Block a user
router.post('/admin/users/:id/block', requireAuth, function(req, res) {
  pool.query('UPDATE users SET blocked = true WHERE id = $1', [req.params.id])
    .then(function() { res.json({ message: 'User blocked' }); })
    .catch(function(err) { res.status(500).json({ error: err.message }); });
});

// Unblock a user
router.post('/admin/users/:id/unblock', requireAuth, function(req, res) {
  pool.query('UPDATE users SET blocked = false WHERE id = $1', [req.params.id])
    .then(function() { res.json({ message: 'User unblocked' }); })
    .catch(function(err) { res.status(500).json({ error: err.message }); });
});

// Delete a user
router.delete('/admin/users/:id', requireAuth, function(req, res) {
  pool.query('DELETE FROM users WHERE id = $1', [req.params.id])
    .then(function() { res.json({ message: 'User deleted' }); })
    .catch(function(err) { res.status(500).json({ error: err.message }); });
});

module.exports = router;
