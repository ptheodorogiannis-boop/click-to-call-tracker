'use strict';
const crypto = require('crypto');
const cfg = require('./config');

const COOKIE = 'ctc_session';

function sign(payloadB64) {
  return crypto.createHmac('sha256', cfg.admin.sessionSecret).update(payloadB64).digest('base64url');
}

function issue(res, user) {
  const payload = { u: user, exp: Date.now() + cfg.admin.sessionHours * 3600000 };
  const b64 = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const token = b64 + '.' + sign(b64);
  const maxAge = cfg.admin.sessionHours * 3600;
  res.setHeader('Set-Cookie',
    `${COOKIE}=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${maxAge}` +
    (cfg.publicBaseUrl.startsWith('https') ? '; Secure' : ''));
}

function clear(res) {
  res.setHeader('Set-Cookie', `${COOKIE}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0`);
}

function readCookie(req) {
  const raw = req.headers.cookie || '';
  const m = raw.match(new RegExp('(?:^|; )' + COOKIE + '=([^;]+)'));
  return m ? m[1] : null;
}

function verify(req) {
  const token = readCookie(req);
  if (!token) return null;
  const [b64, sig] = token.split('.');
  if (!b64 || !sig) return null;
  const expected = sign(b64);
  // constant-time compare
  if (sig.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null;
  try {
    const payload = JSON.parse(Buffer.from(b64, 'base64url').toString());
    if (!payload.exp || payload.exp < Date.now()) return null;
    return payload.u;
  } catch (e) { return null; }
}

function requireAuth(req, res, next) {
  const user = verify(req);
  if (!user) return res.status(401).json({ error: 'unauthorized' });
  req.adminUser = user;
  next();
}

// Validate the login form against configured credentials (constant-time).
function checkLogin(user, password) {
  if (!cfg.admin.password || !cfg.admin.sessionSecret) return 'not_configured';
  const uOk = safeEq(user || '', cfg.admin.user);
  const pOk = safeEq(password || '', cfg.admin.password);
  return uOk && pOk ? 'ok' : 'bad';
}
function safeEq(a, b) {
  const ab = Buffer.from(String(a)), bb = Buffer.from(String(b));
  if (ab.length !== bb.length) return false;
  return crypto.timingSafeEqual(ab, bb);
}

module.exports = { issue, clear, verify, requireAuth, checkLogin };
