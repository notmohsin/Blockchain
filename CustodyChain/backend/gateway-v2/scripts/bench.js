#!/usr/bin/env node
'use strict';
/*
 * Load generator for the evaluation (M8, D-051). Uses the same Fabric Gateway client as the application,
 * signing as io.sharma. Measures end-to-end submit latency (endorse -> order -> commit) and committed throughput
 * at fixed concurrency levels, plus query latency.
 *   node scripts/bench.js <label> [--levels 1,4,8,16,32] [--per-worker 10]
 * Writes outputs/evaluation/bench-<label>.json
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const fabric = require('../src/fabric');

const label = process.argv[2] || 'run';
const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const LEVELS = arg('--levels', '1,4,8,16,32').split(',').map(Number);
const PER_WORKER = Number(arg('--per-worker', 10));
const MIN_TX = 40;
const IO = { username: 'io.sharma', org: 'police' };
const OUT = path.resolve(__dirname, '../../../../outputs/evaluation');
const hex = () => crypto.randomBytes(32).toString('hex');
let firSeq = Date.now() % 800000 + 100000;

function stats(ms) {
    const s = [...ms].sort((a, b) => a - b);
    const q = (p) => s[Math.min(s.length - 1, Math.floor(p * s.length))];
    return { n: s.length, mean_ms: Math.round(s.reduce((x, y) => x + y, 0) / s.length), p50_ms: Math.round(q(0.5)), p95_ms: Math.round(q(0.95)), max_ms: Math.round(s[s.length - 1]) };
}

async function runLevel(concurrency, makeOp) {
    const total = Math.max(MIN_TX, concurrency * PER_WORKER);
    let next = 0; let failures = 0;
    const lat = [];
    const t0 = process.hrtime.bigint();
    await Promise.all(Array.from({ length: concurrency }, async () => {
        while (next < total) {
            const k = next++;
            const s = process.hrtime.bigint();
            try { await makeOp(k); lat.push(Number(process.hrtime.bigint() - s) / 1e6); } catch (e) { failures += 1; if (failures < 4) console.error(`    ! ${e.message.slice(0, 140)}`); }
        }
    }));
    const wall = Number(process.hrtime.bigint() - t0) / 1e9;
    return { concurrency, ...stats(lat), failures, wall_s: Number(wall.toFixed(2)), throughput_tps: Number((lat.length / wall).toFixed(2)) };
}

function record(fir, item) {
    return { evidence_id: `GJ-GNR-CYBPS-2026-${String(fir).padStart(6, '0')}-E${String(item).padStart(3, '0')}`, evidence_class: 'SCENE_PHOTOGRAPH',
        title: 'benchmark item', case: { fir_number: `${fir}/2026`, police_station: 'Cyber Crime Police Station Gandhinagar' },
        manifest_sha256: hex(), merkle_root: hex(), artefact_count: 1, spec_version: '1.0', seal_ids: [] };
}

async function main() {
    console.log(`Benchmark '${label}': levels ${LEVELS.join(', ')}, >= ${MIN_TX} tx per level\n`);
    const fir = firSeq++;
    const target = record(fir, 1);
    // Warm-up (same for every configuration): right after a network is built, service discovery may not yet know
    // which peers run the chaincode ("no combination of peers ... endorsement policy"). Retry for up to 3 minutes.
    for (let i = 0; ; i++) {
        try { await fabric.submit(IO, 'RegisterEvidence', [JSON.stringify(target), 'benchmark target item', '']); break; } catch (e) {
            if (i >= 36 || !/FAILED_PRECONDITION|endorsement policy|UNAVAILABLE/.test(e.message)) throw e;
            if (i === 0) console.log('  waiting for service discovery to converge...');
            await new Promise((r) => setTimeout(r, 5000));
        }
    }
    for (let i = 0; i < 5; i++) await fabric.evaluate(IO, 'GetEvidence', target.evidence_id);
    const results = { label, date: new Date().toISOString(), host: { cpus: require('os').cpus().length, mem_gb: Math.round(require('os').totalmem() / 2 ** 30), loadavg_at_start: require('os').loadavg().map((x) => Number(x.toFixed(2))) }, ops: {} };
    const ops = {
        'RecordEvent(ACCESS)': () => async () => fabric.submit(IO, 'RecordEvent', [target.evidence_id, 'ACCESS', '{"purpose":"benchmark"}', 'benchmark read access', '']),
        RegisterEvidence: () => { const f = firSeq++; return async (k) => fabric.submit(IO, 'RegisterEvidence', [JSON.stringify(record(f, k + 1)), 'benchmark registration', '']); },
        'GetEvidence (query)': () => async () => fabric.evaluate(IO, 'GetEvidence', target.evidence_id),
    };
    for (const [name, factory] of Object.entries(ops)) {
        console.log(name);
        results.ops[name] = [];
        for (const c of LEVELS) {
            const r = await runLevel(c, factory());
            results.ops[name].push(r);
            console.log(`  c=${String(c).padStart(2)}  n=${r.n}  p50 ${String(r.p50_ms).padStart(5)} ms  p95 ${String(r.p95_ms).padStart(5)} ms  max ${String(r.max_ms).padStart(5)} ms  ${String(r.throughput_tps).padStart(7)} tx/s  failures ${r.failures}`);
        }
    }
    fs.mkdirSync(OUT, { recursive: true });
    fs.writeFileSync(path.join(OUT, `bench-${label}.json`), JSON.stringify(results, null, 2) + '\n');
    console.log(`\nwrote ${path.join(OUT, `bench-${label}.json`)}`);
    fabric.closeAll();
}

main().catch((e) => { console.error(e); process.exit(1); });
