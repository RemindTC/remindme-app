const cron = require('node-cron');
const nodemailer = require('nodemailer');
const pool = require('./db');
const https = require('https');
const fs = require('fs');
const path = require('path');
const os = require('os');

// ─── Email transporter setup ──────────────────────────────────────────────────
const transporter = nodemailer.createTransport({
  host: process.env.EMAIL_HOST || 'smtp.gmail.com',
  port: parseInt(process.env.EMAIL_PORT) || 587,
  secure: false,
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS,
  },
});

// ─── Generate TTS audio using Google Translate TTS (free) ────────────────────
function generateTTS(text, outputPath) {
  return new Promise((resolve, reject) => {
    const encoded = encodeURIComponent(text.slice(0, 200)); // max 200 chars
    const url = `https://translate.google.com/translate_tts?ie=UTF-8&q=${encoded}&tl=en&client=tw-ob`;

    const file = fs.createWriteStream(outputPath);
    https.get(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
      }
    }, (response) => {
      if (response.statusCode !== 200) {
        reject(new Error(`TTS request failed: ${response.statusCode}`));
        return;
      }
      response.pipe(file);
      file.on('finish', () => { file.close(); resolve(outputPath); });
    }).on('error', (err) => {
      fs.unlink(outputPath, () => {});
      reject(err);
    });
  });
}

// ─── Build audio data URI for email inline player ─────────────────────────────
function fileToBase64(filePath) {
  const data = fs.readFileSync(filePath);
  return data.toString('base64');
}

// ─── Send reminder email with audio ──────────────────────────────────────────
async function sendReminderEmail(userEmail, userName, reminder) {
  const due = new Date(reminder.due_at).toLocaleString('en-CA', {
    dateStyle: 'full',
    timeStyle: 'short',
    timeZone: 'America/Vancouver',
  });

  const priorityEmoji = {
    low: '🟢', medium: '🟡', high: '🟠', urgent: '🔴',
  }[reminder.priority] || '⏰';

  // Build TTS text
  const ttsText = `Reminder: ${reminder.title}. ${reminder.description ? reminder.description + '.' : ''} This is a ${reminder.priority} priority reminder due ${due}.`;

  // Generate audio file
  let audioAttachment = null;
  let audioBase64 = null;
  const tmpFile = path.join(os.tmpdir(), `reminder_${reminder.id}_${Date.now()}.mp3`);

  try {
    await generateTTS(ttsText, tmpFile);
    audioBase64 = fileToBase64(tmpFile);
    audioAttachment = {
      filename: `reminder-${reminder.title.replace(/[^a-z0-9]/gi, '_').toLowerCase()}.mp3`,
      content: audioBase64,
      encoding: 'base64',
      contentType: 'audio/mpeg',
    };
    console.log(`🎵 Audio generated for reminder "${reminder.title}"`);
  } catch (audioErr) {
    console.error('Audio generation failed, sending text-only email:', audioErr.message);
  }

  // Build inline audio player HTML
  const audioPlayerHtml = audioBase64 ? `
    <div style="margin: 20px 0; padding: 16px; background: #f8f9fa; border-radius: 10px; border: 1px solid #e9ecef;">
      <p style="margin: 0 0 10px; font-size: 13px; color: #6b7280; font-weight: 500;">🎵 Audio Reminder</p>
      <audio controls style="width: 100%; outline: none;">
        <source src="data:audio/mpeg;base64,${audioBase64}" type="audio/mpeg">
        Your email client does not support audio playback.
      </audio>
      <p style="margin: 8px 0 0; font-size: 11px; color: #9ca3af;">If the player doesn't work, open the attached MP3 file.</p>
    </div>
  ` : '';

  const html = `
    <div style="font-family: sans-serif; max-width: 560px; margin: auto; padding: 0; border-radius: 16px; overflow: hidden; border: 1px solid #e5e7eb;">
      <!-- Header -->
      <div style="background: #0c0f0a; padding: 28px 28px 20px;">
        <div style="font-size: 22px; font-weight: 800; color: #b8f566; letter-spacing: -0.5px;">RemindMe</div>
        <div style="font-size: 12px; color: #7a8a76; margin-top: 2px; letter-spacing: 1px; text-transform: uppercase;">Reminder Notification</div>
      </div>

      <!-- Body -->
      <div style="padding: 24px 28px; background: #ffffff;">
        <h2 style="color: #1f2937; margin: 0 0 6px; font-size: 20px;">${priorityEmoji} ${reminder.title}</h2>
        <p style="color: #6b7280; font-size: 14px; margin: 0 0 16px;">Due: <strong style="color: #374151;">${due}</strong></p>

        ${reminder.description ? `<p style="color: #374151; font-size: 15px; margin: 0 0 16px; padding: 12px 16px; background: #f9fafb; border-radius: 8px; border-left: 3px solid #b8f566;">${reminder.description}</p>` : ''}

        <!-- Audio player -->
        ${audioPlayerHtml}

        <!-- Tags -->
        <div style="display: flex; gap: 8px; flex-wrap: wrap; margin-top: 16px;">
          <span style="background: #f3f4f6; padding: 4px 12px; border-radius: 999px; font-size: 12px; font-weight: 500; color: #374151;">
            ${priorityEmoji} ${reminder.priority.charAt(0).toUpperCase() + reminder.priority.slice(1)} priority
          </span>
          ${reminder.recurrence && reminder.recurrence !== 'none' ? `
          <span style="background: #f3f4f6; padding: 4px 12px; border-radius: 999px; font-size: 12px; color: #6b7280;">
            🔁 Repeats ${reminder.recurrence}
          </span>` : ''}
          ${reminder.category_name ? `
          <span style="background: #f3f4f6; padding: 4px 12px; border-radius: 999px; font-size: 12px; color: #6b7280;">
            📁 ${reminder.category_name}
          </span>` : ''}
        </div>
      </div>

      <!-- Footer -->
      <div style="padding: 16px 28px; background: #f9fafb; border-top: 1px solid #e5e7eb;">
        <p style="color: #9ca3af; font-size: 11px; margin: 0;">Sent by RemindMe. To stop email notifications, update your reminder settings.</p>
      </div>
    </div>
  `;

  const mailOptions = {
    from: process.env.EMAIL_FROM || `"RemindMe" <${process.env.EMAIL_USER}>`,
    to: userEmail,
    subject: `${priorityEmoji} Reminder: ${reminder.title}`,
    html,
    attachments: audioAttachment ? [audioAttachment] : [],
  };

  await transporter.sendMail(mailOptions);

  // Clean up temp file
  if (fs.existsSync(tmpFile)) fs.unlinkSync(tmpFile);
}

// ─── Check and dispatch due notifications ────────────────────────────────────
async function checkAndSendNotifications() {
  try {
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
        await pool.query('UPDATE reminders SET notified = true WHERE id = $1', [reminder.id]);
        console.log(`📧 Notification sent for "${reminder.title}" to ${reminder.user_email}`);
      } catch (emailErr) {
        console.error(`Failed to send email for reminder ${reminder.id}:`, emailErr.message);
      }
    }
  } catch (err) {
    console.error('Notification check error:', err.message);
  }
}

// ─── Start the scheduler ──────────────────────────────────────────────────────
function startScheduler() {
  console.log('🕐 Notification scheduler started');
  cron.schedule('* * * * *', () => { checkAndSendNotifications(); });
}

module.exports = { startScheduler };