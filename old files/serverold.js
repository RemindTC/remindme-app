const express = require('express');
npm install cors
const pool = require('./db');
const authRoutes = require('./auth');
const reminderRoutes = require('./reminders');
const { startScheduler } = require('./scheduler');

const app = express();
app.use(express.json());

// ─── Routes ───────────────────────────────────────────────────────────────────
app.use('/auth', authRoutes);
app.use('/reminders', reminderRoutes);

app.get('/', (req, res) => {
  res.json({
    message: 'Reminder App API is running!',
    version: '2.0',
    endpoints: {
      auth: {
        'POST /auth/register': 'Create account',
        'POST /auth/login': 'Login and get JWT token',
      },
      reminders: {
        'GET /reminders': 'List reminders (filters: ?category=&priority=&completed=&due_before=&due_after=)',
        'POST /reminders': 'Create a reminder',
        'GET /reminders/:id': 'Get a reminder',
        'PATCH /reminders/:id': 'Update a reminder',
        'DELETE /reminders/:id': 'Delete a reminder',
        'GET /reminders/filter/upcoming': 'Upcoming reminders (next 7 days, ?days=N)',
      },
      categories: {
        'GET /reminders/categories/all': 'List categories',
        'POST /reminders/categories': 'Create category',
        'DELETE /reminders/categories/:id': 'Delete category',
      },
    },
  });
});

app.get('/test-db', async (req, res) => {
  try {
    const result = await pool.query('SELECT NOW()');
    res.json({ message: 'Database connected!', time: result.rows[0].now });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 404 fallback
app.use((req, res) => {
  res.status(404).json({ error: 'Route not found' });
});

// ─── Start ────────────────────────────────────────────────────────────────────
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
  startScheduler();
});
