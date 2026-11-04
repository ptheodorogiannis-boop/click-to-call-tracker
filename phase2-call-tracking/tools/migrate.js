'use strict';
// Apply the schema (idempotent): the local file (DB_PATH) or, with TURSO_DATABASE_URL set, the Turso database.
// Also creates the first owner from ADMIN_USER / ADMIN_PASSWORD when there are no users yet.
const { migrate, db, isLocal } = require('../src/db');
const { bootstrapOwner } = require('../src/users');

(async () => {
  await migrate();
  const owner = await bootstrapOwner();
  if (owner) console.log(`created owner "${owner.login}"`);
  console.log('migrated:', isLocal() ? require('../src/config').dbPath : process.env.TURSO_DATABASE_URL.replace(/\?.*$/, ''));
  db.close();
})().catch((e) => { console.error(e.message || e); process.exit(1); });
