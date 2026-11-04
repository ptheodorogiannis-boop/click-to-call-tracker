'use strict';
// Who is calling: a signed session cookie (the web app) or a Bearer ct_ token (REST, MCP).
// getSessionUser is the one seam the Marketing Hub's single sign-on will replace.
const crypto = require('crypto');
const cfg = require('./config');
const users = require('./users');

const COOKIE = 'ctc_session';

function sign(payloadB64) {
  return crypto.createHmac('sha256', cfg.admin.sessionSecret).update(payloadB64).digest('base64url');
}

function issue(res, userId) {
  const payload = { uid: userId, exp: Date.now() + cfg.admin.sessionHours * 3600000 };
  const b64 = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const maxAge = cfg.admin.sessionHours * 3600;
  res.setHeader('Set-Cookie',
    `${COOKIE}=${b64}.${sign(b64)}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${maxAge}` +
    (cfg.publicBaseUrl.startsWith('https') ? '; Secure' : ''));
}

function clear(res) {
  res.setHeader('Set-Cookie', `${COOKIE}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0`);
}

function readCookie(req) {
  const m = (req.headers.cookie || '').match(new RegExp('(?:^|; )' + COOKIE + '=([^;]+)'));
  return m ? m[1] : null;
}

// The user is looked up on every request, so a deactivated user or a changed role takes effect at once.
async function getSessionUser(req) {
  if (!cfg.admin.sessionSecret) return null;
  const token = readCookie(req);
  if (!token) return null;
  const [b64, sig] = token.split('.');
  if (!b64 || !sig) return null;
  const expected = sign(b64);
  if (sig.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null;
  try {
    const payload = JSON.parse(Buffer.from(b64, 'base64url').toString());
    if (!payload.exp || payload.exp < Date.now() || !payload.uid) return null;
    return users.getUser(payload.uid);
  } catch (e) { return null; }
}

async function bearerUser(req) {
  const m = (req.headers.authorization || '').match(/^Bearer\s+(\S+)$/i);
  return m ? users.userForToken(m[1]) : null;
}

function requireUser(req, res, next) {
  (async () => (await getSessionUser(req)) || (await bearerUser(req)))().then((user) => {
    if (!user) return res.status(401).json({ error: 'unauthorized' });
    req.user = user;
    next();
  }, next);
}
function requireEdit(req, res, next) {
  if (!users.canEdit(req.user)) return res.status(403).json({ error: 'forbidden' });
  next();
}
function requireOwner(req, res, next) {
  if (!users.isOwner(req.user)) return res.status(403).json({ error: 'forbidden' });
  next();
}

module.exports = { issue, clear, getSessionUser, bearerUser, requireUser, requireEdit, requireOwner };
