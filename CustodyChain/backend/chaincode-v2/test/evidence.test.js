'use strict';
const { expect } = require('chai');
const EvidenceContract = require('../lib/evidence');
const { FakeLedger, identity, tx } = require('./fakestub');

const IO = identity('PoliceMSP', 'io.sharma', 'io');
const MALKHANA = identity('PoliceMSP', 'malkhana.desai', 'malkhana');
const EXAMINER = identity('FSLMSP', 'examiner.mehta', 'examiner');
const CLERK = identity('CourtMSP', 'clerk.rao', 'court_clerk');
const NOROLE = identity('PoliceMSP', 'Admin@police', undefined);

const H = (c) => c.repeat(64);
function record(id = 'GJ-GNR-CYBPS-2026-000123-E004', extra = {}) {
    return JSON.stringify({ evidence_id: id, evidence_class: 'PHYSICAL_DOCUMENT', title: 'Notebook ACCOUNTS 2026',
        case: { fir_number: '123/2026', police_station: 'Cyber PS Gandhinagar' }, manifest_sha256: H('a'),
        merkle_root: H('b'), artefact_count: 8, spec_version: '1.0', seal_ids: ['TEB-1'], ...extra });
}
async function rejects(p, msg) {
    let err = null;
    try { await p; } catch (e) { err = e; }
    expect(err, 'expected the transaction to be rejected').to.not.equal(null);
    if (msg) { expect(err.message).to.match(msg); }
}

describe('EvidenceContract', () => {
    let L; let C;
    const ID = 'GJ-GNR-CYBPS-2026-000123-E004';
    beforeEach(async () => {
        L = new FakeLedger(); C = new EvidenceContract();
        await tx(L, C, IO, 'RegisterEvidence', record(), 'Seized under BNSS s.105', 'Gandhinagar');
    });

    describe('registration', () => {
        it('stores fingerprints, custodian from the certificate, and a REGISTER event', async () => {
            const { out } = await tx(L, C, IO, 'GetEvidence', ID);
            expect(out.manifest_sha256).to.equal(H('a'));
            expect(out.custodian).to.include({ msp: 'PoliceMSP', cn: 'io.sharma', role: 'io' });
            expect(out.status).to.equal('IN_CUSTODY');
            const { out: h } = await tx(L, C, IO, 'GetHistory', ID);
            expect(h.map((e) => e.type)).to.deep.equal(['REGISTER']);
            expect(h[0].actor.cn).to.equal('io.sharma');
            expect(h[0].timestamp).to.match(/^2026-11-19T/);
        });
        it('sets a key-level policy for the custodian agency', async () => {
            const k = Object.values(L.vparams);
            expect(L.vparams.size).to.equal(1);
            expect(k).to.be.an('array');
        });
        it('rejects duplicates, bad hashes, bad IDs, and non-IO roles', async () => {
            await rejects(tx(L, C, IO, 'RegisterEvidence', record(), 'again', ''), /already exists/);
            await rejects(tx(L, C, IO, 'RegisterEvidence', record('GJ-GNR-CYBPS-2026-000123-E005', { manifest_sha256: 'xyz' }), 'r1', ''), /manifest_sha256/);
            await rejects(tx(L, C, IO, 'RegisterEvidence', record('BAD-ID'), 'r1', ''), /evidence_id/);
            await rejects(tx(L, C, EXAMINER, 'RegisterEvidence', record('GJ-GNR-CYBPS-2026-000123-E006'), 'r1', ''), /role 'examiner'/);
            await rejects(tx(L, C, NOROLE, 'RegisterEvidence', record('GJ-GNR-CYBPS-2026-000123-E007'), 'r1', ''), /no CustodyChain role/);
            await rejects(tx(L, C, IO, 'RegisterEvidence', record('GJ-GNR-CYBPS-2026-000123-E008', { case: { fir_number: '12-2026', police_station: 'x' } }), 'r1', ''), /fir_number/);
        });
        it('requires a reason', async () => {
            await rejects(tx(L, C, IO, 'RegisterEvidence', record('GJ-GNR-CYBPS-2026-000123-E009'), '', ''), /reason/);
        });
    });

    describe('two-phase transfer', () => {
        it('moves custody only when the named receiver accepts, and records the seal reading', async () => {
            await tx(L, C, IO, 'InitiateTransfer', ID, 'FSLMSP', 'examiner.mehta', 'FSL request 412/2026', '');
            let { out } = await tx(L, C, IO, 'GetEvidence', ID);
            expect(out.status).to.equal('IN_TRANSFER');
            expect(out.custodian.cn).to.equal('io.sharma');
            const { out: pend } = await tx(L, C, EXAMINER, 'QueryPendingFor', 'FSLMSP');
            expect(pend.map((e) => e.evidence_id)).to.deep.equal([ID]);
            await tx(L, C, EXAMINER, 'AcceptTransfer', ID, '["TEB-1"]', 'true', 'Received at FSL counter', 'FSL');
            ({ out } = await tx(L, C, IO, 'GetEvidence', ID));
            expect(out.custodian).to.include({ msp: 'FSLMSP', cn: 'examiner.mehta' });
            expect(out.status).to.equal('IN_CUSTODY');
            const { out: h } = await tx(L, C, IO, 'GetHistory', ID);
            const acc = h.find((e) => e.type === 'TRANSFER_ACCEPT');
            expect(acc.details).to.include({ seal_intact: true, seals_match: true });
            const { out: pend2 } = await tx(L, C, EXAMINER, 'QueryPendingFor', 'FSLMSP');
            expect(pend2).to.have.length(0);
            const { out: byOrg } = await tx(L, C, EXAMINER, 'QueryByCustodianOrg', 'FSLMSP');
            expect(byOrg).to.have.length(1);
        });
        it('flags a seal mismatch but still records the receipt', async () => {
            await tx(L, C, IO, 'InitiateTransfer', ID, 'FSLMSP', 'examiner.mehta', 'FSL request', '');
            await tx(L, C, EXAMINER, 'AcceptTransfer', ID, '["TEB-9"]', 'false', 'Seal number differs', 'FSL');
            const { out: h } = await tx(L, C, IO, 'GetHistory', ID);
            expect(h.pop().details).to.include({ seal_intact: false, seals_match: false });
        });
        it('allows only the custodian to initiate and only the named receiver to accept', async () => {
            await rejects(tx(L, C, EXAMINER, 'InitiateTransfer', ID, 'FSLMSP', 'examiner.mehta', 'steal it', ''), /current custodian/);
            await rejects(tx(L, C, MALKHANA, 'InitiateTransfer', ID, 'FSLMSP', 'examiner.mehta', 'same org, not custodian', ''), /current custodian/);
            await tx(L, C, IO, 'InitiateTransfer', ID, 'FSLMSP', 'examiner.mehta', 'FSL request', '');
            await rejects(tx(L, C, CLERK, 'AcceptTransfer', ID, '[]', 'true', 'not me', ''), /named receiver/);
            await rejects(tx(L, C, IO, 'AcceptTransfer', ID, '[]', 'true', 'sender cannot accept', ''), /named receiver/);
            await rejects(tx(L, C, IO, 'InitiateTransfer', ID, 'CourtMSP', 'clerk.rao', 'double transfer', ''), /status is IN_TRANSFER/);
        });
        it('rejection and cancellation return the item to the sender', async () => {
            await tx(L, C, IO, 'InitiateTransfer', ID, 'FSLMSP', 'examiner.mehta', 'FSL request', '');
            await tx(L, C, EXAMINER, 'RejectTransfer', ID, '[]', 'true', 'Wrong lab', '');
            let { out } = await tx(L, C, IO, 'GetEvidence', ID);
            expect(out).to.include({ status: 'IN_CUSTODY' });
            expect(out.custodian.cn).to.equal('io.sharma');
            await tx(L, C, IO, 'InitiateTransfer', ID, 'CourtMSP', 'clerk.rao', 'Produce in court', '');
            await tx(L, C, IO, 'CancelTransfer', ID, 'Hearing adjourned');
            ({ out } = await tx(L, C, IO, 'GetEvidence', ID));
            expect(out.pending_transfer).to.equal(null);
        });
        it('sets a key-level policy naming both agencies while a transfer is pending', async () => {
            const { stub } = await tx(L, C, IO, 'InitiateTransfer', ID, 'FSLMSP', 'examiner.mehta', 'FSL request', '');
            const [param] = [...stub.vwrites.values()];
            const text = Buffer.from(param).toString('latin1');
            expect(text).to.contain('PoliceMSP');
            expect(text).to.contain('FSLMSP');
        });
        it('rejects unknown organisations and self-transfer', async () => {
            await rejects(tx(L, C, IO, 'InitiateTransfer', ID, 'EvilMSP', 'x', 'r1x', ''), /unknown receiving/);
            await rejects(tx(L, C, IO, 'InitiateTransfer', ID, 'PoliceMSP', 'io.sharma', 'r1x', ''), /yourself/);
        });
    });

    describe('events', () => {
        beforeEach(async () => {
            await tx(L, C, IO, 'InitiateTransfer', ID, 'FSLMSP', 'examiner.mehta', 'FSL request', '');
            await tx(L, C, EXAMINER, 'AcceptTransfer', ID, '["TEB-1"]', 'true', 'Received', '');
        });
        it('examination lifecycle and identity verification by the custodian examiner', async () => {
            await tx(L, C, EXAMINER, 'RecordEvent', ID, 'VERIFY_IDENTITY', JSON.stringify({ verification: {
                method: 'phash-dct-64', result: 'MATCH', score: '4', threshold: '10', query_artefact_sha256: [H('c')] } }), 'Receipt check', '');
            await tx(L, C, EXAMINER, 'RecordEvent', ID, 'EXAMINE_START', '{}', 'QDE examination', '');
            await rejects(tx(L, C, EXAMINER, 'InitiateTransfer', ID, 'PoliceMSP', 'io.sharma', 'mid-exam', ''), /UNDER_EXAMINATION/);
            await tx(L, C, EXAMINER, 'RecordEvent', ID, 'EXAMINE_END', JSON.stringify({ attachments_sha256: [H('d')] }), 'Report issued', '');
            const { out: h } = await tx(L, C, IO, 'GetHistory', ID);
            expect(h.map((e) => e.type)).to.deep.equal(['REGISTER', 'TRANSFER_INITIATE', 'TRANSFER_ACCEPT', 'VERIFY_IDENTITY', 'EXAMINE_START', 'EXAMINE_END']);
        });
        it('anyone with a role may record ACCESS and VERIFY_INTEGRITY; custody actions need the custodian', async () => {
            await tx(L, C, CLERK, 'RecordEvent', ID, 'VERIFY_INTEGRITY', JSON.stringify({ verification: { method: 'sha256-recompute', result: 'MATCH' } }), 'Court check', '');
            await tx(L, C, IO, 'RecordEvent', ID, 'ACCESS', '{}', 'Case review', '');
            await rejects(tx(L, C, IO, 'RecordEvent', ID, 'SEAL', '{"seal_ids":["X"]}', 'reseal', ''), /current custodian/);
            await rejects(tx(L, C, NOROLE, 'RecordEvent', ID, 'ACCESS', '{}', 'peek', ''), /no CustodyChain role/);
        });
        it('only examiners may examine; verification must be well-formed', async () => {
            await rejects(tx(L, C, EXAMINER, 'RecordEvent', ID, 'VERIFY_IDENTITY', '{"verification":{"method":"x","result":"PROBABLY"}}', 'bad', ''), /result/);
            await rejects(tx(L, C, EXAMINER, 'RecordEvent', ID, 'TRANSFER_ACCEPT', '{}', 'sneaky', ''), /cannot be recorded/);
        });
        it('disposal needs a court order and is final', async () => {
            await rejects(tx(L, C, EXAMINER, 'RecordEvent', ID, 'DISPOSE', '{}', 'done', ''), /court_order_ref/);
            await tx(L, C, EXAMINER, 'RecordEvent', ID, 'DISPOSE', '{"court_order_ref":"CJM/GNR/88/2027"}', 'Disposed per order', '');
            await rejects(tx(L, C, EXAMINER, 'RecordEvent', ID, 'SEAL', '{"seal_ids":["Y"]}', 'too late', ''), /DISPOSED/);
            await tx(L, C, CLERK, 'RecordEvent', ID, 'ACCESS', '{}', 'records still readable', '');
        });
        it('corrections reference an event by the same author', async () => {
            const { out: h } = await tx(L, C, IO, 'GetHistory', ID);
            const accept = h.find((e) => e.type === 'TRANSFER_ACCEPT');
            await rejects(tx(L, C, IO, 'RecordEvent', ID, 'CORRECTION', JSON.stringify({ corrects_event_tx: accept.tx_id }), 'not mine', ''), /author/);
            await tx(L, C, EXAMINER, 'RecordEvent', ID, 'CORRECTION', JSON.stringify({ corrects_event_tx: accept.tx_id, note: 'seal no. typo' }), 'Fix typo', '');
        });
    });

    describe('derived evidence', () => {
        it('links child and parent and records events on both', async () => {
            await tx(L, C, IO, 'InitiateTransfer', ID, 'FSLMSP', 'examiner.mehta', 'FSL request', '');
            await tx(L, C, EXAMINER, 'AcceptTransfer', ID, '["TEB-1"]', 'true', 'Received', '');
            const child = 'GJ-GNR-CYBPS-2026-000123-E041';
            await tx(L, C, EXAMINER, 'DeriveEvidence', ID, record(child, { evidence_class: 'SCENE_PHOTOGRAPH', title: 'Post-exam reference scans' }), 'Re-scan after examination', '');
            const { out: c } = await tx(L, C, IO, 'GetEvidence', child);
            expect(c.parent_evidence_id).to.equal(ID);
            const { out: p } = await tx(L, C, IO, 'GetEvidence', ID);
            expect(p.children).to.deep.equal([child]);
            const { out: hc } = await tx(L, C, IO, 'GetHistory', child);
            expect(hc[0].details.derived_from).to.equal(ID);
            const { out: byCase } = await tx(L, C, IO, 'QueryByCase', '123/2026', 'Cyber PS Gandhinagar');
            expect(byCase.map((e) => e.evidence_id).sort()).to.deep.equal([ID, child]);
        });
        it('only the custodian of the parent may derive', async () => {
            await rejects(tx(L, C, EXAMINER, 'DeriveEvidence', ID, record('GJ-GNR-CYBPS-2026-000123-E042'), 'not custodian', ''), /custodian/);
        });
    });

    it('WhoAmI reports the certificate identity and role', async () => {
        const { out } = await tx(L, C, EXAMINER, 'WhoAmI');
        expect(out).to.include({ msp: 'FSLMSP', cn: 'examiner.mehta', role: 'examiner' });
    });
});
