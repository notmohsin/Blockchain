'use strict';
/*
 * Builds an evidence manifest (outputs/spec/evidence-manifest.schema.json) from a client draft plus uploaded files.
 *  - every file is hashed here (SHA-256 + SHA3-256); a browser-supplied SHA-256 must match (D-040)
 *  - the collecting officer is taken from the logged-in user, not from the draft
 *  - salts are random per artefact; integrity block = salted RFC 6962 Merkle root (D-018)
 *  - the result is validated against the JSON Schema before anything is stored or written to the ledger
 */
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const Ajv2020 = require('ajv/dist/2020');
const cfg = require('./config');
const fp = require('./lib/fingerprint');

let validators = null;
function schemas() {
    if (!validators) {
        const ajv = new Ajv2020({ allErrors: true, strict: false });
        const m = JSON.parse(fs.readFileSync(path.join(cfg.SPEC_DIR, 'evidence-manifest.schema.json'), 'utf8'));
        const e = JSON.parse(fs.readFileSync(path.join(cfg.SPEC_DIR, 'custody-event.schema.json'), 'utf8'));
        validators = { manifest: ajv.compile(m), event: ajv.compile(e) };
    }
    return validators;
}

function schemaErrors(v) {
    return (v.errors || []).map((e) => `${e.instancePath || '(manifest)'} ${e.message}${e.params && e.params.allowedValues ? `: ${e.params.allowedValues.join(', ')}` : ''}${e.params && e.params.missingProperty ? ` (${e.params.missingProperty})` : ''}`);
}

function badRequest(msg, details) { return Object.assign(new Error(msg), { status: 400, details }); }

function nowIst() {
    const d = new Date(Date.now() + 5.5 * 3600e3);
    return d.toISOString().replace(/\.\d{3}Z$/, '+05:30');
}

/**
 * @param draft      manifest draft from the client; artefacts[] carry `file_field` instead of hashes
 * @param files      { fieldname: { buffer, originalname, mimetype } }
 * @param clientHashes { fieldname: sha256 } computed by the browser (optional per file, verified when present)
 * @param user       logged-in user (public profile) + certSubject
 * @param evidenceId assigned ID; parentId for derived items
 */
function buildManifest({ draft, files, clientHashes, user, certSubject, evidenceId, parentId }) {
    if (!draft || typeof draft !== 'object') throw badRequest('draft manifest is required');
    const m = JSON.parse(JSON.stringify(draft));
    m.spec_version = '1.0';
    m.evidence_id = evidenceId;
    m.parent_evidence_id = parentId || null;
    m.collection = m.collection || {};
    m.collection.collected_by = { name: user.name, role: user.role_label, designation: user.designation,
        badge_or_employee_id: user.badge, organisation: user.org_name, pki_subject: certSubject };
    if (!Array.isArray(m.artefacts) || m.artefacts.length === 0) throw badRequest('at least one artefact (file) is required');
    const hashedAt = nowIst();
    const used = new Set();
    const blobs = [];
    m.artefacts.forEach((a, i) => {
        const f = files[a.file_field];
        if (!f) throw badRequest(`artefact ${i + 1}: no uploaded file for field '${a.file_field}'`);
        if (used.has(a.file_field)) throw badRequest(`file '${a.file_field}' is referenced twice`);
        used.add(a.file_field);
        const h = fp.hashBuffer(f.buffer);
        const claimed = clientHashes && clientHashes[a.file_field];
        if (claimed && claimed.toLowerCase() !== h.sha256) {
            throw badRequest(`file '${f.originalname}' changed in transit: browser SHA-256 ${claimed} but gateway computed ${h.sha256}`);
        }
        a.artefact_id = a.artefact_id || `A${String(i + 1).padStart(3, '0')}`;
        a.sequence = a.sequence || i + 1;
        a.file_name = f.originalname;
        a.media_type = a.media_type || f.mimetype || 'application/octet-stream';
        Object.assign(a, h);
        a.hashed_at = hashedAt;
        a.hashed_on = claimed ? 'browser before upload; re-verified by gateway' : 'gateway on receipt';
        a.leaf_salt = crypto.randomBytes(32).toString('hex');
        delete a.file_field;
        blobs.push({ buffer: f.buffer, media_type: a.media_type, file_name: f.originalname });
    });
    if (m.packaging && Array.isArray(m.packaging.seal_ids) && m.packaging.seal_ids.length) {
        m.identity_fingerprints = m.identity_fingerprints || [];
        for (const sid of m.packaging.seal_ids) {
            m.identity_fingerprints.push({ method: 'seal-id-exact', method_version: '1', source_artefact_ids: [m.artefacts[0].artefact_id], value: String(sid), match_rule: 'exact' });
        }
    }
    m.integrity = { hash_algorithms: ['SHA-256', 'SHA3-256'], merkle_scheme: 'RFC6962-SHA256-salted-v1',
        merkle_root: fp.manifestMerkleRoot(m), canonicalisation: 'RFC8785-JCS' };
    const v = schemas().manifest;
    if (!v(m)) throw badRequest('manifest does not satisfy the input specification', schemaErrors(v));
    const canonical = fp.jcs(m);
    return { manifest: m, canonical, manifestSha256: fp.sha256(canonical).toString('hex'), blobs };
}

function ledgerRecord(m, manifestSha256) {
    return { evidence_id: m.evidence_id, evidence_class: m.evidence_class, title: m.title,
        case: { fir_number: m.case.fir_number, police_station: m.case.police_station },
        manifest_sha256: manifestSha256, merkle_root: m.integrity.merkle_root, artefact_count: m.artefacts.length,
        spec_version: m.spec_version, seal_ids: (m.packaging && m.packaging.seal_ids) || [] };
}

function validateEvent(ev) {
    const v = schemas().event;
    return v(ev) ? [] : schemaErrors(v);
}

module.exports = { buildManifest, ledgerRecord, validateEvent, badRequest };
