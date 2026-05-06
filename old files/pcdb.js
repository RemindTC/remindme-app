const { Pool } = require('pg');

const pool = new Pool({
  user: 'postgres',
  host: 'localhost',
  database: 'auto_reminder',
  password: 'newpassword123',
  port: 5432,
});

module.exports = pool;
