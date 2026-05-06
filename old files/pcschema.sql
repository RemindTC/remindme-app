-- ============================================================
-- Reminder App - Database Schema
-- Run this once to set up your database
-- ============================================================

-- Users table
CREATE TABLE IF NOT EXISTS users (
  id            SERIAL PRIMARY KEY,
  email         VARCHAR(255) UNIQUE NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  name          VARCHAR(100),
  created_at    TIMESTAMPTZ DEFAULT NOW()
);

-- Categories table
CREATE TABLE IF NOT EXISTS categories (
  id         SERIAL PRIMARY KEY,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name       VARCHAR(100) NOT NULL,
  color      VARCHAR(20) DEFAULT '#6366f1',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (user_id, name)
);

-- Reminders table
CREATE TABLE IF NOT EXISTS reminders (
  id                      SERIAL PRIMARY KEY,
  user_id                 INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  category_id             INTEGER REFERENCES categories(id) ON DELETE SET NULL,
  title                   VARCHAR(255) NOT NULL,
  description             TEXT,
  due_at                  TIMESTAMPTZ,
  priority                VARCHAR(20) DEFAULT 'medium'
                            CHECK (priority IN ('low', 'medium', 'high', 'urgent')),
  recurrence              VARCHAR(20) DEFAULT 'none'
                            CHECK (recurrence IN ('none', 'daily', 'weekly', 'monthly', 'yearly')),
  completed               BOOLEAN DEFAULT false,
  notify_email            BOOLEAN DEFAULT false,
  notify_minutes_before   INTEGER DEFAULT 30,
  notified                BOOLEAN DEFAULT false,  -- tracks if email already sent
  created_at              TIMESTAMPTZ DEFAULT NOW(),
  updated_at              TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes for common queries
CREATE INDEX IF NOT EXISTS idx_reminders_user_id ON reminders(user_id);
CREATE INDEX IF NOT EXISTS idx_reminders_due_at ON reminders(due_at);
CREATE INDEX IF NOT EXISTS idx_reminders_completed ON reminders(completed);
CREATE INDEX IF NOT EXISTS idx_reminders_notify ON reminders(notify_email, notified, due_at)
  WHERE notify_email = true AND notified = false;
