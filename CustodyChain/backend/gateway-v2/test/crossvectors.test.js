'use strict';
// D-041: the JS fingerprint library must agree byte-for-byte with the Python reference implementation.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const os = require('os');
const fp = require('../src/lib/fingerprint');

const EX = path.resolve(__dirname, '../../../../outputs/spec/examples');
const TOOL = path.resolve(__dirname, '../../../../outputs/tools/evidence_hash.py');

for (const name of ['scene-photo', 'notebook', 'knife']) {
    test(`manifest hash and Merkle root match the Python reference: ${name}`, () => {
        const m = JSON.parse(fs.readFileSync(path.join(EX, `${name}.manifest.json`), 'utf8'));
        const rec = JSON.parse(fs.readFileSync(path.join(EX, `${name}.ledger-record.json`), 'utf8'));
        assert.strictEqual(fp.manifestHash(m), rec.manifest_sha256);
        assert.strictEqual(fp.manifestMerkleRoot(m), rec.merkle_root);
        for (const a of m.artefacts) assert.ok(fp.proofFor(m, a.artefact_id).verifies, `proof for ${a.artefact_id}`);
    });
}

test('JCS edge cases (key order by UTF-16 code units, escapes, no floats)', () => {
    const s = fp.jcs({ b: 1, a: [true, null, 'x\n\u0001é'], '€': 0, '\u{1F600}': 1 }).toString();
    assert.strictEqual(s, '{"a":[true,null,"x\\n\\u0001é"],"b":1,"€":0,"😀":1}');
    assert.throws(() => fp.jcs({ x: 1.5 }), /floating-point/);
});

test('inclusion proofs verify for every index of trees of size 1..33, and fail when tampered', () => {
    const crypto = require('crypto');
    for (let n = 1; n <= 33; n++) {
        const leaves = Array.from({ length: n }, () => crypto.randomBytes(40));
        const root = fp.mth(leaves);
        for (let m = 0; m < n; m++) {
            const p = fp.inclusionPath(m, leaves);
            assert.ok(fp.verifyInclusion(leaves[m], m, n, p, root));
            assert.ok(!fp.verifyInclusion(Buffer.concat([leaves[m], Buffer.from('x')]), m, n, p, root));
        }
    }
});

test('a random manifest canonicalises identically in JS and Python', { skip: !fs.existsSync(TOOL) }, () => {
    const m = JSON.parse(fs.readFileSync(path.join(EX, 'notebook.manifest.json'), 'utf8'));
    m.description = 'Ünïcødé — "quotes" \\ back\tslash \u0007 control 😀 €';
    m.class_attributes.distinguishing_features.push('ζ-feature', 'a b');
    const f = path.join(os.tmpdir(), `xv-${process.pid}.json`);
    fs.writeFileSync(f, JSON.stringify(m));
    const py = JSON.parse(execFileSync('python3', ['-I', TOOL, 'ledger-record', f]).toString());
    fs.unlinkSync(f);
    assert.strictEqual(fp.manifestHash(m), py.manifest_sha256);
});
