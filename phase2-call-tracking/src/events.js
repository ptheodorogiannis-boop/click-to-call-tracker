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

function emit(type, callSid) {
  for (const fn of listeners.get(type) || []) {
    const p = Promise.resolve()
      .then(() => fn(callSid, type))
      .catch((e) => console.error(`[events] ${type}`, callSid, String(e && e.stack ? e.stack : e).slice(0, 300)))
      .finally(() => pending.delete(p));
    pending.add(p);
  }
}

// Wait until every listener started so far (and any they started) has finished.
async function settle() {
  while (pending.size) await Promise.all([...pending]);
}

module.exports = { on, emit, settle };
