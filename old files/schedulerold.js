const cron = require('node-cron');
const nodemailer = require('nodemailer');
const pool = require('./db');

// ─── Email transporter setup ──────────────────────────────────────────────────
// Configure via environment variables:
//   EMAIL_HOST, EMAIL_PORT, EMAIL_USER, EMAIL_PASS, EMAIL_FROM
const transporter = nodemailer.createTransport({
  host: process.env.EMAIL_HOST || 'smtp.gmail.com',
  port: parseInt(process.env.EMAIL_PORT) || 587,
  secure: false,
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS,
  },
});

// ─── Send a reminder email ────────────────────────────────────────────────────
async function sendReminderEmail(userEmail, userName, reminder) {
  const due = new Date(reminder.due_at).toLocaleString('en-CA', {
    dateStyle: 'full',
    timeStyle: 'short',
    timeZone: 'America/Vancouver',
  });

  const priorityEmoji = {
    low: '🟢',
    medium: '🟡',
    high: '🟠',
    urgent: '🔴',
  }[reminder.priority] || '⏰';

  const html = `
    <div style="font-family: sans-serif; max-width: 520px; margin: auto; padding: 24px; border: 1px solid #e5e7eb; border-radius: 12px;">
      <h2 style="color: #1f2937; margin-bottom: 4px;">⏰ Reminder: ${reminder.title}</h2>
      <p style="color: #6b7280; font-size: 14px; margin-top: 0;">Due: <strong>${due}</strong></p>
      ${reminder.description ? `<p style="color: #374151;">${reminder.description}</p>` : ''}
      <div style="display: flex; gap: 8px; margin-top: 16px;">
        <span style="background: #f3f4f6; padding: 4px 10px; border-radius: 999px; font-size: 13px;">
          ${priorityEmoji} ${reminder.priority.charAt(0).toUpperCase() + reminder.priority.slice(1)} priority
        </span>
        ${reminder.category_name ? `<span style="background: ${reminder.category_color || '#e5e7eb'}22; color: ${reminder.category_color || '#6b7280'}; padding: 4px 10px; border-radius: 999px; font-size: 13px; border: 1px solid ${reminder.category_color || '#e5e7eb'};">📁 ${reminder.category_name}</span>` : ''}
      </div>
      <hr style="border: none; border-top: 1px solid #e5e7eb; margin: 20px 0;">
      <p style="color: #9ca3af; font-size: 12px; margin: 0;">Sent by your Reminder App. To stop email notifications, update your reminder settings.</p>
    </div>
  `;

  await transporter.sendMail({
    from: process.env.EMAIL_FROM || `"Reminder App" <${process.env.EMAIL_USER}>`,
    to: userEmail,
    subject: `${priorityEmoji} Reminder: ${reminder.title}`,
    html,
  });
}

// ─── Check and dispatch due notifications ─────────────────────────────────────
async function checkAndSendNotifications() {
  try {
    // Find reminders where:
    // - notify_email is true
    // - not completed
    // - due_at is within the next `notify_minutes_before` minutes (checked on a 1-min window)
    const result = await pool.query(`
      SELECT
        r.*,
        c.name AS category_name,
        c.color AS category_color,
        u.email AS user_email,
        u.name AS user_name
      FROM reminders r
      JOIN users u ON r.user_id = u.id
      LEFT JOIN categories c ON r.category_id = c.id
      WHERE r.notify_email = true
        AND r.completed = false
        AND r.notified = false
        AND r.due_at IS NOT NULL
        AND r.due_at <= NOW() + (r.notify_minutes_before * INTERVAL '1 minute')
        AND r.due_at > NOW() - INTERVAL '5 minutes'
    `);

    for (const reminder of result.rows) {
      try {
        await sendReminderEmail(reminder.user_email, reminder.user_name, reminder);

        // Mark as notified so we don't send again
        await pool.query(
          'UPDATE reminders SET notified = true WHERE id = $1',
          [reminder.id]
        );

        console.log(`📧 Notification sent for reminder "${reminder.title}" to ${reminder.user_email}`);
      } catch (emailErr) {
        console.error(`Failed to send email for reminder ${reminder.id}:`, emailErr.message);
      }
    }
  } catch (err) {
    console.error('Notification check error:', err.message);
  }
}

// ─── Start the scheduler ──────────────────────────────────────────────────────
// Runs every minute
function startScheduler() {
  console.log('🕐 Notification scheduler started');

  cron.schedule('* * * * *', () => {
    checkAndSendNotifications();
  });
}

module.exports = { startScheduler };
