'use strict';
/*
 * Layer-2 identity checks (D-048) via the Python reference tool, so the app and the report use the same code.
 * The tool is our own file; inputs are temp files the gateway writes itself. Runs with cwd = the tool's
 * directory and WITHOUT `python -I` (isolated mode hides user-installed scipy -> very slow 3D fallback).
 */
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');

const TOOL = process.env.L2_TOOL || path.resolve(__dirname, '../../../../outputs/tools/evidence_hash.py');
const PY = process.env.PYTHON || 'python3';
const RULES = {
    'phash-dct-64': { rule: 'hamming<=10', threshold: 10 },
    'mesh-icp-rms': { rule: 'rms_mm<=0.60 and max_mm<=3.00', rms: 0.60, max: 3.00 },
};

const isImage = (mediaType, name = '') => /^image\//.test(mediaType || '') || /\.(png|jpe?g|tiff?|webp|bmp|heic)$/i.test(name);
const isMesh = (mediaType, name = '') => /^model\//.test(mediaType || '') || /\.ply$/i.test(name);

function available() { return fs.existsSync(TOOL); }

function runBatch(jobs, timeoutMs = 180000) {
    return new Promise((resolve, reject) => {
        const p = spawn(PY, [TOOL, 'l2-batch'], { cwd: path.dirname(TOOL), stdio: ['pipe', 'pipe', 'pipe'] });
        let out = ''; let err = '';
        const t = setTimeout(() => { p.kill('SIGKILL'); reject(new Error('identity-check tool timed out')); }, timeoutMs);
        p.stdout.on('data', (d) => { out += d; });
        p.stderr.on('data', (d) => { err += d; });
        p.on('error', (e) => { clearTimeout(t); reject(e); });
        p.on('close', (code) => {
            clearTimeout(t);
            if (code !== 0) return reject(new Error(`identity-check tool failed (${code}): ${err.slice(-400)}`));
            try { return resolve(JSON.parse(out)); } catch (e) { return reject(new Error(`bad tool output: ${out.slice(0, 200)}`)); }
        });
        p.stdin.end(JSON.stringify({ jobs }));
    });
}

// Write buffers to a private temp dir, run fn(paths), always clean up.
async function withTempFiles(items, fn) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cc-l2-'));
    try {
        const paths = items.map((it, i) => {
            const ext = (path.extname(it.name || '') || (it.mesh ? '.ply' : '.bin')).toLowerCase().replace(/[^.a-z0-9]/g, '');
            const p = path.join(dir, `${i}-${crypto.randomBytes(4).toString('hex')}${ext}`);
            fs.writeFileSync(p, it.buffer, { mode: 0o600 });
            return p;
        });
        return await fn(paths);
    } finally {
        fs.rmSync(dir, { recursive: true, force: true });
    }
}

// pHash for each image buffer: returns array aligned with input (null for non-images or failures).
async function phashes(items) {
    const imgs = items.map((it, i) => ({ ...it, i })).filter((it) => isImage(it.media_type, it.name));
    if (!imgs.length || !available()) return items.map(() => null);
    return withTempFiles(imgs, async (paths) => {
        const r = await runBatch(paths.map((file) => ({ op: 'phash', file })));
        const out = items.map(() => null);
        imgs.forEach((it, k) => { if (r.results[k] && r.results[k].ok) out[it.i] = r.results[k].phash; });
        return out;
    });
}

function hamming(a, b) {
    let x = BigInt(`0x${a}`) ^ BigInt(`0x${b}`); let n = 0;
    while (x) { n += Number(x & 1n); x >>= 1n; }
    return n;
}

module.exports = { RULES, isImage, isMesh, available, runBatch, withTempFiles, phashes, hamming, TOOL };
