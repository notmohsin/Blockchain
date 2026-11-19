#!/usr/bin/env node
'use strict';
/*
 * End-to-end acceptance scenario (ROADMAP §2) against the live BFT network, through the v2 API only.
 * Starts the API in-process on a free port. Each run uses a fresh FIR number, so it can be repeated.
 *   node scripts/e2e.js            (network-bft must be up with `./network.sh all`)
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const app = require('../src/server');
const fabric = require('../src/fabric');

const WE = path.resolve(__dirname, '../../../../outputs/worked-example/files');
const results = [];
const check = (ok, what, extra) => { results.push({ ok: !!ok, what }); console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${what}${extra ? `  (${extra})` : ''}`); return ok; };
const sha = (b) => crypto.createHash('sha256').update(b).digest('hex');
function file(rel, fallbackSeed) {
    const p = path.join(WE, rel);
    return fs.existsSync(p) ? fs.readFileSync(p) : crypto.createHash('sha512').update(fallbackSeed).digest();
}

let BASE;
async function call(token, method, url, body, isForm) {
    const headers = token ? { Authorization: `Bearer ${token}` } : {};
    if (body && !isForm) headers['Content-Type'] = 'application/json';
    const r = await fetch(BASE + url, { method, headers, body: body ? (isForm ? body : JSON.stringify(body)) : undefined });
    const ct = r.headers.get('content-type') || '';
    const data = ct.includes('application/json') ? await r.json() : Buffer.from(await r.arrayBuffer());
    return { status: r.status, data, headers: r.headers };
}
async function login(u) { const r = await call(null, 'POST', '/api/login', { username: u, password: 'custody-demo' }); return r.data.token; }

function form(draft, files, { reason = 'Seized under BNSS s.105', location = 'Plot 14, GIDC, Gandhinagar', badHash = false } = {}) {
    const fd = new FormData();
    const hashes = {};
    files.forEach(([field, name, type, buf]) => {
        fd.append(field, new Blob([buf], { type }), name);
        hashes[field] = badHash ? '0'.repeat(64) : sha(buf);
    });
    fd.append('draft', JSON.stringify(draft));
    fd.append('client_hashes', JSON.stringify(hashes));
    fd.append('reason', reason);
    fd.append('location', location);
    return fd;
}

const PHONE = { device_type: 'Mobile', make_model: 'Departmental smartphone (ICJS spec)', serial_number: 'R58N91XKQ2', imei_uin_uid_mac_cloud_id: 'IMEI 356938035643809' };
const SCANNER = { device_type: 'Flatbed Scanner', make_model: 'A4 flatbed 600 dpi', serial_number: 'FBS-0091' };

async function main() {
    const server = app.listen(0);
    BASE = `http://localhost:${server.address().port}`;
    const fir = `${(Date.now() % 900000) + 1000}/2026`;
    const ps = 'Cyber Crime Police Station Gandhinagar';
    const CASE = { fir_number: fir, police_station: ps, district: 'Gandhinagar', state: 'Gujarat', sections_invoked: ['BNS s.318(4)'] };
    const COLL = (when) => ({ collected_at: when, location: { description: 'Office premises, room 2', address: 'Plot 14, GIDC, Gandhinagar', latitude: '23.2156', longitude: '72.6369', position_source: 'GNSS' },
        legal_basis: 'BNSS s.105 search and seizure', witnesses: [{ name: 'R. Patel', role: 'Independent Witness', address: 'Sector 21, Gandhinagar' }] });
    console.log(`CustodyChain v2 end-to-end scenario: FIR ${fir}, ${ps}\n`);

    const io = await login('io.sharma'); const ex = await login('examiner.mehta');
    const clerk = await login('clerk.rao'); const mal = await login('malkhana.desai');
    check(io && ex && clerk && mal, 'all four role users log in');
    const bad = await call(null, 'POST', '/api/login', { username: 'io.sharma', password: 'nope' });
    check(bad.status === 401, 'wrong password is refused');
    const me = await call(ex, 'GET', '/api/me');
    check(me.data.ledger_identity.role === 'examiner' && me.data.ledger_identity.msp === 'FSLMSP', 'ledger sees examiner.mehta as FSLMSP / role=examiner (from the certificate)');

    // 1. register a scene photograph
    const photo = file('photo/IMG_0001.jpg', 'photo');
    const photoDraft = { evidence_class: 'SCENE_PHOTOGRAPH', title: 'Scene photograph: overall view of room 2', case: CASE,
        collection: COLL('2026-11-19T10:42:05+05:30'), packaging: { container: 'none (born-digital)' },
        class_attributes: { photo_series_id: `SOC-${fir}`, frame_number: 1, view: 'overall', scale_present: true, subject: 'Knife near stain (marker 1)', original_format: 'JPEG' },
        artefacts: [{ file_field: 'f1', role: 'scene_photo', media_type: 'image/jpeg', captured_at: '2026-11-19T10:42:05+05:30', capture_device: PHONE }] };
    let r = await call(io, 'POST', '/api/evidence', form(photoDraft, [['f1', 'IMG_0001.jpg', 'image/jpeg', photo]]), true);
    const photoId = r.data.record && r.data.record.evidence_id;
    check(r.status === 201 && photoId, `IO registers the scene photograph -> ${photoId}`, r.status !== 201 ? JSON.stringify(r.data) : `manifest ${r.data.record && r.data.record.manifest_sha256.slice(0, 12)}...`);

    // 2. register the notebook (cover + 6 pages), sealed
    const nbFiles = [['cover', 'cover.jpg', 'image/jpeg', file('notebook/cover.jpg', 'cover')]];
    for (let p = 1; p <= 6; p++) nbFiles.push([`p${p}`, `page_00${p}.png`, 'image/png', file(`notebook/page_00${p}.png`, `page${p}`)]);
    const nbDraft = { evidence_class: 'PHYSICAL_DOCUMENT', title: "Spiral notebook 'ACCOUNTS 2026' from desk drawer", case: CASE,
        collection: COLL('2026-11-19T11:18:00+05:30'),
        packaging: { container: 'tamper-evident evidence bag', seal_ids: ['TEB-GJ-0007741'], label_id: 'QR-E-NOTEBOOK' },
        class_attributes: { document_type: 'spiral notebook', page_count: 6, leaf_count: 3, dimensions_mm: { width: '105', height: '148' }, binding: 'metal spiral',
            distinguishing_features: ['ring stain on cover', 'corner of page 3 torn'], scan_dpi: 300, scan_colour_mode: 'GRAY-8', scan_file_format: 'PNG' },
        artefacts: nbFiles.map(([f], i) => ({ file_field: f, role: i === 0 ? 'cover_photo' : 'page_scan', captured_at: '2026-11-19T15:10:00+05:30', capture_device: i === 0 ? PHONE : SCANNER })) };
    r = await call(io, 'POST', '/api/evidence', form(nbDraft, nbFiles), true);
    const nbId = r.data.record && r.data.record.evidence_id;
    check(r.status === 201 && nbId, `IO registers the notebook (7 artefacts) -> ${nbId}`, r.status !== 201 ? JSON.stringify(r.data) : '');

    // negative cases at registration
    r = await call(io, 'POST', '/api/evidence', form(photoDraft, [['f1', 'IMG_0001.jpg', 'image/jpeg', photo]], { badHash: true }), true);
    check(r.status === 400 && /changed in transit/.test(r.data.error), 'upload whose browser hash differs from the received bytes is rejected');
    r = await call(io, 'POST', '/api/evidence', form({ ...photoDraft, class_attributes: { frame_number: 1 } }, [['f1', 'x.jpg', 'image/jpeg', photo]]), true);
    check(r.status === 400 && (r.data.details || []).length > 0, 'manifest violating the input specification is rejected', (r.data.details || [])[0]);
    r = await call(ex, 'POST', '/api/evidence', form(photoDraft, [['f1', 'IMG_0001.jpg', 'image/jpeg', photo]]), true);
    check(r.status === 403, 'an FSL examiner cannot register new evidence');

    // 2b. D-038 attack: the receiver tries to complete a Police->FSL handover with FSL + Court endorsements only.
    //     That satisfies the channel's 2-of-3 majority, but not the key-level policy (Police AND FSL).
    r = await call(io, 'POST', `/api/evidence/${photoId}/transfer`, { to_user: 'examiner.mehta', reason: 'Photograph for image analysis' });
    let attack = null;
    try {
        await fabric.submit({ username: 'examiner.mehta', org: 'fsl' }, 'AcceptTransfer', [photoId, '[]', 'true', 'accept without Police', ''], ['FSLMSP', 'CourtMSP']);
    } catch (e) { attack = e; }
    check(attack && /ENDORSEMENT_POLICY_FAILURE/.test(attack.message), 'accepting with FSL+Court endorsements (majority, but not Police) is rejected by the ledger', attack ? attack.message.slice(0, 90) : 'it committed!');
    r = await call(io, 'GET', `/api/evidence/${photoId}`);
    check(r.data.record.custodian.cn === 'io.sharma' && r.data.record.status === 'IN_TRANSFER', 'custody did not change after the rejected attempt');
    r = await call(io, 'POST', `/api/evidence/${photoId}/cancel`, { reason: 'Image analysis not needed' });
    check(r.status === 200 && r.data.status === 'IN_CUSTODY', 'IO cancels the transfer (endorsed by Police and FSL)', r.status !== 200 ? r.data.error : '');

    // 3. transfer notebook Police -> FSL (two-phase, both agencies endorse)
    r = await call(io, 'POST', `/api/evidence/${nbId}/transfer`, { to_user: 'examiner.mehta', reason: 'Forwarded to FSL for questioned-document examination, letter CPS/FSL/412/2026' });
    check(r.status === 200 && r.data.status === 'IN_TRANSFER', 'IO initiates transfer of the notebook to examiner.mehta', r.status !== 200 ? r.data.error : '');
    r = await call(clerk, 'POST', `/api/evidence/${nbId}/accept`, { seal_ids_observed: ['TEB-GJ-0007741'], seal_intact: true, reason: 'not mine to accept' });
    check(r.status === 400 && /named receiver/.test(r.data.error), 'a court clerk cannot accept a transfer addressed to the FSL examiner', r.data.error);
    r = await call(ex, 'GET', '/api/inbox');
    check(r.data.some((e) => e.evidence_id === nbId), "the notebook appears in the examiner's inbox");
    r = await call(ex, 'POST', `/api/evidence/${nbId}/accept`, { seal_ids_observed: ['TEB-GJ-0007741'], seal_intact: true, reason: 'Received at FSL evidence counter', location: 'FSL Gandhinagar' });
    check(r.status === 200 && r.data.custodian.cn === 'examiner.mehta', 'examiner accepts; custody moves to FSL', r.status !== 200 ? r.data.error : '');

    // 4. FSL: identity check, examination
    r = await call(ex, 'POST', `/api/evidence/${nbId}/events`, { type: 'VERIFY_IDENTITY', reason: 'Identity check on receipt: pages re-scanned and compared with reference scans',
        details: { verification: { method: 'phash-dct-64', method_version: '1', result: 'MATCH', score: '4', threshold: '10', query_artefact_sha256: [sha(file('notebook/fsl_rescan/page_001.png', 'r1'))] } } });
    check(r.status === 200, 'examiner records VERIFY_IDENTITY = MATCH', r.status !== 200 ? r.data.error : '');
    r = await call(mal, 'POST', `/api/evidence/${nbId}/events`, { type: 'SEAL', reason: 'reseal', details: { seal_ids: ['X'] } });
    check(r.status === 400 && /custodian/.test(r.data.error), 'a Police user who is not the custodian cannot record custody actions', r.data.error);
    r = await call(ex, 'POST', `/api/evidence/${nbId}/events`, { type: 'EXAMINE_START', reason: 'Questioned-document examination begins' });
    check(r.status === 200, 'EXAMINE_START');
    const report = Buffer.from(`FSL report on ${nbId}: entries on pages 2-5 consistent with a single writer.`);
    r = await call(ex, 'POST', `/api/evidence/${nbId}/events`, { type: 'EXAMINE_END', reason: 'Examination complete, report FSL/QD/2026/913', details: { attachments_sha256: [sha(report)] } });
    check(r.status === 200, 'EXAMINE_END with the report hash attached');
    r = await call(ex, 'POST', `/api/evidence/${nbId}/events`, { type: 'RESEAL', reason: 'Resealed after examination', details: { seal_ids: ['FSL-GNR-55120'] } });
    check(r.status === 200, 'examiner reseals with FSL seal FSL-GNR-55120');

    // 5. FSL -> Police (malkhana), then Police -> Court
    r = await call(ex, 'POST', `/api/evidence/${nbId}/transfer`, { to_user: 'malkhana.desai', reason: 'Returned after examination' });
    r = await call(mal, 'POST', `/api/evidence/${nbId}/accept`, { seal_ids_observed: ['FSL-GNR-55120'], seal_intact: true, reason: 'Received into malkhana' });
    check(r.status === 200 && r.data.custodian.cn === 'malkhana.desai', 'returned to Police malkhana (seal checked)', r.status !== 200 ? r.data.error : '');
    for (const [id, tok, who] of [[nbId, mal, 'malkhana'], [photoId, io, 'IO']]) {
        r = await call(tok, 'POST', `/api/evidence/${id}/transfer`, { to_user: 'clerk.rao', reason: 'Produced before CJM Gandhinagar with charge-sheet' });
        const a = await call(clerk, 'POST', `/api/evidence/${id}/accept`, { seal_ids_observed: id === nbId ? ['FSL-GNR-55120'] : [], seal_intact: true, reason: 'Received in court property room' });
        check(r.status === 200 && a.status === 200 && a.data.custodian.cn === 'clerk.rao', `${who} -> court clerk: ${id}`, a.status !== 200 ? a.data.error : '');
    }
    r = await call(clerk, 'POST', `/api/evidence/${nbId}/events`, { type: 'SUBMIT_COURT', reason: 'Marked as Article 4 in the trial', details: { court: 'CJM Gandhinagar', exhibit: 'Article 4' } });
    check(r.status === 200, 'court clerk records SUBMIT_COURT');

    // 6. court verifies files against the ledger
    const fdOk = new FormData(); fdOk.append('file', new Blob([photo]), 'IMG_0001.jpg');
    r = await call(clerk, 'POST', `/api/evidence/${photoId}/verify`, fdOk, true);
    check(r.data.result === 'MATCH' && r.data.matched_artefact.artefact_id === 'A001', 'court verifies the produced photograph: MATCH (A001), recorded on the ledger', r.data.result);
    const tampered = file('photo/IMG_0001_knife_removed.jpg', 'tampered');
    const fdBad = new FormData(); fdBad.append('file', new Blob([tampered]), 'IMG_0001.jpg');
    r = await call(clerk, 'POST', `/api/evidence/${photoId}/verify`, fdBad, true);
    check(r.data.result === 'NO_MATCH', 'a tampered copy of the photograph: NO_MATCH', r.data.result);
    const p4 = file('notebook/page_004.png', 'page4');
    const fd4 = new FormData(); fd4.append('file', new Blob([p4]), 'page_004.png');
    r = await call(clerk, 'POST', `/api/evidence/${nbId}/verify`, fd4, true);
    check(r.data.result === 'MATCH' && r.data.matched_artefact.artefact_id === 'A005', 'court verifies notebook page 4: MATCH (A005)', `${r.data.result} ${r.data.matched_artefact && r.data.matched_artefact.artefact_id}`);

    // 7. download (decrypted, re-hashed, logged) and inclusion proof
    r = await call(clerk, 'GET', `/api/evidence/${nbId}/artefacts/A005`);
    check(r.status === 400, 'download without a reason is refused');
    r = await call(clerk, 'GET', `/api/evidence/${nbId}/artefacts/A005?reason=${encodeURIComponent('Copy for defence counsel under court order')}`);
    check(r.status === 200 && sha(r.data) === sha(p4), 'download returns the exact original bytes (and is logged as ACCESS)');
    r = await call(clerk, 'GET', `/api/evidence/${nbId}/proof/A005`);
    check(r.data.verifies && r.data.matches_ledger, `inclusion proof for page 4 verifies against the ledger Merkle root (${r.data.audit_path && r.data.audit_path.length} hashes)`);
    r = await call(clerk, 'GET', `/api/evidence/${nbId}/manifest`);
    check(r.data.checks.manifest_sha256_matches_ledger && r.data.checks.merkle_root_matches_ledger, 'stored manifest matches the ledger fingerprints');

    // 8. history: actors come from certificates; order is the custody story
    r = await call(io, 'GET', `/api/evidence/${nbId}`);
    const types = r.data.history.map((e) => e.type);
    const expect = ['REGISTER', 'TRANSFER_INITIATE', 'TRANSFER_ACCEPT', 'VERIFY_IDENTITY', 'EXAMINE_START', 'EXAMINE_END', 'RESEAL',
        'TRANSFER_INITIATE', 'TRANSFER_ACCEPT', 'TRANSFER_INITIATE', 'TRANSFER_ACCEPT', 'SUBMIT_COURT', 'VERIFY_INTEGRITY', 'ACCESS'];
    check(JSON.stringify(types) === JSON.stringify(expect), `notebook history has the full custody chain (${types.length} events)`, types.join(' > '));
    const actors = [...new Set(r.data.history.map((e) => `${e.actor.cn}/${e.actor.msp}/${e.actor.role}`))];
    check(actors.length === 4, `actors taken from certificates: ${actors.join(', ')}`);
    const acc = r.data.history.find((e) => e.type === 'TRANSFER_ACCEPT');
    check(acc.details.seal_intact === true && acc.details.seals_match === true, 'first receipt records seal TEB-GJ-0007741 intact and matching');

    server.close(); fabric.closeAll();
    const failed = results.filter((x) => !x.ok).length;
    console.log(`\n${results.length - failed}/${results.length} checks passed${failed ? `, ${failed} FAILED` : ''}`);
    process.exit(failed ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(2); });
