'use strict';
/*
 * Encrypted, content-addressed evidence store (D-039 encryption, D-045 backend).
 *  - object name = SHA-256 of the plaintext; written once, never overwritten
 *  - each object encrypted with a fresh AES-256-GCM data key; the data key is wrapped (AES-256-GCM)
 *    with the uploading agency's master key; metadata sidecar <sha256>.json
 *  - get() decrypts and re-hashes: a corrupted or substituted object is refused
 * Interface: put(buf, meta) / get(sha256) / has(sha256) / meta(sha256): an S3 backend can replace it.
 */
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

class EvidenceStore {
    constructor(dir, keyDir) {
        this.dir = dir;
        this.keyDir = keyDir;
        fs.mkdirSync(path.join(dir, 'objects'), { recursive: true });
        fs.mkdirSync(keyDir, { recursive: true, mode: 0o700 });
    }

    masterKey(agency) {
        const f = path.join(this.keyDir, `${agency}.key`);
        if (!fs.existsSync(f)) fs.writeFileSync(f, crypto.randomBytes(32).toString('hex'), { mode: 0o600 });
        return Buffer.from(fs.readFileSync(f, 'utf8').trim(), 'hex');
    }

    _paths(sha) {
        if (!/^[0-9a-f]{64}$/.test(sha)) throw new Error('invalid object name');
        const d = path.join(this.dir, 'objects', sha.slice(0, 2));
        return { d, blob: path.join(d, `${sha}.bin`), meta: path.join(d, `${sha}.json`) };
    }

    has(sha) { return fs.existsSync(this._paths(sha).meta); }

    meta(sha) { return JSON.parse(fs.readFileSync(this._paths(sha).meta, 'utf8')); }

    put(buf, { agency, media_type: mediaType, uploaded_by: uploadedBy, file_name: fileName }) {
        const sha = crypto.createHash('sha256').update(buf).digest('hex');
        const p = this._paths(sha);
        if (this.has(sha)) return { sha256: sha, existed: true };
        const dataKey = crypto.randomBytes(32);
        const iv = crypto.randomBytes(12);
        const c = crypto.createCipheriv('aes-256-gcm', dataKey, iv);
        c.setAAD(Buffer.from(sha, 'hex'));                      // binds ciphertext to its content address
        const ct = Buffer.concat([c.update(buf), c.final()]);
        const tag = c.getAuthTag();
        const kiv = crypto.randomBytes(12);
        const kc = crypto.createCipheriv('aes-256-gcm', this.masterKey(agency), kiv);
        const wrapped = Buffer.concat([kc.update(dataKey), kc.final()]);
        const meta = { sha256: sha, size_bytes: buf.length, media_type: mediaType || 'application/octet-stream',
            file_name: fileName || null, agency, uploaded_by: uploadedBy, stored_at: new Date().toISOString(),
            cipher: 'AES-256-GCM', iv: iv.toString('hex'), tag: tag.toString('hex'),
            wrapped_key: { agency, iv: kiv.toString('hex'), tag: kc.getAuthTag().toString('hex'), ct: wrapped.toString('hex') } };
        fs.mkdirSync(p.d, { recursive: true });
        fs.writeFileSync(p.blob, ct, { flag: 'wx' });          // wx: never overwrite
        fs.writeFileSync(p.meta, JSON.stringify(meta, null, 2), { flag: 'wx' });
        return { sha256: sha, existed: false };
    }

    get(sha) {
        const p = this._paths(sha);
        const m = this.meta(sha);
        const kd = crypto.createDecipheriv('aes-256-gcm', this.masterKey(m.wrapped_key.agency), Buffer.from(m.wrapped_key.iv, 'hex'));
        kd.setAuthTag(Buffer.from(m.wrapped_key.tag, 'hex'));
        const dataKey = Buffer.concat([kd.update(Buffer.from(m.wrapped_key.ct, 'hex')), kd.final()]);
        const d = crypto.createDecipheriv('aes-256-gcm', dataKey, Buffer.from(m.iv, 'hex'));
        d.setAAD(Buffer.from(sha, 'hex'));
        d.setAuthTag(Buffer.from(m.tag, 'hex'));
        const buf = Buffer.concat([d.update(fs.readFileSync(p.blob)), d.final()]);
        const check = crypto.createHash('sha256').update(buf).digest('hex');
        if (check !== sha) throw new Error(`stored object ${sha} fails its content hash`);
        return { buf, meta: m };
    }
}

module.exports = { EvidenceStore };
