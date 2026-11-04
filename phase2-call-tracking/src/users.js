'use strict';
// People and access: users with roles, the clients a client user may see, and personal API tokens.
const crypto = require('crypto');
const cfg = require('./config');
const { db } = require('./db');

const ROLES = ['owner', 'member', 'client'];

// ── passwords (scrypt, built into Node) ────────────────
function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(String(password), salt, 32);
  return `scrypt$${salt.toString('base64url')}$${hash.toString('base64url')}`;
}
function verifyPassword(password, stored) {
  const [kind, salt, hash] = String(stored || '').split('$');
  if (kind !== 'scrypt' || !salt || !hash) return false;
  const expected = Buffer.from(hash, 'base64url');
  const got = crypto.scryptSync(String(password), Buffer.from(salt, 'base64url'), expected.length);
  return crypto.timingSafeEqual(got, expected);
}

const s = {
  byId: db.prepare('SELECT * FROM users WHERE id = ?'),
  byLogin: db.prepare('SELECT * FROM users WHERE login = ?'),
  list: db.prepare('SELECT id, login, name, role, active, created_at, last_login_at FROM users ORDER BY role, name'),
  count: db.prepare('SELECT COUNT(*) n FROM users'),
  insert: db.prepare('INSERT INTO users (login, name, password_hash, role) VALUES (@login, @name, @password_hash, @role)'),
  touchLogin: db.prepare("UPDATE users SET last_login_at = datetime('now') WHERE id = ?"),
  clientIds: db.prepare('SELECT client_id FROM user_clients WHERE user_id = ? ORDER BY client_id'),
  clearClients: db.prepare('DELETE FROM user_clients WHERE user_id = ?'),
  addClient: db.prepare('INSERT OR IGNORE INTO user_clients (user_id, client_id) VALUES (?, ?)'),
  tokenInsert: db.prepare('INSERT INTO api_tokens (user_id, name, prefix, token_hash) VALUES (?, ?, ?, ?)'),
  tokenByHash: db.prepare('SELECT * FROM api_tokens WHERE token_hash = ? AND revoked_at IS NULL'),
  tokenTouch: db.prepare("UPDATE api_tokens SET last_used_at = datetime('now') WHERE id = ?"),
  tokenList: db.prepare('SELECT id, name, prefix, created_at, last_used_at FROM api_tokens WHERE user_id = ? AND revoked_at IS NULL ORDER BY created_at DESC'),
  tokenRevoke: db.prepare("UPDATE api_tokens SET revoked_at = datetime('now') WHERE id = ? AND user_id = ? AND revoked_at IS NULL")
};

// The shape the rest of the app sees: never the password hash.
function publicUser(u) {
  if (!u) return null;
  return {
    id: u.id, login: u.login, name: u.name, role: u.role, active: !!u.active,
    created_at: u.created_at, last_login_at: u.last_login_at,
    client_ids: u.role === 'client' ? s.clientIds.all(u.id).map((r) => r.client_id) : null
  };
}

function getUser(id) {
  const u = s.byId.get(id);
  return u && u.active ? publicUser(u) : null;
}

function login(loginName, password) {
  const u = s.byLogin.get(String(loginName || '').trim());
  if (!u || !u.active || !verifyPassword(password || '', u.password_hash)) return null;
  s.touchLogin.run(u.id);
  return publicUser(u);
}

function listUsers() { return s.list.all().map((u) => publicUser(u)); }

function createUser({ login: loginName, name, password, role, client_ids }) {
  if (!ROLES.includes(role)) throw new Error('role must be owner, member or client');
  if (!loginName || !password || String(password).length < 10) throw new Error('login and a password of at least 10 characters are required');
  const id = db.transaction(() => {
    const r = s.insert.run({ login: String(loginName).trim(), name: name || loginName, password_hash: hashPassword(password), role });
    setClients(r.lastInsertRowid, role === 'client' ? client_ids : []);
    return r.lastInsertRowid;
  })();
  return getUser(id);
}

function updateUser(id, { name, role, active, password, client_ids }) {
  const u = s.byId.get(id);
  if (!u) return null;
  if (role && !ROLES.includes(role)) throw new Error('role must be owner, member or client');
  if (password && String(password).length < 10) throw new Error('password must be at least 10 characters');
  db.transaction(() => {
    db.prepare('UPDATE users SET name = ?, role = ?, active = ?, password_hash = ? WHERE id = ?').run(
      name ?? u.name, role ?? u.role, active == null ? u.active : (active ? 1 : 0),
      password ? hashPassword(password) : u.password_hash, id);
    const nextRole = role ?? u.role;
    if (nextRole !== 'client') setClients(id, []);
    else if (client_ids) setClients(id, client_ids);
  })();
  return publicUser(s.byId.get(id));
}

// A person changing their own password must know the current one.
function changePassword(userId, current, next) {
  const u = s.byId.get(userId);
  if (!u || !verifyPassword(current || '', u.password_hash)) return 'wrong';
  if (!next || String(next).length < 10) return 'short';
  db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hashPassword(next), userId);
  return 'ok';
}

function setClients(userId, clientIds) {
  s.clearClients.run(userId);
  for (const c of clientIds || []) s.addClient.run(userId, c);
}

// Keeps existing deployments signing in: the first boot of v2 turns ADMIN_USER / ADMIN_PASSWORD into the owner.
function bootstrapOwner() {
  if (s.count.get().n > 0 || !cfg.admin.password) return null;
  const r = s.insert.run({ login: cfg.admin.user, name: cfg.admin.user, password_hash: hashPassword(cfg.admin.password), role: 'owner' });
  return getUser(r.lastInsertRowid);
}

// ── scope ──────────────────────────────────────────────
// null means every client; otherwise the list this user may see (possibly empty).
function clientIdsFor(user) { return user.role === 'client' ? user.client_ids || [] : null; }
function canSeeClient(user, clientId) { const ids = clientIdsFor(user); return ids === null || ids.includes(clientId); }
const canEdit = (user) => user.role === 'owner' || user.role === 'member';
const isOwner = (user) => user.role === 'owner';

// ── API tokens ─────────────────────────────────────────
const sha = (t) => crypto.createHash('sha256').update(t).digest('hex');

function createToken(userId, name) {
  const token = 'ct_' + crypto.randomBytes(24).toString('base64url');
  const r = s.tokenInsert.run(userId, String(name || 'Token').slice(0, 60), token.slice(0, 7), sha(token));
  return { id: r.lastInsertRowid, token };
}
function userForToken(token) {
  if (!token || !String(token).startsWith('ct_')) return null;
  const row = s.tokenByHash.get(sha(String(token)));
  if (!row) return null;
  const u = getUser(row.user_id);
  if (u) s.tokenTouch.run(row.id);
  return u;
}
const listTokens = (userId) => s.tokenList.all(userId);
const revokeToken = (userId, id) => s.tokenRevoke.run(id, userId).changes > 0;

module.exports = {
  ROLES, hashPassword, verifyPassword, getUser, login, listUsers, createUser, updateUser, bootstrapOwner, changePassword,
  clientIdsFor, canSeeClient, canEdit, isOwner, createToken, userForToken, listTokens, revokeToken
};
