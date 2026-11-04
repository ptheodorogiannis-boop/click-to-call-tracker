'use strict';
/**
 * One real request to Claude with a made-up Greek transcript, through the same code the app uses (src/services/ai.js),
 * on a throwaway database. Proves the request shape works against the live API. Costs a fraction of a cent.
 *   ANTHROPIC_API_KEY=sk-ant-… node tools/ai-smoke.js
 */
const os = require('os');
const path = require('path');
const fs = require('fs');
process.env.DB_PATH = path.join(os.tmpdir(), `ctc-ai-smoke-${process.pid}.db`);
process.env.ADMIN_PASSWORD = '';

const { db, migrate } = require('../src/db');
const ai = require('../src/services/ai');

const cleanup = () => { for (const f of [process.env.DB_PATH, process.env.DB_PATH + '-wal', process.env.DB_PATH + '-shm']) { try { fs.unlinkSync(f); } catch (e) { /* gone */ } } };

async function main() {
  if (!ai.enabled()) {
    console.log('No ANTHROPIC_API_KEY in the environment. Run: ANTHROPIC_API_KEY=sk-ant-… node tools/ai-smoke.js');
    return 2;
  }
  await migrate();
  await db.prepare("INSERT INTO clients (id, name, forward_number) VALUES ('smoke', 'Οδοντιατρείο Δοκιμή', '+302100000000')").run();
  await db.prepare(`INSERT INTO calls (call_sid, client_id, tracking_number, caller, answered, status, duration_sec, transcript)
    VALUES ('CASMOKE', 'smoke', '+302100000001', '+306900000000', 1, 'answered', 96, ?)`).run(
    'Καλημέρα, σας πήρα γιατί είδα τη διαφήμιση για τα εμφυτεύματα. Θα ήθελα να μάθω πόσο κοστίζει ένα εμφύτευμα ' +
    'και αν μπορώ να κλείσω ραντεβού για αξιολόγηση την επόμενη εβδομάδα. — Βεβαίως, η πρώτη εξέταση είναι δωρεάν. ' +
    'Σας βολεύει Τρίτη στις 11; — Ναι, τέλεια. Το όνομά μου είναι Μαρία.'
  );
  const started = Date.now();
  const r = await ai.summarise('CASMOKE');
  const row = await db.prepare('SELECT ai_summary, ai_label, ai_score FROM calls WHERE call_sid = ?').get('CASMOKE');
  console.log(JSON.stringify({ model: process.env.AI_MODEL || 'claude-opus-5-5', ms: Date.now() - started, result: r, stored: row }, null, 2));
  return r.skipped ? 1 : 0;
}

main()
  .then((code) => { db.close(); cleanup(); process.exit(code); })
  .catch((e) => { cleanup(); console.error(e && e.status ? `API error ${e.status}: ${e.message}` : e); process.exit(1); });
