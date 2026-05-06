const express = require('express');
const pool = require('./db');
const { authenticateToken } = require('./auth');

const router = express.Router();

// All reminder routes require authentication
router.use(authenticateToken);

// Valid values
const VALID_PRIORITIES = ['low', 'medium', 'high', 'urgent'];
const VALID_RECURRENCES = ['none', 'daily', 'weekly', 'monthly', 'yearly'];

// ─── GET /reminders ─────────────────────────────────────────────────────────
// List reminders with optional filters: ?category=work&priority=high&completed=false
router.get('/', async (req, res) => {
  const { category, priority, completed, due_before, due_after } = req.query;
  const userId = req.user.userId;

  let query = `
    SELECT r.*, c.name AS category_name, c.color AS category_color
    FROM reminders r
    LEFT JOIN categories c ON r.category_id = c.id
    WHERE r.user_id = $1
  `;
  const params = [userId];
  let idx = 2;

  if (category) {
    query += ` AND c.name ILIKE $${idx++}`;
    params.push(category);
  }
  if (priority && VALID_PRIORITIES.includes(priority)) {
    query += ` AND r.priority = $${idx++}`;
    params.push(priority);
  }
  if (completed !== undefined) {
    query += ` AND r.completed = $${idx++}`;
    params.push(completed === 'true');
  }
  if (due_before) {
    query += ` AND r.due_at <= $${idx++}`;
    params.push(due_before);
  }
  if (due_after) {
    query += ` AND r.due_at >= $${idx++}`;
    params.push(due_after);
  }

  query += ' ORDER BY r.due_at ASC NULLS LAST, r.created_at DESC';

  try {
    const result = await pool.query(query, params);
    res.json(result.rows);
  } catch (err) {
    console.error('List reminders error:', err);
    res.status(500).json({ error: 'Failed to fetch reminders' });
  }
});

// ─── POST /reminders ─────────────────────────────────────────────────────────
// Create a reminder
router.post('/', async (req, res) => {
  const {
    title,
    description,
    due_at,
    priority = 'medium',
    category_id,
    recurrence = 'none',
    notify_email = false,
    notify_minutes_before = 30,
  } = req.body;

  if (!title) {
    return res.status(400).json({ error: 'Title is required' });
  }
  if (!VALID_PRIORITIES.includes(priority)) {
    return res.status(400).json({ error: `Priority must be one of: ${VALID_PRIORITIES.join(', ')}` });
  }
  if (!VALID_RECURRENCES.includes(recurrence)) {
    return res.status(400).json({ error: `Recurrence must be one of: ${VALID_RECURRENCES.join(', ')}` });
  }

  const userId = req.user.userId;

  try {
    const result = await pool.query(
      `INSERT INTO reminders
        (user_id, title, description, due_at, priority, category_id, recurrence, notify_email, notify_minutes_before)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       RETURNING *`,
      [userId, title, description || null, due_at || null, priority, category_id || null, recurrence, notify_email, notify_minutes_before]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error('Create reminder error:', err);
    res.status(500).json({ error: 'Failed to create reminder' });
  }
});

// ─── GET /reminders/:id ───────────────────────────────────────────────────────
router.get('/:id', async (req, res) => {
  const { id } = req.params;
  const userId = req.user.userId;

  try {
    const result = await pool.query(
      `SELECT r.*, c.name AS category_name, c.color AS category_color
       FROM reminders r
       LEFT JOIN categories c ON r.category_id = c.id
       WHERE r.id = $1 AND r.user_id = $2`,
      [id, userId]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Reminder not found' });
    }
    res.json(result.rows[0]);
  } catch (err) {
    console.error('Get reminder error:', err);
    res.status(500).json({ error: 'Failed to fetch reminder' });
  }
});

// ─── PATCH /reminders/:id ─────────────────────────────────────────────────────
// Update any fields
router.patch('/:id', async (req, res) => {
  const { id } = req.params;
  const userId = req.user.userId;

  const allowedFields = [
    'title', 'description', 'due_at', 'priority',
    'category_id', 'recurrence', 'completed',
    'notify_email', 'notify_minutes_before',
  ];

  const updates = {};
  for (const field of allowedFields) {
    if (req.body[field] !== undefined) updates[field] = req.body[field];
  }

  if (Object.keys(updates).length === 0) {
    return res.status(400).json({ error: 'No valid fields to update' });
  }
  if (updates.priority && !VALID_PRIORITIES.includes(updates.priority)) {
    return res.status(400).json({ error: `Priority must be one of: ${VALID_PRIORITIES.join(', ')}` });
  }
  if (updates.recurrence && !VALID_RECURRENCES.includes(updates.recurrence)) {
    return res.status(400).json({ error: `Recurrence must be one of: ${VALID_RECURRENCES.join(', ')}` });
  }

  // If marking complete and recurrence is set, schedule next occurrence
  if (updates.completed === true) {
    const current = await pool.query(
      'SELECT * FROM reminders WHERE id = $1 AND user_id = $2',
      [id, userId]
    );
    if (current.rows.length === 0) {
      return res.status(404).json({ error: 'Reminder not found' });
    }
    const reminder = current.rows[0];
    if (reminder.recurrence !== 'none' && reminder.due_at) {
      await scheduleNextOccurrence(reminder, userId);
    }
  }

  const setClauses = Object.keys(updates).map((key, i) => `${key} = $${i + 3}`);
  const values = [...Object.values(updates), id, userId];

  try {
    const result = await pool.query(
      `UPDATE reminders SET ${setClauses.join(', ')}, updated_at = NOW()
       WHERE id = $${values.length - 1} AND user_id = $${values.length}
       RETURNING *`,
      values
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Reminder not found' });
    }
    res.json(result.rows[0]);
  } catch (err) {
    console.error('Update reminder error:', err);
    res.status(500).json({ error: 'Failed to update reminder' });
  }
});

// ─── DELETE /reminders/:id ────────────────────────────────────────────────────
router.delete('/:id', async (req, res) => {
  const { id } = req.params;
  const userId = req.user.userId;

  try {
    const result = await pool.query(
      'DELETE FROM reminders WHERE id = $1 AND user_id = $2 RETURNING id',
      [id, userId]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Reminder not found' });
    }
    res.json({ message: 'Reminder deleted', id: result.rows[0].id });
  } catch (err) {
    console.error('Delete reminder error:', err);
    res.status(500).json({ error: 'Failed to delete reminder' });
  }
});

// ─── GET /reminders/upcoming ──────────────────────────────────────────────────
// Next 7 days of reminders
router.get('/filter/upcoming', async (req, res) => {
  const userId = req.user.userId;
  const days = parseInt(req.query.days) || 7;

  try {
    const result = await pool.query(
      `SELECT r.*, c.name AS category_name, c.color AS category_color
       FROM reminders r
       LEFT JOIN categories c ON r.category_id = c.id
       WHERE r.user_id = $1
         AND r.completed = false
         AND r.due_at BETWEEN NOW() AND NOW() + INTERVAL '${days} days'
       ORDER BY r.due_at ASC`,
      [userId]
    );
    res.json(result.rows);
  } catch (err) {
    console.error('Upcoming reminders error:', err);
    res.status(500).json({ error: 'Failed to fetch upcoming reminders' });
  }
});

// ─── Categories sub-routes ────────────────────────────────────────────────────

// GET /reminders/categories
router.get('/categories/all', async (req, res) => {
  const userId = req.user.userId;
  try {
    const result = await pool.query(
      'SELECT * FROM categories WHERE user_id = $1 ORDER BY name',
      [userId]
    );
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch categories' });
  }
});

// POST /reminders/categories
router.post('/categories', async (req, res) => {
  const { name, color = '#6366f1' } = req.body;
  const userId = req.user.userId;

  if (!name) return res.status(400).json({ error: 'Category name is required' });

  try {
    const result = await pool.query(
      'INSERT INTO categories (user_id, name, color) VALUES ($1, $2, $3) RETURNING *',
      [userId, name, color]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ error: 'Category already exists' });
    res.status(500).json({ error: 'Failed to create category' });
  }
});

// DELETE /reminders/categories/:id
router.delete('/categories/:id', async (req, res) => {
  const { id } = req.params;
  const userId = req.user.userId;

  try {
    const result = await pool.query(
      'DELETE FROM categories WHERE id = $1 AND user_id = $2 RETURNING id',
      [id, userId]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Category not found' });
    res.json({ message: 'Category deleted' });
  } catch (err) {
    res.status(500).json({ error: 'Failed to delete category' });
  }
});

// ─── Helper: schedule next recurrence ────────────────────────────────────────
async function scheduleNextOccurrence(reminder, userId) {
  const due = new Date(reminder.due_at);
  let nextDue;

  switch (reminder.recurrence) {
    case 'daily':   nextDue = new Date(due.setDate(due.getDate() + 1)); break;
    case 'weekly':  nextDue = new Date(due.setDate(due.getDate() + 7)); break;
    case 'monthly': nextDue = new Date(due.setMonth(due.getMonth() + 1)); break;
    case 'yearly':  nextDue = new Date(due.setFullYear(due.getFullYear() + 1)); break;
    default: return;
  }

  await pool.query(
    `INSERT INTO reminders
      (user_id, title, description, due_at, priority, category_id, recurrence, notify_email, notify_minutes_before)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
    [
      userId,
      reminder.title,
      reminder.description,
      nextDue,
      reminder.priority,
      reminder.category_id,
      reminder.recurrence,
      reminder.notify_email,
      reminder.notify_minutes_before,
    ]
  );
}

module.exports = router;
