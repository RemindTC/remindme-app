const express = require('express');
const pool = require('./db');
const authRoutes = require('./auth');
const app = express();

app.use(express.json());

app.use('/auth', authRoutes);

app.get('/', function(req, res) {
  res.send('Hello, your reminder app is running!');
});

app.get('/test-db', function(req, res) {
  pool.query('SELECT NOW()').then(function(result) {
    res.json({ message: 'Database connected!', time: result.rows[0].now });
  }).catch(function(err) {
    res.json({ error: err.message });
  });
});

app.listen(3000, function() {
  console.log('Server running on port 3000');
});
