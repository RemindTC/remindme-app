require('dotenv').config();
const express = require('express');
const cors = require('cors');
const pool = require('./db');
const authRoutes = require('./auth');
const reminderRoutes = require('./reminders');
const { startScheduler } = require('./scheduler');

const app = express();
app.use(express.json());
app.use(cors());

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

// ─── Test email route ────────────────────────────────────────────────────────
app.post('/reminders/test-email', async (req, res) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'Access token required' });

  const jwt = require('jsonwebtoken');
  const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key-change-in-production';
  let userId;
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    userId = decoded.userId;
  } catch { return res.status(403).json({ error: 'Invalid token' }); }

  const { title = 'Test Reminder', format = 'email', mood = 'nice', customText = '' } = req.body;

  try {
    const userResult = await pool.query('SELECT * FROM users WHERE id = $1', [userId]);
    if (userResult.rows.length === 0) return res.status(404).json({ error: 'User not found' });
    const user = userResult.rows[0];

    const FUNNY_SCRIPTS = {
      nice: (t) => `Hey superstar! Just a super gentle nudge — your reminder called ${t} is coming up! You are absolutely amazing and you totally got this! Go get them champ!`,
      mean: (t) => `Oh wow. ${t}. Still. Not. Done. I am honestly shocked. Did you forget? Of course you did. Classic. Maybe try actually doing it this time?`,
      angry: (t) => `LISTEN UP! Your reminder ${t} is HERE! RIGHT NOW! How many times do I have to tell you?! GET UP! DO IT! NO MORE EXCUSES! DO IT NOW!!!`,
    };

    const fakeReminder = {
      id: 0,
      title,
      description: format === 'funny' ? (customText || FUNNY_SCRIPTS[mood](title)) : `This is a test ${format} reminder.`,
      due_at: new Date(Date.now() + 30 * 60000).toISOString(),
      priority: 'medium',
      recurrence: 'none',
      notify_email: true,
      notify_minutes_before: 30,
      notified: false,
      category_name: null,
      category_color: null,
    };

    const { startScheduler, ...schedulerModule } = require('./scheduler');
    // Re-require to get sendReminderEmail
    delete require.cache[require.resolve('./scheduler')];
    const sched = require('./scheduler');

    // Call internal send function via pool query trick - just send directly
    const nodemailer = require('nodemailer');
    const transporter = nodemailer.createTransport({
      host: process.env.EMAIL_HOST || 'smtp.gmail.com',
      port: parseInt(process.env.EMAIL_PORT) || 587,
      secure: false,
      auth: { user: process.env.EMAIL_USER, pass: process.env.EMAIL_PASS },
    });

    const priorityEmoji = { low: '🟢', medium: '🟡', high: '🟠', urgent: '🔴' }[fakeReminder.priority] || '⏰';
    const formatLabels = { email: '📧 Email', text: '💬 Text', audio: '🔊 Audio', funny: { nice: '😊 Nice', mean: '😈 Mean', angry: '😡 Angry' }[mood] || '😂 Funny' };
    const formatLabel = format === 'funny' ? formatLabels.funny : formatLabels[format];

    const html = `
      <div style="font-family:sans-serif;max-width:560px;margin:auto;border-radius:16px;overflow:hidden;border:1px solid #e5e7eb;">
        <div style="background:#0c0f0a;padding:24px 28px 16px;">
          <div style="font-size:22px;font-weight:800;color:#b8f566;">RemindMe</div>
          <div style="font-size:11px;color:#7a8a76;letter-spacing:1px;text-transform:uppercase;margin-top:2px;">Test Notification</div>
        </div>
        <div style="padding:24px 28px;background:#fff;">
          <div style="background:#f0fdf4;border:1px solid #bbf7d0;border-radius:8px;padding:10px 14px;margin-bottom:16px;font-size:13px;color:#166534;">
            ✅ Test email sent successfully! Format: <strong>${formatLabel}</strong>
          </div>
          <h2 style="color:#1f2937;margin:0 0 6px;">${priorityEmoji} ${fakeReminder.title}</h2>
          <p style="color:#6b7280;font-size:14px;margin:0 0 16px;">This is a <strong>${formatLabel}</strong> format reminder test.</p>
          <p style="color:#374151;font-size:14px;padding:12px 16px;background:#f9fafb;border-radius:8px;border-left:3px solid #b8f566;">${fakeReminder.description}</p>
        </div>
        <div style="padding:14px 28px;background:#f9fafb;border-top:1px solid #e5e7eb;">
          <p style="color:#9ca3af;font-size:11px;margin:0;">Sent by RemindMe — test email for ${user.email}</p>
        </div>
      </div>`;

    await transporter.sendMail({
      from: process.env.EMAIL_FROM || `"RemindMe" <${process.env.EMAIL_USER}>`,
      to: user.email,
      subject: `${priorityEmoji} Test Reminder: ${title} [${formatLabel}]`,
      html,
    });

    res.json({ message: 'Test email sent!', to: user.email });
  } catch (err) {
    console.error('Test email error:', err.message);
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
