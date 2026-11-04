'use strict';
// Call events, for the things that react to them (webhooks, alerts, AI summaries). Listeners run after the
// response, never throw into the request, and are awaited by tests through `settle()`.
//   call.completed  the call ended (answered or missed), or was blocked
//   call.updated    someone changed lead status, value, tags, notes or called back
//   call.transcribed a transcript arrived
const listeners = new Map();
const pending = new Set();

function on(type, fn) {
  if (!listeners.has(type)) listeners.set(type, []);
  listeners.get(type).push(fn);
}

// On Vercel the function may stop once it has answered; waitUntil keeps it alive until these finish
// (within the function's maxDuration). Elsewhere the process simply keeps running.
let waitUntil = () => {};
if (process.env.VERCEL) { try { ({ waitUntil } = require('@vercel/functions')); } catch (e) { /* not installed: best effort */ } }

function emit(type, callSid) {
  for (const fn of listeners.get(type) || []) {
    const p = Promise.resolve()
      .then(() => fn(callSid, type))
      .catch((e) => console.error(`[events] ${type}`, callSid, String(e && e.stack ? e.stack : e).slice(0, 300)))
      .finally(() => pending.delete(p));
    pending.add(p);
    try { waitUntil(p); } catch (e) { /* outside a request: nothing to extend */ }
  }
}

// Other work that finishes after the response (conversion uploads, transcription): kept alive the same way, and
// awaited by settle().
function background(work) {
  const p = Promise.resolve(work)
    .catch((e) => console.error('[background]', String(e && e.stack ? e.stack : e).slice(0, 300)))
    .finally(() => pending.delete(p));
  pending.add(p);
  try { waitUntil(p); } catch (e) { /* outside a request */ }
  return p;
}

// Wait until every listener started so far (and any they started) has finished.
async function settle() {
  while (pending.size) await Promise.all([...pending]);
}

module.exports = { on, emit, background, settle };
