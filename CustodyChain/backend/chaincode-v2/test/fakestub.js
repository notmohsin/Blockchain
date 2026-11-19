'use strict';
// Minimal in-memory stand-in for the Fabric chaincode stub, faithful to the behaviour the contract relies on:
// composite keys, partial-key range queries, tx id/timestamp, key-level endorsement parameters, and
// Fabric's rule that a transaction does NOT read its own writes (writes are applied at commit()).

const SEP = '\u0000';

class FakeLedger {
    constructor() { this.state = new Map(); this.vparams = new Map(); this.clock = Date.UTC(2026, 10, 19, 5, 0, 0); this.n = 0; }
}

class FakeStub {
    constructor(ledger) {
        this.ledger = ledger;
        this.writes = new Map();
        this.vwrites = new Map();
        ledger.n += 1;
        ledger.clock += 1000;
        this.txId = `tx${String(ledger.n).padStart(4, '0')}`;
        this.ts = ledger.clock;
        this.event = null;
    }
    getTxID() { return this.txId; }
    getTxTimestamp() { return { seconds: { low: Math.floor(this.ts / 1000), toNumber: () => Math.floor(this.ts / 1000) }, nanos: (this.ts % 1000) * 1e6 }; }
    createCompositeKey(type, attrs) { return SEP + type + SEP + attrs.map(String).join(SEP) + SEP; }
    splitCompositeKey(key) {
        const parts = key.split(SEP).filter((_, i, a) => i > 0 && i < a.length - 1);
        return { objectType: parts[0], attributes: parts.slice(1) };
    }
    async getState(k) { return this.ledger.state.get(k) || Buffer.alloc(0); }
    async putState(k, v) { this.writes.set(k, Buffer.from(v)); }
    async deleteState(k) { this.writes.set(k, null); }
    async setStateValidationParameter(k, p) { this.vwrites.set(k, p); }
    async getStateValidationParameter(k) { return this.ledger.vparams.get(k); }
    setEvent(name, payload) { this.event = { name, payload }; }
    async getStateByPartialCompositeKey(type, attrs) {
        const prefix = SEP + type + SEP + attrs.map((a) => a + SEP).join('');
        const keys = [...this.ledger.state.keys()].filter((k) => k.startsWith(prefix)).sort();
        let i = 0;
        const st = this.ledger.state;
        return {
            async next() { if (i >= keys.length) { return { done: true }; } const key = keys[i++]; return { done: false, value: { key, value: st.get(key) } }; },
            async close() {},
        };
    }
    commit() {
        for (const [k, v] of this.writes) { if (v === null) { this.ledger.state.delete(k); } else { this.ledger.state.set(k, v); } }
        for (const [k, p] of this.vwrites) { this.ledger.vparams.set(k, p); }
    }
}

function identity(msp, cn, role) {
    return {
        getMSPID: () => msp,
        getID: () => `x509::/C=IN/ST=Gujarat/O=${msp}/OU=client/CN=${cn}::/C=IN/O=${msp}/CN=ca`,
        getAttributeValue: (n) => (n === 'role' ? role : null),
    };
}

// Run one contract call as one transaction; commit only if it succeeds (like a valid Fabric tx).
async function tx(ledger, contract, who, fn, ...args) {
    const stub = new FakeStub(ledger);
    const ctx = { stub, clientIdentity: who };
    const out = await contract[fn](ctx, ...args);
    stub.commit();
    return { out: typeof out === 'string' ? JSON.parse(out) : out, stub };
}

module.exports = { FakeLedger, FakeStub, identity, tx };
