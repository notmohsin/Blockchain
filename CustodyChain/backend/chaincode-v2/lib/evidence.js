/*
 * CustodyChain evidence-registry chaincode (v2).
 *
 * Design: outputs/report (two-layer fingerprinting), outputs/spec (manifest + custody events),
 * decisions D-016, D-036, D-037, D-038 in outputs/DECISIONS.md.
 *
 * On-chain per evidence item: fingerprints of its off-chain manifest (manifest_sha256, merkle_root),
 * class, case reference, parent, current custodian, status, pending transfer.
 * Every action is an append-only event; the actor comes from the signing certificate
 * (MSP, CN, role attribute) and the time from the transaction timestamp: never from arguments.
 */
'use strict';

const { Contract } = require('fabric-contract-api');
const { KeyEndorsementPolicy } = require('fabric-shim');
const stringify = require('json-stringify-deterministic');
const sortKeysRecursive = require('sort-keys-recursive');

const SPEC_VERSION = '1.0';
const EVIDENCE_CLASSES = [
    'SCENE_PHOTOGRAPH', 'AV_RECORDING', 'CCTV_EXPORT', 'PHYSICAL_DOCUMENT', 'PHYSICAL_ITEM',
    'BIO_TRACE_SAMPLE', 'DIGITAL_DEVICE', 'FORENSIC_IMAGE', 'MOBILE_EXTRACTION', 'CLOUD_DATA',
    'IOT_LOG', 'PROCEDURAL_DOCUMENT',
];
const PEER_MSPS = ['PoliceMSP', 'FSLMSP', 'CourtMSP'];
const ROLES = ['io', 'malkhana', 'examiner', 'court_clerk'];
const ID_RE = /^[A-Z]{2}-[A-Z]{2,5}-[A-Z0-9]{2,8}-[0-9]{4}-[0-9]{6}-E[0-9]{3}$/;
const HEX64 = /^[0-9a-f]{64}$/;
const FIR_RE = /^[0-9]{1,6}\/[0-9]{4}$/;

const STATUS = { IN_CUSTODY: 'IN_CUSTODY', IN_TRANSFER: 'IN_TRANSFER', UNDER_EXAMINATION: 'UNDER_EXAMINATION',
    ARCHIVED: 'ARCHIVED', RETURNED: 'RETURNED', DISPOSED: 'DISPOSED' };
const FINAL = [STATUS.DISPOSED, STATUS.RETURNED];

// Events recorded through RecordEvent and who may record them
const RECORDABLE = {
    ACCESS:            { custodianOnly: false },
    VERIFY_INTEGRITY:  { custodianOnly: false },
    CORRECTION:        { custodianOnly: false },
    SEAL:              { custodianOnly: true },
    RESEAL:            { custodianOnly: true },
    EXAMINE_START:     { custodianOnly: true, roles: ['examiner'] },
    EXAMINE_END:       { custodianOnly: true, roles: ['examiner'] },
    VERIFY_IDENTITY:   { custodianOnly: true },
    SUBMIT_COURT:      { custodianOnly: true },
    RETURN:            { custodianOnly: true, courtOrder: true },
    ARCHIVE:           { custodianOnly: true, courtOrder: true },
    DISPOSE:           { custodianOnly: true, courtOrder: true },
};

function fail(msg) { throw new Error(msg); }
function toBuf(obj) { return Buffer.from(stringify(sortKeysRecursive(obj))); }
function parseJSON(s, what) {
    try { return typeof s === 'string' ? JSON.parse(s) : s; } catch (e) { return fail(`${what} is not valid JSON`); }
}
function reqStr(v, what, min = 1) {
    if (typeof v !== 'string' || v.trim().length < min) { fail(`${what} is required`); }
    return v.trim();
}

class EvidenceContract extends Contract {
    constructor() { super('EvidenceContract'); }

    // ------------------------------------------------------------------ identity and time
    _actor(ctx) {
        const cid = ctx.clientIdentity;
        const subject = cid.getID();
        const cnMatch = /CN=([^,/]+)/.exec(subject.split('::')[1] || subject);
        return { msp: cid.getMSPID(), subject, cn: cnMatch ? cnMatch[1] : subject, role: cid.getAttributeValue('role') || null };
    }

    _requireRole(actor, roles) {
        if (!actor.role || !ROLES.includes(actor.role)) { fail(`caller ${actor.cn}@${actor.msp} has no CustodyChain role`); }
        if (roles && !roles.includes(actor.role)) { fail(`role '${actor.role}' may not perform this action (allowed: ${roles.join(', ')})`); }
    }

    _now(ctx) {
        const ts = ctx.stub.getTxTimestamp();
        const s = ts.seconds;
        const secs = typeof s === 'object' && s !== null ? (typeof s.toNumber === 'function' ? s.toNumber() : Number(s.low)) : Number(s);
        return new Date(secs * 1000 + Math.floor(Number(ts.nanos || 0) / 1e6)).toISOString();
    }

    _isCustodian(rec, actor) { return rec.custodian.msp === actor.msp && rec.custodian.subject === actor.subject; }

    // ------------------------------------------------------------------ keys
    _evKey(ctx, id) { return ctx.stub.createCompositeKey('evidence', [id]); }
    _eventKey(ctx, id, ts) { return ctx.stub.createCompositeKey('event', [id, ts, ctx.stub.getTxID()]); }

    async _get(ctx, id) {
        const b = await ctx.stub.getState(this._evKey(ctx, id));
        if (!b || b.length === 0) { fail(`evidence ${id} does not exist`); }
        return JSON.parse(b.toString());
    }

    async _exists(ctx, id) {
        const b = await ctx.stub.getState(this._evKey(ctx, id));
        return !!b && b.length > 0;
    }

    async _setIndex(ctx, name, attrs, on) {
        const k = ctx.stub.createCompositeKey(name, attrs);
        if (on) { await ctx.stub.putState(k, Buffer.from('\u0000')); } else { await ctx.stub.deleteState(k); }
    }

    async _setKeyPolicy(ctx, id, msps) {
        const ep = new KeyEndorsementPolicy();
        ep.addOrgs('PEER', ...[...new Set(msps)].sort());
        await ctx.stub.setStateValidationParameter(this._evKey(ctx, id), ep.getPolicy());
    }

    async _event(ctx, id, type, actor, reason, location, details, ts) {
        const ev = { docType: 'event', evidence_id: id, type, tx_id: ctx.stub.getTxID(), timestamp: ts,
            actor: { msp: actor.msp, cn: actor.cn, role: actor.role, subject: actor.subject },
            reason, location: location || '', details: details || {} };
        await ctx.stub.putState(this._eventKey(ctx, id, ts), toBuf(ev));
        ctx.stub.setEvent('CustodyEvent', toBuf({ evidence_id: id, type, tx_id: ev.tx_id, timestamp: ts }));
        return ev;
    }

    async _put(ctx, rec) { await ctx.stub.putState(this._evKey(ctx, rec.evidence_id), toBuf(rec)); }

    _validateFingerprint(r) {
        if (!ID_RE.test(r.evidence_id || '')) { fail('evidence_id has an invalid format'); }
        if (!EVIDENCE_CLASSES.includes(r.evidence_class)) { fail(`unknown evidence_class '${r.evidence_class}'`); }
        if (!HEX64.test(r.manifest_sha256 || '')) { fail('manifest_sha256 must be 64 lowercase hex characters'); }
        if (!HEX64.test(r.merkle_root || '')) { fail('merkle_root must be 64 lowercase hex characters'); }
        if (!Number.isInteger(r.artefact_count) || r.artefact_count < 1) { fail('artefact_count must be a positive integer'); }
        if (r.spec_version !== SPEC_VERSION) { fail(`spec_version must be ${SPEC_VERSION}`); }
        if (!r.case || !FIR_RE.test(r.case.fir_number || '')) { fail('case.fir_number must look like 123/2026'); }
        reqStr(r.case.police_station, 'case.police_station');
        reqStr(r.title, 'title', 3);
    }

    _newRecord(ctx, r, actor, ts, parent) {
        return {
            docType: 'evidence', evidence_id: r.evidence_id, evidence_class: r.evidence_class, title: r.title.trim(),
            case: { fir_number: r.case.fir_number, police_station: r.case.police_station.trim() },
            case_ref: `${r.case.fir_number}@${r.case.police_station.trim()}`,
            parent_evidence_id: parent || null,
            manifest_sha256: r.manifest_sha256, merkle_root: r.merkle_root, artefact_count: r.artefact_count,
            spec_version: r.spec_version,
            custodian: { msp: actor.msp, cn: actor.cn, role: actor.role, subject: actor.subject, since: ts },
            status: STATUS.IN_CUSTODY, seal_ids: Array.isArray(r.seal_ids) ? r.seal_ids.map(String) : [],
            pending_transfer: null, registered_at: ts, registered_by: { msp: actor.msp, cn: actor.cn, role: actor.role },
            children: [],
        };
    }

    // ------------------------------------------------------------------ transactions
    async WhoAmI(ctx) { return JSON.stringify(this._actor(ctx)); }

    async RegisterEvidence(ctx, recordJson, reason, location) {
        const actor = this._actor(ctx);
        this._requireRole(actor, ['io']);
        const r = parseJSON(recordJson, 'record');
        this._validateFingerprint(r);
        if (r.parent_evidence_id) { fail('use DeriveEvidence to register derived evidence'); }
        if (await this._exists(ctx, r.evidence_id)) { fail(`evidence ${r.evidence_id} already exists`); }
        const ts = this._now(ctx);
        const rec = this._newRecord(ctx, r, actor, ts, null);
        await this._put(ctx, rec);
        await this._setKeyPolicy(ctx, rec.evidence_id, [actor.msp]);
        await this._setIndex(ctx, 'case~evidence', [rec.case_ref, rec.evidence_id], true);
        await this._setIndex(ctx, 'custodian~evidence', [actor.msp, rec.evidence_id], true);
        await this._event(ctx, rec.evidence_id, 'REGISTER', actor, reqStr(reason, 'reason', 3), location,
            { manifest_sha256: rec.manifest_sha256, merkle_root: rec.merkle_root, evidence_class: rec.evidence_class,
                seal_ids: rec.seal_ids }, ts);
        return JSON.stringify(rec);
    }

    async DeriveEvidence(ctx, parentId, recordJson, reason, location) {
        const actor = this._actor(ctx);
        this._requireRole(actor, ['examiner', 'io']);
        const parent = await this._get(ctx, parentId);
        if (!this._isCustodian(parent, actor)) { fail('only the current custodian of the parent may derive evidence from it'); }
        if (FINAL.includes(parent.status)) { fail(`parent is ${parent.status}`); }
        const r = parseJSON(recordJson, 'record');
        this._validateFingerprint(r);
        if (await this._exists(ctx, r.evidence_id)) { fail(`evidence ${r.evidence_id} already exists`); }
        const ts = this._now(ctx);
        const child = this._newRecord(ctx, r, actor, ts, parentId);
        parent.children = [...(parent.children || []), child.evidence_id];
        await this._put(ctx, child);
        await this._put(ctx, parent);
        await this._setKeyPolicy(ctx, child.evidence_id, [actor.msp]);
        await this._setIndex(ctx, 'case~evidence', [child.case_ref, child.evidence_id], true);
        await this._setIndex(ctx, 'custodian~evidence', [actor.msp, child.evidence_id], true);
        const why = reqStr(reason, 'reason', 3);
        await this._event(ctx, parentId, 'DERIVE', actor, why, location,
            { child_evidence_id: child.evidence_id, manifest_sha256: child.manifest_sha256, merkle_root: child.merkle_root }, ts);
        await this._event(ctx, child.evidence_id, 'REGISTER', actor, why, location,
            { derived_from: parentId, manifest_sha256: child.manifest_sha256, merkle_root: child.merkle_root,
                evidence_class: child.evidence_class }, ts);
        return JSON.stringify(child);
    }

    async InitiateTransfer(ctx, id, toMsp, toUser, reason, location) {
        const actor = this._actor(ctx);
        this._requireRole(actor);
        const rec = await this._get(ctx, id);
        if (!this._isCustodian(rec, actor)) { fail('only the current custodian may initiate a transfer'); }
        if (rec.status !== STATUS.IN_CUSTODY) { fail(`cannot transfer while status is ${rec.status}`); }
        if (!PEER_MSPS.includes(toMsp)) { fail(`unknown receiving organisation ${toMsp}`); }
        const user = reqStr(toUser, 'receiving user');
        if (toMsp === actor.msp && user === actor.cn) { fail('cannot transfer to yourself'); }
        const ts = this._now(ctx);
        rec.pending_transfer = { to_msp: toMsp, to_user: user, from_msp: actor.msp, from_user: actor.cn,
            initiated_tx: ctx.stub.getTxID(), initiated_at: ts, reason: reqStr(reason, 'reason', 3) };
        rec.status = STATUS.IN_TRANSFER;
        await this._put(ctx, rec);
        // D-038: from now on, changing this record needs BOTH agencies' peers
        await this._setKeyPolicy(ctx, id, [actor.msp, toMsp]);
        await this._setIndex(ctx, 'pending~evidence', [toMsp, id], true);
        await this._event(ctx, id, 'TRANSFER_INITIATE', actor, rec.pending_transfer.reason, location,
            { to_msp: toMsp, to_user: user }, ts);
        return JSON.stringify(rec);
    }

    async _closeTransfer(ctx, id, accept, sealIdsJson, sealIntact, reason, location) {
        const actor = this._actor(ctx);
        this._requireRole(actor);
        const rec = await this._get(ctx, id);
        const p = rec.pending_transfer;
        if (!p) { fail(`evidence ${id} has no pending transfer`); }
        if (actor.msp !== p.to_msp || actor.cn !== p.to_user) { fail('only the named receiver may accept or reject this transfer'); }
        const seals = parseJSON(sealIdsJson || '[]', 'seal_ids_observed');
        if (!Array.isArray(seals)) { fail('seal_ids_observed must be a list'); }
        const intact = String(sealIntact) === 'true';
        const ts = this._now(ctx);
        const from = { msp: rec.custodian.msp, cn: rec.custodian.cn };
        await this._setIndex(ctx, 'pending~evidence', [p.to_msp, id], false);
        if (accept) {
            await this._setIndex(ctx, 'custodian~evidence', [rec.custodian.msp, id], false);
            await this._setIndex(ctx, 'custodian~evidence', [actor.msp, id], true);
            rec.custodian = { msp: actor.msp, cn: actor.cn, role: actor.role, subject: actor.subject, since: ts };
        }
        rec.pending_transfer = null;
        rec.status = STATUS.IN_CUSTODY;
        await this._put(ctx, rec);
        await this._setKeyPolicy(ctx, id, [rec.custodian.msp]);
        await this._event(ctx, id, accept ? 'TRANSFER_ACCEPT' : 'TRANSFER_REJECT', actor, reqStr(reason, 'reason', 3), location,
            { transfer_ref: p.initiated_tx, from, seal_ids_observed: seals.map(String), seal_intact: intact,
                seal_ids_expected: rec.seal_ids, seals_match: rec.seal_ids.length === 0 ||
                    (seals.length === rec.seal_ids.length && seals.every((s) => rec.seal_ids.includes(String(s)))) }, ts);
        return JSON.stringify(rec);
    }

    async AcceptTransfer(ctx, id, sealIdsJson, sealIntact, reason, location) {
        return this._closeTransfer(ctx, id, true, sealIdsJson, sealIntact, reason, location);
    }

    async RejectTransfer(ctx, id, sealIdsJson, sealIntact, reason, location) {
        return this._closeTransfer(ctx, id, false, sealIdsJson, sealIntact, reason, location);
    }

    async CancelTransfer(ctx, id, reason) {
        const actor = this._actor(ctx);
        this._requireRole(actor);
        const rec = await this._get(ctx, id);
        if (!rec.pending_transfer) { fail(`evidence ${id} has no pending transfer`); }
        if (!this._isCustodian(rec, actor)) { fail('only the sender may cancel a transfer'); }
        const p = rec.pending_transfer;
        const ts = this._now(ctx);
        await this._setIndex(ctx, 'pending~evidence', [p.to_msp, id], false);
        rec.pending_transfer = null;
        rec.status = STATUS.IN_CUSTODY;
        await this._put(ctx, rec);
        await this._setKeyPolicy(ctx, id, [rec.custodian.msp]);
        await this._event(ctx, id, 'TRANSFER_CANCEL', actor, reqStr(reason, 'reason', 3), '', { transfer_ref: p.initiated_tx }, ts);
        return JSON.stringify(rec);
    }

    async RecordEvent(ctx, id, type, detailsJson, reason, location) {
        const actor = this._actor(ctx);
        const rule = RECORDABLE[type];
        if (!rule) { fail(`event type '${type}' cannot be recorded with RecordEvent`); }
        this._requireRole(actor, rule.roles);
        const rec = await this._get(ctx, id);
        const d = parseJSON(detailsJson || '{}', 'details');
        if (typeof d !== 'object' || Array.isArray(d)) { fail('details must be a JSON object'); }
        if (rule.custodianOnly && !this._isCustodian(rec, actor)) { fail(`only the current custodian may record ${type}`); }
        if (FINAL.includes(rec.status) && rule.custodianOnly) { fail(`evidence is ${rec.status}; no further custody actions`); }
        if (rec.pending_transfer && rule.custodianOnly) { fail('a transfer is pending; accept, reject or cancel it first'); }
        if (rule.courtOrder) { reqStr(d.court_order_ref, 'details.court_order_ref'); }
        const why = reqStr(reason, 'reason', 3);
        const ts = this._now(ctx);
        let changed = false;
        switch (type) {
        case 'SEAL': case 'RESEAL':
            if (!Array.isArray(d.seal_ids) || d.seal_ids.length === 0) { fail('details.seal_ids must be a non-empty list'); }
            rec.seal_ids = d.seal_ids.map(String); changed = true; break;
        case 'EXAMINE_START':
            if (rec.status !== STATUS.IN_CUSTODY) { fail(`cannot start examination while ${rec.status}`); }
            rec.status = STATUS.UNDER_EXAMINATION; changed = true; break;
        case 'EXAMINE_END':
            if (rec.status !== STATUS.UNDER_EXAMINATION) { fail('no examination in progress'); }
            rec.status = STATUS.IN_CUSTODY; changed = true; break;
        case 'VERIFY_INTEGRITY': case 'VERIFY_IDENTITY': {
            const v = d.verification || {};
            reqStr(v.method, 'details.verification.method');
            if (!['MATCH', 'NO_MATCH', 'INCONCLUSIVE'].includes(v.result)) { fail('details.verification.result must be MATCH, NO_MATCH or INCONCLUSIVE'); }
            (v.query_artefact_sha256 || []).forEach((h) => { if (!HEX64.test(h)) { fail('query_artefact_sha256 entries must be hex SHA-256'); } });
            break;
        }
        case 'ARCHIVE': rec.status = STATUS.ARCHIVED; changed = true; break;
        case 'RETURN': rec.status = STATUS.RETURNED; changed = true; break;
        case 'DISPOSE': rec.status = STATUS.DISPOSED; changed = true; break;
        case 'CORRECTION': {
            const ref = reqStr(d.corrects_event_tx, 'details.corrects_event_tx');
            const events = JSON.parse(await this.GetHistory(ctx, id));
            const orig = events.find((e) => e.tx_id === ref);
            if (!orig) { fail(`no event with tx ${ref} on ${id}`); }
            if (orig.actor.subject !== actor.subject) { fail('only the author of an event may correct it'); }
            break;
        }
        default: break;
        }
        if (changed) { await this._put(ctx, rec); }
        const ev = await this._event(ctx, id, type, actor, why, location, d, ts);
        return JSON.stringify(ev);
    }

    // ------------------------------------------------------------------ queries
    async EvidenceExists(ctx, id) { return this._exists(ctx, id); }

    async GetEvidence(ctx, id) { return JSON.stringify(await this._get(ctx, id)); }

    async GetHistory(ctx, id) {
        const out = [];
        const it = await ctx.stub.getStateByPartialCompositeKey('event', [id]);
        let r = await it.next();
        while (!r.done) {
            out.push(JSON.parse(Buffer.from(r.value.value).toString('utf8')));
            r = await it.next();
        }
        await it.close();
        out.sort((a, b) => (a.timestamp < b.timestamp ? -1 : a.timestamp > b.timestamp ? 1 : (a.tx_id < b.tx_id ? -1 : 1)));
        return JSON.stringify(out);
    }

    async _byIndex(ctx, name, attrs) {
        const out = [];
        const it = await ctx.stub.getStateByPartialCompositeKey(name, attrs);
        let r = await it.next();
        while (!r.done) {
            const { attributes } = ctx.stub.splitCompositeKey(r.value.key);
            const id = attributes[attributes.length - 1];
            out.push(await this._get(ctx, id));
            r = await it.next();
        }
        await it.close();
        return JSON.stringify(out);
    }

    async QueryByCase(ctx, firNumber, policeStation) { return this._byIndex(ctx, 'case~evidence', [`${firNumber}@${policeStation}`]); }

    async QueryByCustodianOrg(ctx, msp) { return this._byIndex(ctx, 'custodian~evidence', [msp]); }

    async QueryPendingFor(ctx, msp) { return this._byIndex(ctx, 'pending~evidence', [msp]); }
}

module.exports = EvidenceContract;
module.exports.constants = { SPEC_VERSION, EVIDENCE_CLASSES, PEER_MSPS, ROLES, STATUS };
