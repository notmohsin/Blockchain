#!/usr/bin/env node
'use strict';
/*
 * Tamper suite (M8): attacks on stored data at rest and on the contract's inputs, against the live network.
 * Every attack must be detected or refused. Writes outputs/evaluation/tamper-suite.json.
 *   node scripts/tamper-suite.js
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const app = require('../src/server');
const fabric = require('../src/fabric');
const cfg = require('../src/config');
const { EvidenceStore } = require('../src/store');
const fp = require('../src/lib/fingerprint');

const WE = path.resolve(__dirname, '../../../../outputs/worked-example/files');
const OUT = path.resolve(__dirname, '../../../../outputs/evaluation');
const rows = [];
function row(attack, expected, observed, ok) { rows.push({ attack, expected, observed, detected: !!ok }); console.log(`  ${ok ? 'DETECTED' : 'MISSED  '}  ${attack}\n            -> ${observed}`); }
const sha = (b) => crypto.createHash('sha256').update(b).digest('hex');
const store = new EvidenceStore(cfg.STORE_DIR, cfg.KEY_DIR);
const blobPath = (h) => path.join(cfg.STORE_DIR, 'objects', h.slice(0, 2), `${h}.bin`);
let BASE;
async function call(token, method, url, body, isForm) {
    const headers = token ? { Authorization: `Bearer ${token}` } : {};
    if (body && !isForm) headers['Content-Type'] = 'application/json';
    const r = await fetch(BASE + url, { method, headers, body: body ? (isForm ? body : JSON.stringify(body)) : undefined });
    const ct = r.headers.get('content-type') || '';
    return { status: r.status, data: ct.includes('json') ? await r.json() : Buffer.from(await r.arrayBuffer()) };
}
const login = async (u) => (await call(null, 'POST', '/api/login', { username: u, password: 'custody-demo' })).data.token;

async function main() {
    const server = app.listen(0);
    BASE = `http://localhost:${server.address().port}`;
    const fir = `${(Date.now() % 900000) + 1000}/2026`;
    console.log(`Tamper suite (FIR ${fir})\n`);
    const io = await login('io.sharma'); const clerk = await login('clerk.rao');
    const photo = fs.readFileSync(path.join(WE, 'photo/IMG_0001.jpg'));
    const draft = { evidence_class: 'SCENE_PHOTOGRAPH', title: 'Tamper-suite photograph', case: { fir_number: fir, police_station: 'Cyber Crime Police Station Gandhinagar', district: 'Gandhinagar', state: 'Gujarat' },
        collection: { collected_at: '2026-11-19T10:42:05+05:30', location: { description: 'room 2' }, legal_basis: 'BNSS s.105 search and seizure' }, packaging: { container: 'none' },
        class_attributes: { photo_series_id: 'TS', frame_number: 1, view: 'overall', scale_present: true, subject: 'scene' },
        artefacts: [{ file_field: 'f', role: 'scene_photo', media_type: 'image/jpeg', captured_at: '2026-11-19T10:42:05+05:30', capture_device: { device_type: 'Mobile', make_model: 'phone' } }] };
    const fd = new FormData(); fd.append('f', new Blob([photo], { type: 'image/jpeg' }), 'IMG_0001.jpg');
    fd.append('draft', JSON.stringify(draft)); fd.append('client_hashes', JSON.stringify({ f: sha(photo) })); fd.append('reason', 'tamper-suite registration');
    const reg = await call(io, 'POST', '/api/evidence', fd, true);
    const id = reg.data.record.evidence_id; const rec = reg.data.record;
    const vf = (buf, name = 'x.jpg') => { const f = new FormData(); f.append('file', new Blob([buf]), name); return f; };

    // 1. ciphertext of an evidence file altered on disk
    const ap = blobPath(sha(photo)); const orig = fs.readFileSync(ap);
    const bad = Buffer.from(orig); bad[100] ^= 0x01; fs.writeFileSync(ap, bad);
    let r = await call(clerk, 'GET', `/api/evidence/${id}/artefacts/A001?reason=${encodeURIComponent('court copy')}`);
    row('One bit of a stored (encrypted) evidence file flipped on disk', 'download refused', `HTTP ${r.status}: ${(r.data.error || '').slice(0, 90)}`, r.status === 409);
    fs.writeFileSync(ap, orig);

    // 2. stored manifest corrupted
    const mp = blobPath(rec.manifest_sha256); const morig = fs.readFileSync(mp);
    const mbad = Buffer.from(morig); mbad[10] ^= 0x01; fs.writeFileSync(mp, mbad);
    r = await call(clerk, 'POST', `/api/evidence/${id}/verify`, vf(photo), true);
    row('Stored manifest corrupted on disk', 'verification INCONCLUSIVE (never MATCH); store error reported', `${r.data.result}; ${(r.data.checks && r.data.checks.store_error || '').slice(0, 70)}`, r.data.result === 'INCONCLUSIVE' && r.data.checks.store_error);
    fs.writeFileSync(mp, morig);

    // 3. insider writes a forged manifest (accepting a doctored photo) into the store
    const forgedPhoto = fs.readFileSync(path.join(WE, 'photo/IMG_0001_knife_removed.jpg'));
    const m = (await call(clerk, 'GET', `/api/evidence/${id}/manifest`)).data.manifest;
    const forged = JSON.parse(JSON.stringify(m));
    Object.assign(forged.artefacts[0], fp.hashBuffer(forgedPhoto));
    forged.integrity.merkle_root = fp.manifestMerkleRoot(forged);
    store.put(fp.jcs(forged), { agency: 'police', media_type: 'application/json', uploaded_by: 'insider' });
    store.put(forgedPhoto, { agency: 'police', media_type: 'image/jpeg', uploaded_by: 'insider' });
    r = await call(clerk, 'POST', `/api/evidence/${id}/verify`, vf(forgedPhoto), true);
    row('Insider stores a doctored photo plus a self-consistent forged manifest', 'NO_MATCH: the ledger still points to the original manifest', `${r.data.result} (ledger manifest ${rec.manifest_sha256.slice(0, 12)}…, forged ${fp.manifestHash(forged).slice(0, 12)}…)`, r.data.result === 'NO_MATCH');

    // 4. identity without a role (cryptogen User1, valid Police certificate)
    const noRole = { username: 'User1', org: 'police' };
    let err = null;
    try { await fabric.submit(noRole, 'RecordEvent', [id, 'ACCESS', '{}', 'peek without role', '']); } catch (e) { err = e.message; }
    row('Valid agency certificate without a CustodyChain role writes to the ledger', 'rejected by the chaincode', err || 'ACCEPTED', /no CustodyChain role/.test(err || ''));

    // 5. actor / time forged in the arguments
    const IO = { username: 'io.sharma', org: 'police' };
    const fakeRec = { ...rec, evidence_id: rec.evidence_id.replace(/E\d{3}$/, 'E900'), custodian: { msp: 'CourtMSP', cn: 'clerk.rao', role: 'court_clerk' }, registered_at: '2001-01-01T00:00:00Z', registered_by: { cn: 'someone.else' } };
    const out = await fabric.submit(IO, 'RegisterEvidence', [JSON.stringify(fakeRec), 'forged actor/time in arguments', '']);
    row('Caller puts a different custodian, registrant and date in the arguments', 'ignored: actor from certificate, time from transaction',
        `custodian ${out.custodian.cn}@${out.custodian.msp}, registered_at ${out.registered_at}`, out.custodian.cn === 'io.sharma' && out.registered_at.startsWith('2026') && out.registered_by.cn === 'io.sharma');

    // 6. replay of a registration
    err = null;
    try { await fabric.submit(IO, 'RegisterEvidence', [JSON.stringify(fakeRec), 'replay', '']); } catch (e) { err = e.message; }
    row('Replay of the same registration', 'rejected (already exists)', err || 'ACCEPTED', /already exists/.test(err || ''));

    // 7. hand-over endorsed by a majority that excludes the sender's agency (D-038)
    await fabric.submit(IO, 'InitiateTransfer', [id, 'FSLMSP', 'examiner.mehta', 'tamper-suite transfer', '']);
    err = null;
    try { await fabric.submit({ username: 'examiner.mehta', org: 'fsl' }, 'AcceptTransfer', [id, '[]', 'true', 'accept without Police', ''], ['FSLMSP', 'CourtMSP']); } catch (e) { err = e.message; }
    row('Receiver completes a Police->FSL hand-over with FSL+Court endorsements only', 'rejected at validation (key-level policy)', (err || 'COMMITTED').slice(0, 100), /ENDORSEMENT_POLICY_FAILURE/.test(err || ''));
    await fabric.submit(IO, 'CancelTransfer', [id, 'tamper-suite cleanup'], ['PoliceMSP', 'FSLMSP']);

    // 8. a non-custodian (same agency) tries a custody action
    err = null;
    try { await fabric.submit({ username: 'malkhana.desai', org: 'police' }, 'RecordEvent', [id, 'DISPOSE', '{"court_order_ref":"fake"}', 'dispose it', '']); } catch (e) { err = e.message; }
    row('Same-agency colleague (not custodian) disposes of the item', 'rejected (custodian only)', err || 'ACCEPTED', /custodian/.test(err || ''));

    // 9. upload altered in transit
    const fd2 = new FormData(); fd2.append('f', new Blob([photo]), 'IMG_0001.jpg');
    fd2.append('draft', JSON.stringify(draft)); fd2.append('client_hashes', JSON.stringify({ f: sha(forgedPhoto) })); fd2.append('reason', 'transit tamper');
    r = await call(io, 'POST', '/api/evidence', fd2, true);
    row('File altered between the officer\'s browser and the gateway', 'rejected before anything is stored or anchored', `HTTP ${r.status}: ${(r.data.error || '').slice(0, 70)}`, r.status === 400 && /changed in transit/.test(r.data.error));

    server.close(); fabric.closeAll();
    fs.mkdirSync(OUT, { recursive: true });
    fs.writeFileSync(path.join(OUT, 'tamper-suite.json'), JSON.stringify({ date: new Date().toISOString(), evidence_id: id, rows }, null, 2) + '\n');
    const missed = rows.filter((x) => !x.detected).length;
    console.log(`\n${rows.length - missed}/${rows.length} attacks detected or refused`);
    process.exit(missed ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(2); });
