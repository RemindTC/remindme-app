require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const pool = require('./db');
const authRoutes = require('./auth');
const reminderRoutes = require('./reminders');
const { startScheduler } = require('./scheduler');

const app = express();
app.use(express.json());
app.use(cors());

// Serve frontend
app.use(express.static(path.join(__dirname)));

// Routes
app.use('/auth', authRoutes);
app.use('/reminders', reminderRoutes);

app.get('/api', (req, res) => {
  res.json({
    message: 'Reminder App API is running!',
    version: '2.0'
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

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
  startScheduler();
});
