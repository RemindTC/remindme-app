const pool = require('./db');
const nodemailer = require('nodemailer');
const twilio = require('twilio');

// ─── Email transporter ────────────────────────────────────────────────────────
const transporter = nodemailer.createTransport({
  host: process.env.EMAIL_HOST || 'smtp.gmail.com',
  port: parseInt(process.env.EMAIL_PORT) || 587,
  secure: false,
  auth: { user: process.env.EMAIL_USER, pass: process.env.EMAIL_PASS },
});

// ─── Twilio client ────────────────────────────────────────────────────────────
const twilioClient = process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN
  ? twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN)
  : null;

// ─── Funny scripts ────────────────────────────────────────────────────────────
const FUNNY_SCRIPTS = {
  nice:  (t, d) => `Hey superstar! Just a gentle nudge — ${d || t} is coming up! You totally got this! Go get them champ!`,
  mean:  (t, d) => `Oh wow. ${d || t}. Still. Not. Done. Shocking. Maybe try actually doing it this time?`,
  angry: (t, d) => `LISTEN UP! ${d || t}! RIGHT NOW! No more excuses! DO IT NOW!!!`,
};

// ─── Build message text ───────────────────────────────────────────────────────
function buildMessage(reminder, format, mood) {
  const title = reminder.title;
  const desc = reminder.description || '';
  if (format === 'funny' && FUNNY_SCRIPTS[mood]) {
    return FUNNY_SCRIPTS[mood](title, desc);
  }
  return desc || `Reminder: ${title}`;
}

// ─── Send Email ───────────────────────────────────────────────────────────────
async function sendEmail(userEmail, reminder, format, mood) {
  const priorityEmoji = { low: '🟢', medium: '🟡', high: '🟠', urgent: '🔴' }[reminder.priority] || '⏰';
  const message = buildMessage(reminder, format, mood);
  const due = new Date(reminder.due_at).toLocaleString('en-CA', {
    dateStyle: 'full', timeStyle: 'short', timeZone: 'America/Vancouver',
  });

  const html = `
    <div style="font-family:sans-serif;max-width:560px;margin:auto;border-radius:16px;overflow:hidden;border:1px solid #e5e7eb;">
      <div style="background:#0c0f0a;padding:24px 28px 16px;">
        <div style="font-size:22px;font-weight:800;color:#b8f566;">RemindMe</div>
        <div style="font-size:11px;color:#7a8a76;letter-spacing:1px;text-transform:uppercase;margin-top:2px;">Reminder Notification</div>
      </div>
      <div style="padding:24px 28px;background:#fff;">
        <h2 style="color:#1f2937;margin:0 0 6px;">${priorityEmoji} ${reminder.title}</h2>
        <p style="color:#6b7280;font-size:14px;margin:0 0 16px;">Due: <strong>${due}</strong></p>
        <p style="color:#374151;font-size:14px;padding:12px 16px;background:#f9fafb;border-radius:8px;border-left:3px solid #b8f566;">${message}</p>
      </div>
      <div style="padding:14px 28px;background:#f9fafb;border-top:1px solid #e5e7eb;">
        <p style="color:#9ca3af;font-size:11px;margin:0;">Sent by RemindMe</p>
      </div>
    </div>`;

  await transporter.sendMail({
    from: process.env.EMAIL_FROM || `"RemindMe" <${process.env.EMAIL_USER}>`,
    to: userEmail,
    subject: `${priorityEmoji} Reminder: ${reminder.title}`,
    html,
  });
  console.log(`📧 Email sent to ${userEmail}`);
}

// ─── Send SMS ─────────────────────────────────────────────────────────────────
async function sendSMS(phoneNumber, reminder, format, mood) {
  if (!twilioClient) throw new Error('Twilio not configured');
  const message = buildMessage(reminder, format, mood);
  const priorityEmoji = { low: '🟢', medium: '🟡', high: '🟠', urgent: '🔴' }[reminder.priority] || '⏰';
  const smsText = `${priorityEmoji} RemindMe: ${reminder.title}\n${message}`;

  await twilioClient.messages.create({
    body: smsText,
    from: process.env.TWILIO_PHONE,
    to: phoneNumber,
  });
  console.log(`💬 SMS sent to ${phoneNumber}`);
}

// ─── Make Phone Call ──────────────────────────────────────────────────────────
async function makePhoneCall(phoneNumber, reminder, format, mood) {
  if (!twilioClient) throw new Error('Twilio not configured');
  const message = buildMessage(reminder, format, mood);

  // TwiML voice message
  const twiml = `<?xml version="1.0" encoding="UTF-8"?>
    <Response>
      <Say voice="alice" rate="${mood === 'angry' ? '130' : mood === 'nice' ? '90' : '100'}%">
        ${message.replace(/&/g,'and').replace(/</g,'').replace(/>/g,'')}
      </Say>
      <Pause length="1"/>
      <Say voice="alice">This reminder was sent by RemindMe. Goodbye!</Say>
    </Response>`;

  await twilioClient.calls.create({
    twiml,
    from: process.env.TWILIO_PHONE,
    to: phoneNumber,
  });
  console.log(`📞 Phone call made to ${phoneNumber}`);
}

// ─── Main dispatch ────────────────────────────────────────────────────────────
async function sendNotification(user, reminder) {
  const format = reminder.notify_format || 'email';
  const mood = reminder.notify_mood || 'nice';
  const promises = [];

  // Email
  if (reminder.notify_email && user.email) {
    promises.push(sendEmail(user.email, reminder, format, mood).catch(e => console.error('Email error:', e.message)));
  }

  // SMS
  if (reminder.notify_sms && user.phone) {
    promises.push(sendSMS(user.phone, reminder, format, mood).catch(e => console.error('SMS error:', e.message)));
  }

  // Phone call
  if (reminder.notify_call && user.phone) {
    promises.push(makePhoneCall(user.phone, reminder, format, mood).catch(e => console.error('Call error:', e.message)));
  }

  await Promise.all(promises);
}

module.exports = { sendNotification, sendEmail, sendSMS, makePhoneCall };
