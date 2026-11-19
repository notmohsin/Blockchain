'use strict';
/*
 * CustodyChain API v2 (M4). Every ledger call is signed with the logged-in user's own certificate.
 * Routes (all under /api, all but /login and /health need "Authorization: Bearer <token>"):
 *   POST /login {username,password}            GET  /me            POST /logout          GET /users
 *   GET  /evidence?scope=mine|org|case&fir=&ps=  GET  /inbox
 *   POST /evidence           (multipart: draft, client_hashes, files)   register a new item
 *   POST /evidence/:id/derive (multipart, same as above)                 derived item (examiner)
 *   GET  /evidence/:id        record + history       GET /evidence/:id/manifest
 *   POST /evidence/:id/transfer {to_user, reason, location}
 *   POST /evidence/:id/accept|reject {seal_ids_observed, seal_intact, reason, location}
 *   POST /evidence/:id/cancel {reason}
 *   POST /evidence/:id/events {type, details, reason, location}
 *   POST /evidence/:id/verify (multipart: file)          integrity check against the ledger (recorded)
 *   GET  /evidence/:id/artefacts/:aid?reason=...          download (decrypted, re-hashed, recorded as ACCESS)
 *   GET  /evidence/:id/proof/:aid                         RFC 6962 inclusion proof
 */
const express = require('express');
const cors = require('cors');
const multer = require('multer');
const fs = require('fs');
const path = require('path');
const cfg = require('./config');
const auth = require('./auth');
const fabric = require('./fabric');
const fp = require('./lib/fingerprint');
const { EvidenceStore } = require('./store');
const { buildManifest, ledgerRecord, badRequest } = require('./manifest');

const store = new EvidenceStore(cfg.STORE_DIR, cfg.KEY_DIR);
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: cfg.MAX_FILE_MB * 1024 * 1024, files: 60 } });
const app = express();
app.use(cors());
app.use(express.json({ limit: '2mb' }));

const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
const ROLE_CAN_REGISTER = ['io'];

function parseField(req, name, fallback) {
    const v = req.body[name];
    if (v === undefined || v === '') return fallback;
    try { return typeof v === 'string' ? JSON.parse(v) : v; } catch (e) { throw badRequest(`${name} is not valid JSON`); }
}
function filesByField(req) {
    const out = {};
    for (const f of req.files || []) out[f.fieldname] = f;
    return out;
}
function orgOfMsp(msp) { return Object.keys(cfg.ORGS).find((k) => cfg.ORGS[k].msp === msp); }

async function nextEvidenceId(user, draft) {
    const c = draft.case || {};
    const prefix = cfg.UNITS[c.police_station];
    if (!prefix) throw badRequest(`unknown police station '${c.police_station}'. Known: ${Object.keys(cfg.UNITS).join('; ')}`);
    const m = /^([0-9]{1,6})\/([0-9]{4})$/.exec(c.fir_number || '');
    if (!m) throw badRequest('case.fir_number must look like 123/2026');
    const existing = await fabric.evaluate(user, 'QueryByCase', c.fir_number, c.police_station);
    const used = new Set(existing.map((e) => e.evidence_id));
    let n = existing.length + 1;
    const make = (k) => `${prefix}-${m[2]}-${m[1].padStart(6, '0')}-E${String(k).padStart(3, '0')}`;
    while (used.has(make(n))) n += 1;
    return make(n);
}

async function registerFromUpload(req, parentId) {
    const draft = parseField(req, 'draft');
    const clientHashes = parseField(req, 'client_hashes', {});
    const reason = String(req.body.reason || '').trim();
    const location = String(req.body.location || '').trim();
    if (reason.length < 3) throw badRequest('reason is required');
    let parent = null;
    if (parentId) {
        parent = await fabric.evaluate(req.user, 'GetEvidence', parentId);
        draft.case = { ...(draft.case || {}), fir_number: parent.case.fir_number, police_station: parent.case.police_station };
    }
    const evidenceId = await nextEvidenceId(req.user, draft);
    const built = buildManifest({ draft, files: filesByField(req), clientHashes, user: req.user,
        certSubject: fabric.certSubject(req.user), evidenceId, parentId });
    // Store encrypted files and the canonical manifest BEFORE anchoring, so the ledger never points at missing data.
    for (const b of built.blobs) store.put(b.buffer, { agency: req.user.org, media_type: b.media_type, uploaded_by: req.user.username, file_name: b.file_name });
    store.put(built.canonical, { agency: req.user.org, media_type: 'application/json', uploaded_by: req.user.username, file_name: `${evidenceId}.manifest.json` });
    const rec = ledgerRecord(built.manifest, built.manifestSha256);
    const out = parentId
        ? await fabric.submit(req.user, 'DeriveEvidence', [parentId, JSON.stringify(rec), reason, location])
        : await fabric.submit(req.user, 'RegisterEvidence', [JSON.stringify(rec), reason, location]);
    return { record: out, manifest: built.manifest };
}

function loadManifest(rec) {
    if (!store.has(rec.manifest_sha256)) return null;
    const { buf } = store.get(rec.manifest_sha256);
    return JSON.parse(buf.toString('utf8'));
}

// ---------------------------------------------------------------------------------------------- routes
const api = express.Router();
api.get('/health', (req, res) => res.json({ ok: true, channel: cfg.CHANNEL, chaincode: cfg.CHAINCODE }));
api.post('/login', (req, res) => {
    const r = auth.login(req.body.username, req.body.password);
    if (!r) return res.status(401).json({ error: 'wrong username or password' });
    return res.json(r);
});
api.use(auth.middleware);
api.post('/logout', (req, res) => { auth.logout(req.token); res.json({ ok: true }); });
api.get('/me', wrap(async (req, res) => res.json({ ...req.user, ledger_identity: await fabric.evaluate(req.user, 'WhoAmI') })));
api.get('/users', (req, res) => res.json(auth.directory()));
api.get('/meta', (req, res) => res.json({ units: Object.keys(cfg.UNITS), orgs: Object.fromEntries(Object.entries(cfg.ORGS).map(([k, o]) => [k, { msp: o.msp, name: o.name }])) }));

api.get('/evidence', wrap(async (req, res) => {
    const scope = req.query.scope || 'org';
    let list;
    if (scope === 'case') list = await fabric.evaluate(req.user, 'QueryByCase', req.query.fir, req.query.ps);
    else list = await fabric.evaluate(req.user, 'QueryByCustodianOrg', req.query.msp || req.user.msp);
    if (scope === 'mine') list = list.filter((e) => e.custodian.cn === req.user.username);
    res.json(list.sort((a, b) => (a.evidence_id < b.evidence_id ? -1 : 1)));
}));

api.get('/inbox', wrap(async (req, res) => {
    const list = await fabric.evaluate(req.user, 'QueryPendingFor', req.user.msp);
    res.json(list.filter((e) => e.pending_transfer && e.pending_transfer.to_user === req.user.username));
}));

api.post('/evidence', upload.any(), wrap(async (req, res) => {
    if (!ROLE_CAN_REGISTER.includes(req.user.role)) throw Object.assign(new Error('only an investigating officer can register evidence'), { status: 403 });
    res.status(201).json(await registerFromUpload(req, null));
}));

api.post('/evidence/:id/derive', upload.any(), wrap(async (req, res) => {
    res.status(201).json(await registerFromUpload(req, req.params.id));
}));

api.get('/evidence/:id', wrap(async (req, res) => {
    const [record, history] = await Promise.all([
        fabric.evaluate(req.user, 'GetEvidence', req.params.id),
        fabric.evaluate(req.user, 'GetHistory', req.params.id)]);
    res.json({ record, history, manifest_available: store.has(record.manifest_sha256) });
}));

api.get('/evidence/:id/manifest', wrap(async (req, res) => {
    const record = await fabric.evaluate(req.user, 'GetEvidence', req.params.id);
    const manifest = loadManifest(record);
    if (!manifest) return res.status(404).json({ error: 'manifest not in this evidence store' });
    const recomputed = fp.manifestHash(manifest);
    return res.json({ manifest, checks: { manifest_sha256_matches_ledger: recomputed === record.manifest_sha256,
        merkle_root_matches_ledger: fp.manifestMerkleRoot(manifest) === record.merkle_root } });
}));

api.post('/evidence/:id/transfer', wrap(async (req, res) => {
    const target = auth.directory().find((u) => u.username === req.body.to_user);
    if (!target) throw badRequest(`unknown user '${req.body.to_user}'`);
    res.json(await fabric.submit(req.user, 'InitiateTransfer', [req.params.id, target.msp, target.username, req.body.reason || '', req.body.location || '']));
}));

async function closeTransfer(req, fn) {
    const rec = await fabric.evaluate(req.user, 'GetEvidence', req.params.id);
    if (!rec.pending_transfer) throw badRequest('no pending transfer');
    // D-038: the evidence key now requires BOTH agencies' peers
    const orgs = [...new Set([rec.pending_transfer.from_msp, rec.pending_transfer.to_msp])];
    const args = fn === 'CancelTransfer' ? [req.params.id, req.body.reason || '']
        : [req.params.id, JSON.stringify(req.body.seal_ids_observed || []), String(req.body.seal_intact === true || req.body.seal_intact === 'true'),
            req.body.reason || '', req.body.location || ''];
    return fabric.submit(req.user, fn, args, orgs);
}
api.post('/evidence/:id/accept', wrap(async (req, res) => res.json(await closeTransfer(req, 'AcceptTransfer'))));
api.post('/evidence/:id/reject', wrap(async (req, res) => res.json(await closeTransfer(req, 'RejectTransfer'))));
api.post('/evidence/:id/cancel', wrap(async (req, res) => res.json(await closeTransfer(req, 'CancelTransfer'))));

api.post('/evidence/:id/events', wrap(async (req, res) => {
    const { type, details, reason, location } = req.body;
    if (!type) throw badRequest('type is required');
    res.json(await fabric.submit(req.user, 'RecordEvent', [req.params.id, type, JSON.stringify(details || {}), reason || '', location || '']));
}));

api.post('/evidence/:id/verify', upload.single('file'), wrap(async (req, res) => {
    if (!req.file) throw badRequest('upload the file to verify as field "file"');
    const record = await fabric.evaluate(req.user, 'GetEvidence', req.params.id);
    const h = fp.hashBuffer(req.file.buffer);
    const manifest = loadManifest(record);
    const checks = { manifest_available: !!manifest };
    let match = null;
    if (manifest) {
        checks.manifest_sha256_matches_ledger = fp.manifestHash(manifest) === record.manifest_sha256;
        checks.merkle_root_matches_ledger = fp.manifestMerkleRoot(manifest) === record.merkle_root;
        match = manifest.artefacts.find((a) => a.sha256 === h.sha256 && a.sha3_256 === h.sha3_256) || null;
    }
    const intact = checks.manifest_available && checks.manifest_sha256_matches_ledger && checks.merkle_root_matches_ledger;
    const result = !intact ? 'INCONCLUSIVE' : match ? 'MATCH' : 'NO_MATCH';
    const verification = { method: 'sha256+sha3-256-recompute', method_version: '1', result, query_artefact_sha256: [h.sha256] };
    let event = null;
    if (req.body.record !== 'false') {
        event = await fabric.submit(req.user, 'RecordEvent', [req.params.id, 'VERIFY_INTEGRITY',
            JSON.stringify({ verification, matched_artefact_id: match ? match.artefact_id : null, file_name: req.file.originalname }),
            req.body.reason || `Integrity check of '${req.file.originalname}'`, req.body.location || '']);
    }
    res.json({ result, file: { name: req.file.originalname, ...h }, matched_artefact: match && { artefact_id: match.artefact_id, role: match.role, file_name: match.file_name, captured_at: match.captured_at },
        checks, ledger: { manifest_sha256: record.manifest_sha256, merkle_root: record.merkle_root }, event });
}));

api.get('/evidence/:id/artefacts/:aid', wrap(async (req, res) => {
    const reason = String(req.query.reason || '').trim();
    if (reason.length < 3) throw badRequest('a reason (?reason=...) is required to access evidence files');
    const record = await fabric.evaluate(req.user, 'GetEvidence', req.params.id);
    const manifest = loadManifest(record);
    if (!manifest || fp.manifestHash(manifest) !== record.manifest_sha256) throw Object.assign(new Error('manifest missing or does not match the ledger'), { status: 409 });
    const a = manifest.artefacts.find((x) => x.artefact_id === req.params.aid);
    if (!a) return res.status(404).json({ error: 'no such artefact' });
    const { buf } = store.get(a.sha256);   // decrypts and re-checks the content hash
    await fabric.submit(req.user, 'RecordEvent', [req.params.id, 'ACCESS', JSON.stringify({ artefact_id: a.artefact_id, sha256: a.sha256, purpose: 'download' }), reason, '']);
    res.setHeader('Content-Type', a.media_type);
    res.setHeader('Content-Disposition', `attachment; filename="${(a.file_name || a.artefact_id).replace(/"/g, '')}"`);
    res.setHeader('X-Evidence-SHA256', a.sha256);
    return res.send(buf);
}));

api.get('/evidence/:id/proof/:aid', wrap(async (req, res) => {
    const record = await fabric.evaluate(req.user, 'GetEvidence', req.params.id);
    const manifest = loadManifest(record);
    if (!manifest) return res.status(404).json({ error: 'manifest not in this evidence store' });
    const proof = fp.proofFor(manifest, req.params.aid);
    return res.json({ ...proof, ledger_merkle_root: record.merkle_root, matches_ledger: proof.merkle_root === record.merkle_root && proof.verifies });
}));

app.use('/api', api);

// Serve the built UI (frontend-v2/dist) when present, so the prototype runs on one port.
const UI = path.resolve(__dirname, '../../../frontend-v2/dist');
if (fs.existsSync(UI)) {
    app.use(express.static(UI));
    app.get(/^\/(?!api).*/, (req, res) => res.sendFile(path.join(UI, 'index.html')));
}

app.use((err, req, res, next) => {   // eslint-disable-line no-unused-vars
    const status = err.status || (err.code === 'LIMIT_FILE_SIZE' ? 413 : 500);
    if (status >= 500) console.error(err);
    res.status(status).json({ error: err.message, details: err.details });
});

if (require.main === module) {
    const server = app.listen(cfg.PORT, () => console.log(`CustodyChain API v2 on http://localhost:${cfg.PORT} (channel ${cfg.CHANNEL}, chaincode ${cfg.CHAINCODE})`));
    const stop = () => { server.close(); fabric.closeAll(); process.exit(0); };
    process.on('SIGINT', stop); process.on('SIGTERM', stop);
}

module.exports = app;
