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
const l2 = require('./l2');
const reports = require('./reports');

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
    const files = filesByField(req);
    // D-048: reference pHash of every image, computed by the same tool the report uses
    const fields = Object.keys(files);
    let phashByField = {};
    try {
        const ph = await l2.phashes(fields.map((k) => ({ buffer: files[k].buffer, media_type: files[k].mimetype, name: files[k].originalname })));
        phashByField = Object.fromEntries(fields.map((k, i) => [k, ph[i]]).filter(([, v]) => v));
    } catch (e) { console.warn(`identity fingerprints skipped: ${e.message}`); }
    const built = buildManifest({ draft, files, clientHashes, user: req.user,
        certSubject: fabric.certSubject(req.user), evidenceId, parentId, phashByField });
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


// ------------------------------------------------------------------ M6: identity check (L2), D-048
function ruleThreshold(rule) { const m = /hamming<=(\d+)/.exec(rule || ''); return m ? Number(m[1]) : l2.RULES['phash-dct-64'].threshold; }

api.post('/evidence/:id/identity-check', upload.any(), wrap(async (req, res) => {
    const record = await fabric.evaluate(req.user, 'GetEvidence', req.params.id);
    if (record.custodian.cn !== req.user.username) throw Object.assign(new Error('only the current custodian may run an identity check'), { status: 403 });
    const manifest = loadManifest(record);
    if (!manifest || fp.manifestHash(manifest) !== record.manifest_sha256) throw Object.assign(new Error('manifest missing or does not match the ledger'), { status: 409 });
    const queries = (req.files || []).map((f) => ({ buffer: f.buffer, name: f.originalname, media_type: f.mimetype, sha256: fp.hashBuffer(f.buffer).sha256 }));
    if (!queries.length) throw badRequest('upload the new captures to compare');
    const fps = manifest.identity_fingerprints || [];
    const byArt = Object.fromEntries(manifest.artefacts.map((a) => [a.artefact_id, a]));
    const phRefs = fps.filter((x) => x.method === 'phash-dct-64').map((x) => ({ art: byArt[x.source_artefact_ids[0]], value: x.value, threshold: ruleThreshold(x.match_rule) }));
    const meshRefs = fps.filter((x) => x.method === 'mesh-icp-rms').map((x) => byArt[x.source_artefact_ids[0]]);
    const qImages = queries.filter((q) => l2.isImage(q.media_type, q.name));
    const qMeshes = queries.filter((q) => l2.isMesh(q.media_type, q.name));
    const pairs = []; const notes = [];

    if (qImages.length) {
        const qph = await l2.phashes(qImages);
        const pageRefs = phRefs.filter((r) => r.art.role === 'page_scan').sort((a, b) => a.art.sequence - b.art.sequence);
        if (manifest.evidence_class === 'PHYSICAL_DOCUMENT' && pageRefs.length) {
            // documents: compare in page order; a different page count is itself a non-match
            if (qImages.length !== pageRefs.length) notes.push(`page count differs: ${qImages.length} new scan(s) vs ${pageRefs.length} reference page(s)`);
            qImages.forEach((q, i) => {
                const r = pageRefs[i];
                if (!r || !qph[i]) { pairs.push({ query: q.name, query_sha256: q.sha256, ref_artefact_id: r ? r.art.artefact_id : null, method: 'phash-dct-64', distance: null, threshold: r ? r.threshold : null, pass: false }); return; }
                const d = l2.hamming(qph[i], r.value);
                pairs.push({ query: q.name, query_sha256: q.sha256, ref_artefact_id: r.art.artefact_id, page: i + 1, method: 'phash-dct-64', distance: d, threshold: r.threshold, pass: d <= r.threshold });
            });
        } else {
            qImages.forEach((q, i) => {
                if (!phRefs.length || !qph[i]) { pairs.push({ query: q.name, query_sha256: q.sha256, ref_artefact_id: null, method: 'phash-dct-64', distance: null, pass: false }); return; }
                const best = phRefs.map((r) => ({ r, d: l2.hamming(qph[i], r.value) })).sort((a, b) => a.d - b.d)[0];
                pairs.push({ query: q.name, query_sha256: q.sha256, ref_artefact_id: best.r.art.artefact_id, method: 'phash-dct-64', distance: best.d, threshold: best.r.threshold, pass: best.d <= best.r.threshold });
            });
        }
    }
    if (qMeshes.length) {
        if (!meshRefs.length) notes.push('no reference 3D scan registered for this item');
        else {
            const ref = meshRefs[0];
            const refBuf = store.get(ref.sha256).buf;
            const r = await l2.withTempFiles([{ buffer: refBuf, name: 'ref.ply', mesh: true }, ...qMeshes.map((q) => ({ buffer: q.buffer, name: 'q.ply', mesh: true }))],
                (paths) => l2.runBatch(paths.slice(1).map((p) => ({ op: 'compare-mesh', ref: paths[0], query: p }))));
            qMeshes.forEach((q, i) => {
                const x = r.results[i];
                const rule = l2.RULES['mesh-icp-rms'];
                const pass = !!(x && x.ok && x.rms_mm <= rule.rms && x.max_mm <= rule.max);
                pairs.push({ query: q.name, query_sha256: q.sha256, ref_artefact_id: ref.artefact_id, method: 'mesh-icp-rms', rms_mm: x && x.rms_mm, max_mm: x && x.max_mm, threshold: rule.rule, pass });
            });
        }
    }
    const other = queries.length - qImages.length - qMeshes.length;
    if (other) notes.push(`${other} file(s) are neither images nor 3D scans and were not compared`);
    const compared = pairs.filter((p) => p.distance !== null || p.rms_mm !== undefined);
    const result = !compared.length ? 'INCONCLUSIVE' : (pairs.every((p) => p.pass) && !notes.some((n) => /page count/.test(n))) ? 'MATCH' : 'NO_MATCH';
    const methods = [...new Set(pairs.map((p) => p.method))];
    const worst = compared.filter((p) => p.method === 'phash-dct-64').reduce((m, p) => Math.max(m, p.distance), -1);
    const verification = { method: methods.join('+') || 'none', method_version: '1', result,
        score: worst >= 0 ? String(worst) : undefined, threshold: worst >= 0 ? String(l2.RULES['phash-dct-64'].threshold) : undefined,
        query_artefact_sha256: queries.map((q) => q.sha256) };
    for (const q of queries) store.put(q.buffer, { agency: req.user.org, media_type: q.media_type, uploaded_by: req.user.username, file_name: `identity-check/${q.name}` });
    const event = await fabric.submit(req.user, 'RecordEvent', [req.params.id, 'VERIFY_IDENTITY',
        JSON.stringify({ verification, pairs: pairs.map(({ query, ...p }) => ({ file: query, ...p })), notes, tool: 'evidence_hash.py l2-batch' }),
        req.body.reason || 'Identity check against the reference captures', req.body.location || '']);
    res.json({ result, pairs, notes, verification, event });
}));


// ------------------------------------------------------------------ M7: court outputs, D-049
async function courtInputs(req) {
    const [record, history] = await Promise.all([fabric.evaluate(req.user, 'GetEvidence', req.params.id), fabric.evaluate(req.user, 'GetHistory', req.params.id)]);
    const manifest = loadManifest(record);
    if (!manifest) throw Object.assign(new Error('manifest not in this evidence store'), { status: 404 });
    return { record, history, manifest };
}
const logAccess = (req, purpose) => fabric.submit(req.user, 'RecordEvent', [req.params.id, 'ACCESS', JSON.stringify({ purpose }), `Generated ${purpose}`, '']);

api.get('/evidence/:id/report', wrap(async (req, res) => {
    const x = await courtInputs(req);
    const html = reports.custodyReport({ ...x, generatedBy: req.user, generatedAt: new Date().toISOString() });
    await logAccess(req, 'custody report');
    res.type('html').send(html);
}));

api.get('/evidence/:id/bsa63', wrap(async (req, res) => {
    const part = req.query.part === 'B' ? 'B' : 'A';
    const x = await courtInputs(req);
    const certifier = part === 'B' ? (req.user.role === 'examiner' ? req.user : null) : (x.manifest.collection.collected_by.pki_subject && req.user.role === 'io' ? req.user : null);
    const html = reports.bsa63({ record: x.record, manifest: x.manifest, part, certifier });
    await logAccess(req, `BSA s.63 certificate draft, Part ${part}`);
    res.type('html').send(html);
}));

api.get('/evidence/:id/bundle', wrap(async (req, res) => {
    const x = await courtInputs(req);
    const ledger_record = { evidence_id: x.record.evidence_id, evidence_class: x.record.evidence_class, parent_evidence_id: x.record.parent_evidence_id,
        manifest_sha256: x.record.manifest_sha256, merkle_root: x.record.merkle_root, artefact_count: x.record.artefact_count, spec_version: x.record.spec_version };
    await logAccess(req, 'verification bundle');
    res.setHeader('Content-Disposition', `attachment; filename="${x.record.evidence_id}.bundle.json"`);
    res.json({ bundle_version: '1', generated_at: new Date().toISOString(), generated_by: { username: req.user.username, msp: req.user.msp },
        ledger_record, history: x.history, manifest: x.manifest,
        how_to_verify: ['Save "manifest" as manifest.json and "ledger_record" as ledger-record.json, and put the evidence files in a folder.',
            'Better: read the ledger record yourself from any agency peer (chaincode "evidence", GetEvidence) instead of trusting this bundle.',
            'python3 evidence_hash.py verify manifest.json --base <folder> --ledger ledger-record.json'] });
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
