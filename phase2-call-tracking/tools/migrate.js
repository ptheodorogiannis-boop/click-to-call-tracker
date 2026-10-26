'use strict';
// Apply the SQL schema (idempotent).
const { migrate } = require('../src/db');
migrate();
console.log('migrated:', require('../src/config').dbPath);
