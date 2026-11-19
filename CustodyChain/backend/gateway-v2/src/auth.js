'use strict';
// Prototype authentication (D-043): users.json with scrypt hashes, in-memory bearer sessions.
const crypto = require('crypto');
const fs = require('fs');
const cfg = require('./config');

const ROLE_LABEL = { io: 'Investigating Officer', malkhana: 'Malkhana In-charge', examiner: 'FSL Examiner', court_clerk: 'Court Property Clerk' };
const sessions = new Map();

function loadUsers() { return JSON.parse(fs.readFileSync(cfg.USERS_FILE, 'utf8')); }

function publicUser(username, u) {
    const org = cfg.ORGS[u.org];
    return { username, name: u.name, org: u.org, org_name: org.name, msp: org.msp, role: u.role,
        role_label: ROLE_LABEL[u.role] || u.role, designation: u.designation, badge: u.badge };
}

function login(username, password) {
    const users = loadUsers();
    const u = users[username];
    const fake = 'scrypt$00$00';
    const [, saltHex, hashHex] = (u ? u.password : fake).split('$');
    const got = crypto.scryptSync(String(password || ''), Buffer.from(saltHex, 'hex'), 32);
    const want = Buffer.from(hashHex.padEnd(64, '0'), 'hex');
    if (!u || !crypto.timingSafeEqual(got, want)) return null;
    const token = crypto.randomBytes(32).toString('hex');
    sessions.set(token, { username, expires: Date.now() + cfg.SESSION_HOURS * 3600e3 });
    return { token, user: publicUser(username, u) };
}

function logout(token) { sessions.delete(token); }

function middleware(req, res, next) {
    const h = req.headers.authorization || '';
    const token = h.startsWith('Bearer ') ? h.slice(7) : null;
    const s = token && sessions.get(token);
    if (!s || s.expires < Date.now()) { if (s) sessions.delete(token); return res.status(401).json({ error: 'not logged in' }); }
    const u = loadUsers()[s.username];
    if (!u) return res.status(401).json({ error: 'unknown user' });
    req.user = publicUser(s.username, u);
    req.token = token;
    return next();
}

function directory() {
    const users = loadUsers();
    return Object.entries(users).map(([n, u]) => publicUser(n, u));
}

module.exports = { login, logout, middleware, directory, ROLE_LABEL };
