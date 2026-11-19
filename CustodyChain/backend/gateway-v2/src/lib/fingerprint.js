'use strict';
/*
 * JavaScript port of outputs/tools/evidence_hash.py (D-041). Must stay byte-compatible with the
 * Python reference: test/crossvectors.test.js checks every example manifest against it.
 *   - jcs():          RFC 8785 JSON Canonicalization Scheme (restricted profile: no floats)
 *   - mth()/proofs:   RFC 6962 Merkle tree, 0x00 leaf / 0x01 node domain separation; RFC 9162 verification
 *   - artefactLeaf(): salt(32B) || artefact_id(ASCII) || sha256(32B)       (D-018)
 */
const crypto = require('crypto');

const sha256 = (buf) => crypto.createHash('sha256').update(buf).digest();

// ------------------------------------------------------------------------------------------- JCS
function jcsString(s) {
    let out = '"';
    for (const ch of s) {
        const c = ch.codePointAt(0);
        if (ch === '"') out += '\\"';
        else if (ch === '\\') out += '\\\\';
        else if (ch === '\b') out += '\\b';
        else if (ch === '\f') out += '\\f';
        else if (ch === '\n') out += '\\n';
        else if (ch === '\r') out += '\\r';
        else if (ch === '\t') out += '\\t';
        else if (c < 0x20) out += '\\u' + c.toString(16).padStart(4, '0');
        else out += ch;
    }
    return out + '"';
}

function utf16Compare(a, b) {           // JS strings are UTF-16: plain < compares code units
    return a < b ? -1 : a > b ? 1 : 0;
}

function jcsEncode(v) {
    if (v === null) return 'null';
    if (v === true) return 'true';
    if (v === false) return 'false';
    if (typeof v === 'number') {
        if (!Number.isInteger(v)) throw new Error('floating-point numbers are not allowed in manifests; use a decimal string');
        if (!Number.isSafeInteger(v)) throw new Error('integer outside the safe range; carry it as a string');
        return String(v);
    }
    if (typeof v === 'string') return jcsString(v);
    if (Array.isArray(v)) return '[' + v.map(jcsEncode).join(',') + ']';
    if (typeof v === 'object') {
        const keys = Object.keys(v).filter((k) => v[k] !== undefined).sort(utf16Compare);
        return '{' + keys.map((k) => jcsString(k) + ':' + jcsEncode(v[k])).join(',') + '}';
    }
    throw new TypeError(`not a JSON value: ${typeof v}`);
}

const jcs = (v) => Buffer.from(jcsEncode(v), 'utf8');
const manifestHash = (m) => sha256(jcs(m)).toString('hex');

// ------------------------------------------------------------------------------------------- Merkle
const leafHash = (d) => sha256(Buffer.concat([Buffer.from([0x00]), d]));
const nodeHash = (l, r) => sha256(Buffer.concat([Buffer.from([0x01]), l, r]));
function split(n) { let k = 1; while (k << 1 < n) k <<= 1; return k; }

function mth(leaves) {
    const n = leaves.length;
    if (n === 0) return sha256(Buffer.alloc(0));
    if (n === 1) return leafHash(leaves[0]);
    const k = split(n);
    return nodeHash(mth(leaves.slice(0, k)), mth(leaves.slice(k)));
}

function inclusionPath(m, leaves) {
    const n = leaves.length;
    if (n <= 1) return [];
    const k = split(n);
    if (m < k) return [...inclusionPath(m, leaves.slice(0, k)), mth(leaves.slice(k))];
    return [...inclusionPath(m - k, leaves.slice(k)), mth(leaves.slice(0, k))];
}

function verifyInclusion(leafData, index, size, path, root) {
    if (index >= size) return false;
    let fn = index; let sn = size - 1;
    let r = leafHash(leafData);
    for (const p of path) {
        if (sn === 0) return false;
        if ((fn & 1) || fn === sn) {
            r = nodeHash(p, r);
            if (!(fn & 1)) { while ((fn & 1) === 0 && fn !== 0) { fn >>= 1; sn >>= 1; } }
        } else {
            r = nodeHash(r, p);
        }
        fn >>= 1; sn >>= 1;
    }
    return sn === 0 && crypto.timingSafeEqual(r, root);
}

function artefactLeaf(a) {
    return Buffer.concat([Buffer.from(a.leaf_salt, 'hex'), Buffer.from(a.artefact_id, 'ascii'), Buffer.from(a.sha256, 'hex')]);
}

function orderedArtefacts(manifest) {
    return [...manifest.artefacts].sort((a, b) => ((a.sequence || 0) - (b.sequence || 0)) || utf16Compare(a.artefact_id, b.artefact_id));
}

const manifestMerkleRoot = (m) => mth(orderedArtefacts(m).map(artefactLeaf)).toString('hex');

function proofFor(manifest, artefactId) {
    const arts = orderedArtefacts(manifest);
    const idx = arts.findIndex((a) => a.artefact_id === artefactId);
    if (idx < 0) throw new Error(`no artefact ${artefactId}`);
    const leaves = arts.map(artefactLeaf);
    const path = inclusionPath(idx, leaves);
    return {
        artefact_id: artefactId, leaf_index: idx, tree_size: leaves.length,
        leaf_salt: arts[idx].leaf_salt, sha256: arts[idx].sha256,
        audit_path: path.map((p) => p.toString('hex')), merkle_root: manifest.integrity.merkle_root,
        verifies: verifyInclusion(leaves[idx], idx, leaves.length, path, Buffer.from(manifest.integrity.merkle_root, 'hex')),
        scheme: 'RFC6962-SHA256-salted-v1',
    };
}

// ------------------------------------------------------------------------------------------- files
function hashBuffer(buf) {
    return {
        size_bytes: buf.length,
        sha256: crypto.createHash('sha256').update(buf).digest('hex'),
        sha3_256: crypto.createHash('sha3-256').update(buf).digest('hex'),
    };
}

module.exports = { jcs, jcsEncode, manifestHash, mth, inclusionPath, verifyInclusion, artefactLeaf,
    orderedArtefacts, manifestMerkleRoot, proofFor, hashBuffer, sha256 };
