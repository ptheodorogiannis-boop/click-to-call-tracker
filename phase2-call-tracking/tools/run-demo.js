'use strict';
// Serve the app on the demo database (tools/demo.js) at http://localhost:8099. Never touches calls.db.
const path = require('path');
process.env.DB_PATH = path.join(__dirname, '..', 'data', 'demo.db');
process.env.PORT = process.env.DEMO_PORT || '8099';
process.env.PUBLIC_BASE_URL = `http://localhost:${process.env.PORT}`;
process.env.ADMIN_PASSWORD = 'demo-password-1';
process.env.SESSION_SECRET = process.env.SESSION_SECRET || 'demo-session-secret-0123456789abcdef';
process.env.VALIDATE_TWILIO_SIGNATURE = 'false';
require('../src/server');
