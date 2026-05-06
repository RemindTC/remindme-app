const express = require('express');
const router = express.Router();
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const pool = require('./db');

const SECRET_KEY = 'autoreminder_secret_key';

// Sign up
router.post('/signup', function(req, res) {
  const { username, email, password } = req.body;
  bcrypt.hash(password, 10).then(function(hashedPassword) {
    pool.query(
      'INSERT INTO users (username, email, password) VALUES ($1, $2, $3) RETURNING id, username, email',
      [username, email, hashedPassword]
    ).then(function(result) {
      res.json({ message: 'User created successfully!', user: result.rows[0] });
    }).catch(function(err) {
      res.status(400).json({ error: err.message });
    });
  }).catch(function(err) {
    res.status(500).json({ error: err.message });
  });
});

// Login
router.post('/login', function(req, res) {
  const { username, password } = req.body;
  pool.query('SELECT * FROM users WHERE username = $1', [username]).then(function(result) {
    if (result.rows.length === 0) {
      return res.status(401).json({ error: 'Invalid username or password' });
    }
    const user = result.rows[0];
    bcrypt.compare(password, user.password).then(function(match) {
      if (!match) {
        return res.status(401).json({ error: 'Invalid username or password' });
      }
      const token = jwt.sign({ id: user.id, username: user.username }, SECRET_KEY, { expiresIn: '24h' });
      res.json({ message: 'Login successful!', token: token });
    });
  }).catch(function(err) {
    res.status(500).json({ error: err.message });
  });
});

module.exports = router;
