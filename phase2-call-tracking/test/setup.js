'use strict';
// Loaded with `node --test --require ./test/setup.js` before anything else, so config.js / db.js never see the
// project's .env values for these (dotenv does not override variables that are already set).
const os = require('os');
const path = require('path');
const fs = require('fs');

const dir = path.join(process.env.CTC_TEST_TMP || os.tmpdir(), 'ctc-tests');
fs.mkdirSync(dir, { recursive: true });
const db = path.join(dir, `test-${process.pid}-${Date.now()}.db`);

Object.assign(process.env, {
  DB_PATH: db,
  PORT: '0',
  PUBLIC_BASE_URL: 'http://localhost',
  SESSION_SECRET: 'test-secret-0123456789abcdef0123456789abcdef',
  ADMIN_USER: 'admin',
  ADMIN_PASSWORD: 'admin-password-123',
  REPORT_API_KEY: 'test-report-key',
  VALIDATE_TWILIO_SIGNATURE: 'false',
  TRANSCRIPTION_PROVIDER: 'none',
  OPENAI_API_KEY: '',
  ANTHROPIC_API_KEY: ''
});

process.on('exit', () => { for (const f of [db, db + '-wal', db + '-shm']) { try { fs.unlinkSync(f); } catch (e) { /* gone */ } } });
