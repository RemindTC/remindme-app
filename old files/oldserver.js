require('dotenv').config();
const express = require('express');
const cors = require('cors');
const pool = require('./db');
const authRoutes = require('./auth');
const reminderRoutes = require('./reminders');
const { startScheduler } = require('./scheduler');
const jwt = require('jsonwebtoken');
const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key-change-in-production';

const app = express();
const path = require('path');
app.use(express.json());
app.use(cors());

// ─── Serve PWA static files ───────────────────────────────────────────────────
app.use(express.static(path.join(__dirname)));
app.get('/sw.js', (req, res) => res.sendFile(path.join(__dirname, 'sw.js')));
app.get('/manifest.json', (req, res) => res.sendFile(path.join(__dirname, 'manifest.json')));

// ─── Auth middleware ──────────────────────────────────────────────────────────
function auth(req, res, next) {
  const token = (req.headers['authorization'] || '').split(' ')[1];
  if (!token) return res.status(401).json({ error: 'Access token required' });
  try { req.user = jwt.verify(token, JWT_SECRET); next(); }
  catch { res.status(403).json({ error: 'Invalid token' }); }
}

// ─── Routes ───────────────────────────────────────────────────────────────────
app.use('/auth', authRoutes);
app.use('/reminders', reminderRoutes);

// ─── User profile ─────────────────────────────────────────────────────────────
app.get('/profile', auth, async (req, res) => {
  try {
    const result = await pool.query('SELECT id, email, name, phone FROM users WHERE id = $1', [req.user.userId]);
    if (!result.rows.length) return res.status(404).json({ error: 'User not found' });
    res.json(result.rows[0]);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.patch('/profile', auth, async (req, res) => {
  const { name, email, phone } = req.body;
  const updates = [];
  const values = [];
  let idx = 1;
  if (name !== undefined) { updates.push(`name = $${idx++}`); values.push(name); }
  if (email !== undefined) { updates.push(`email = $${idx++}`); values.push(email); }
  if (phone !== undefined) { updates.push(`phone = $${idx++}`); values.push(phone); }
  if (!updates.length) return res.status(400).json({ error: 'Nothing to update' });
  values.push(req.user.userId);
  try {
    const result = await pool.query(
      `UPDATE users SET ${updates.join(', ')} WHERE id = $${idx} RETURNING id, email, name, phone`,
      values
    );
    res.json(result.rows[0]);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ─── Test email route ─────────────────────────────────────────────────────────
app.post('/reminders/test-email', auth, async (req, res) => {
  const { title = 'Test Reminder', format = 'email', mood = 'nice', customText = '' } = req.body;
  try {
    const userResult = await pool.query('SELECT * FROM users WHERE id = $1', [req.user.userId]);
    if (!userResult.rows.length) return res.status(404).json({ error: 'User not found' });
    const user = userResult.rows[0];
    const { sendEmail } = require('./notifications');
    const fakeReminder = {
      id: 0, title,
      description: customText || `This is a test ${format} reminder.`,
      due_at: new Date(Date.now() + 30 * 60000).toISOString(),
      priority: 'medium', recurrence: 'none',
      notify_email: true, notify_format: format, notify_mood: mood,
    };
    await sendEmail(user.email, fakeReminder, format, mood);
    res.json({ message: 'Test email sent!', to: user.email });
  } catch (err) {
    console.error('Test email error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ─── Test SMS route ───────────────────────────────────────────────────────────
app.post('/reminders/test-sms', auth, async (req, res) => {
  const { title = 'Test Reminder', format = 'email', mood = 'nice', customText = '' } = req.body;
  try {
    const userResult = await pool.query('SELECT * FROM users WHERE id = $1', [req.user.userId]);
    if (!userResult.rows.length) return res.status(404).json({ error: 'User not found' });
    const user = userResult.rows[0];
    if (!user.phone) return res.status(400).json({ error: 'No phone number on your profile. Please update your profile first.' });
    const { sendSMS } = require('./notifications');
    const fakeReminder = {
      id: 0, title,
      description: customText || `This is a test SMS reminder.`,
      due_at: new Date(Date.now() + 30 * 60000).toISOString(),
      priority: 'medium', notify_format: format, notify_mood: mood,
    };
    await sendSMS(user.phone, fakeReminder, format, mood);
    res.json({ message: 'Test SMS sent!', to: user.phone });
  } catch (err) {
    console.error('Test SMS error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ─── Main ─────────────────────────────────────────────────────────────────────
app.get('/', (req, res) => {
  res.json({ message: 'Reminder App API is running!', version: '2.0' });
});

app.get('/test-db', async (req, res) => {
  try {
    const result = await pool.query('SELECT NOW()');
    res.json({ message: 'Database connected!', time: result.rows[0].now });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.use((req, res) => { res.status(404).json({ error: 'Route not found' }); });

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
  startScheduler();
});
