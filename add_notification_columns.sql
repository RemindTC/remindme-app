-- Add phone and notification columns to users table
ALTER TABLE users ADD COLUMN IF NOT EXISTS phone VARCHAR(20);

-- Add notification type columns to reminders table
ALTER TABLE reminders ADD COLUMN IF NOT EXISTS notify_sms BOOLEAN DEFAULT false;
ALTER TABLE reminders ADD COLUMN IF NOT EXISTS notify_call BOOLEAN DEFAULT false;
ALTER TABLE reminders ADD COLUMN IF NOT EXISTS notify_format VARCHAR(20) DEFAULT 'email';
ALTER TABLE reminders ADD COLUMN IF NOT EXISTS notify_mood VARCHAR(20) DEFAULT 'nice';
