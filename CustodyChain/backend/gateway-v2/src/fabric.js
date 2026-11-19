'use strict';
// One Fabric Gateway connection per logged-in user, signing with THAT user's certificate (D-043).
const grpc = require('@grpc/grpc-js');
const { connect, hash, signers } = require('@hyperledger/fabric-gateway');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const cfg = require('./config');

const clients = new Map();   // org -> grpc client
const gateways = new Map();  // username -> { gateway, contract, subject }
const utf8 = new TextDecoder();

function grpcClient(orgKey) {
    if (!clients.has(orgKey)) {
        const o = cfg.ORGS[orgKey];
        const creds = grpc.credentials.createSsl(fs.readFileSync(o.tlsCert));
        clients.set(orgKey, new grpc.Client(o.peer, creds, { 'grpc.ssl_target_name_override': o.host }));
    }
    return clients.get(orgKey);
}

function userMsp(user) { return path.join(cfg.ORGS[user.org].usersDir, `${user.username}@${cfg.ORGS[user.org].domain}`, 'msp'); }

function contractFor(user) {
    if (gateways.has(user.username)) return gateways.get(user.username);
    const msp = userMsp(user);
    const signDir = path.join(msp, 'signcerts');
    const certFile = fs.existsSync(signDir) ? path.join(signDir, fs.readdirSync(signDir).find((n) => n.endsWith('.pem')) || 'cert.pem') : path.join(signDir, 'cert.pem');
    if (!fs.existsSync(certFile)) throw Object.assign(new Error(`no Fabric identity for ${user.username}; run network-bft/network.sh users`), { status: 500 });
    const keyDir = path.join(msp, 'keystore');
    const key = crypto.createPrivateKey(fs.readFileSync(path.join(keyDir, fs.readdirSync(keyDir)[0])));
    const certPem = fs.readFileSync(certFile);
    const gateway = connect({
        client: grpcClient(user.org),
        identity: { mspId: cfg.ORGS[user.org].msp, credentials: certPem },
        signer: signers.newPrivateKeySigner(key),
        hash: hash.sha256,
        evaluateOptions: () => ({ deadline: Date.now() + 10000 }),
        endorseOptions: () => ({ deadline: Date.now() + 30000 }),
        submitOptions: () => ({ deadline: Date.now() + 10000 }),
        commitStatusOptions: () => ({ deadline: Date.now() + 90000 }),
    });
    const contract = gateway.getNetwork(cfg.CHANNEL).getContract(cfg.CHAINCODE);
    const subject = new crypto.X509Certificate(certPem).subject.replace(/\n/g, ', ');
    const entry = { gateway, contract, subject };
    gateways.set(user.username, entry);
    return entry;
}

// Fabric errors carry the chaincode message in details; surface it cleanly.
function cleanError(err) {
    const details = (err.details || []).map((d) => d.message).filter(Boolean);
    let msg = details[0] || err.message || String(err);
    const m = /message=(.*?)(?:$|\n)/.exec(msg) || /chaincode response \d+, (.*)$/.exec(msg);
    if (m) msg = m[1];
    const e = new Error(msg);
    e.status = err.status || (err.code === 4 ? 504 : 400);
    e.fabric = { code: err.code, transactionId: err.transactionId };
    return e;
}

async function evaluate(user, fn, ...args) {
    try {
        const r = await contractFor(user).contract.evaluateTransaction(fn, ...args.map(String));
        const s = utf8.decode(r);
        return s ? JSON.parse(s) : null;
    } catch (e) { throw cleanError(e); }
}

async function submit(user, fn, args, endorsingOrganizations) {
    try {
        const opts = { arguments: args.map(String) };
        if (endorsingOrganizations) opts.endorsingOrganizations = endorsingOrganizations;
        const r = await contractFor(user).contract.submit(fn, opts);
        const s = utf8.decode(r);
        return s ? JSON.parse(s) : null;
    } catch (e) { throw cleanError(e); }
}

function certSubject(user) { return contractFor(user).subject; }

function closeAll() {
    for (const g of gateways.values()) g.gateway.close();
    for (const c of clients.values()) c.close();
}

module.exports = { evaluate, submit, certSubject, closeAll };
