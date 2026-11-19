'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { EvidenceStore } = require('../src/store');

function fresh() {
    const d = fs.mkdtempSync(path.join(os.tmpdir(), 'evstore-'));
    return { d, s: new EvidenceStore(path.join(d, 'store'), path.join(d, 'keys')) };
}

test('round trip: encrypted at rest, content-addressed, decrypts to the same bytes', () => {
    const { d, s } = fresh();
    const buf = crypto.randomBytes(5000);
    const { sha256 } = s.put(buf, { agency: 'police', media_type: 'image/jpeg', uploaded_by: 'io.sharma' });
    assert.strictEqual(sha256, crypto.createHash('sha256').update(buf).digest('hex'));
    const raw = fs.readFileSync(path.join(d, 'store', 'objects', sha256.slice(0, 2), `${sha256}.bin`));
    assert.notDeepStrictEqual(raw, buf, 'ciphertext must differ from plaintext');
    assert.deepStrictEqual(s.get(sha256).buf, buf);
});

test('objects are never overwritten', () => {
    const { s } = fresh();
    const buf = Buffer.from('same content');
    assert.strictEqual(s.put(buf, { agency: 'police' }).existed, false);
    assert.strictEqual(s.put(buf, { agency: 'fsl' }).existed, true);
});

test('tampered ciphertext or metadata is refused', () => {
    const { d, s } = fresh();
    const { sha256 } = s.put(Buffer.from('evidence bytes'), { agency: 'police' });
    const blob = path.join(d, 'store', 'objects', sha256.slice(0, 2), `${sha256}.bin`);
    const ct = fs.readFileSync(blob); ct[0] ^= 1; fs.writeFileSync(blob, ct);
    assert.throws(() => s.get(sha256));
});

test('a ciphertext moved under another content address is refused (AAD binding)', () => {
    const { d, s } = fresh();
    const a = s.put(Buffer.from('file A'), { agency: 'police' }).sha256;
    const b = s.put(Buffer.from('file B'), { agency: 'police' }).sha256;
    const dir = (h) => path.join(d, 'store', 'objects', h.slice(0, 2));
    fs.copyFileSync(path.join(dir(a), `${a}.bin`), path.join(dir(b), `${b}.bin`));
    const ma = JSON.parse(fs.readFileSync(path.join(dir(a), `${a}.json`)));
    const mb = JSON.parse(fs.readFileSync(path.join(dir(b), `${b}.json`)));
    fs.writeFileSync(path.join(dir(b), `${b}.json`), JSON.stringify({ ...mb, iv: ma.iv, tag: ma.tag, wrapped_key: ma.wrapped_key }));
    assert.throws(() => s.get(b));
});
