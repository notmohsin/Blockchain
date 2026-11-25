# CustodyChain: a blockchain chain of custody for evidence

A research project on recording the **chain of custody of criminal evidence** on a permissioned blockchain, from collection at the scene to production in court. It is designed for the Indian legal framework (BNSS 2023, BSA 2023).

The project starts from the system published by Loffi et al., reproduces it, and extends it in three ways:

1. **A consortium ledger.** Four agencies (Police, FSL, Court, Prosecution) each run a node on a Byzantine-fault-tolerant Hyperledger Fabric network, so no single agency controls the record.
2. **Evidence fingerprinting.** Every item has exact integrity hashes (L1) and tolerant identity checks (L2), bound together in a canonical manifest whose fingerprint goes on the ledger.
3. **A working prototype.** It has a custody contract, an encrypted evidence store, an API, a web UI and court outputs, along with tests and benchmarks.

> **Base paper:** L. Loffi, G. L. Camillo, C. M. Westphall, C. B. Westphall, *"Blockchain-Based Chain of Custody for Digital Evidence with Hyperledger Fabric"*, ICOIN 2025, IEEE. DOI [10.1109/ICOIN63865.2025.10992690](https://doi.org/10.1109/ICOIN63865.2025.10992690). Authors' code: [leandroloffi/CustodyChain](https://github.com/leandroloffi/CustodyChain).

---

## Repository layout

```
Blockchain/
├── CustodyChain/                 # all code
│   ├── backend/
│   │   ├── network/              # authors' Raft test network (Fabric 2.5.9), kept for reproduction
│   │   ├── chaincode/            # authors' 5W1H asset-transfer chaincode
│   │   ├── gateway/              # authors' Express gateway (port 3000)
│   │   ├── network-bft/          # our network: SmartBFT, 4 agency orderers, Fabric 3.1.5
│   │   ├── chaincode-v2/         # our `evidence` contract: append-only custody events
│   │   └── gateway-v2/           # our API: per-user identity, hashing, encrypted store (port 4000)
│   ├── frontend/                 # authors' Svelte UI (port 5173)
│   ├── frontend-v2/              # our Svelte UI, served by gateway-v2
│   ├── PROTOTYPE.md              # run-and-test guide for the prototype
│   └── SETUP_AND_TROUBLESHOOTING.md  # setup, persistence, known issues, critique of the original
├── outputs/
│   ├── report/                   # LaTeX report (main.pdf): design, legal mapping, implementation, evaluation
│   ├── spec/                     # JSON Schemas: evidence manifest (12 classes) and custody events
│   ├── tools/                    # Python reference hashing tool and report generators
│   ├── worked-example/           # computed hashes used in the report
│   ├── evaluation/               # benchmark, tamper-suite and BFT test results
│   ├── prototype-screenshots/    # UI screenshots
│   ├── prototype-samples/        # sample custody report and BSA s.63 certificate PDFs
│   ├── PLAN.md                   # phases 1–3 (persistence, report/spec, BFT)
│   ├── ROADMAP.md                # milestones M0–M9 of the prototype
│   └── DECISIONS.md              # decision log (D-xxx), with rationale and alternatives
└── Papers/                       # literature and Indian policy and legal sources (PDF)
```

The authors' original code is kept as it was published, apart from changes needed to make it run. Everything new lives beside it in `*-v2` and `network-bft` directories, so the paper can still be reproduced.

---

## Architecture of the prototype

| Layer | Where | What it does |
|---|---|---|
| Ledger | `backend/network-bft/` | Hyperledger Fabric 3.1.5 with SmartBFT ordering: 4 orderers, one per agency (n = 3f + 1, so it tolerates f = 1 faulty or malicious node). Peers for Police, FSL and Court. A Fabric CA per agency issues user certificates that carry roles. The ledger survives restarts. |
| Smart contract | `backend/chaincode-v2/` | Stores the manifest fingerprint and Merkle root of each item and keeps append-only custody events. A transfer has two phases (initiate, then accept), and both agencies must endorse it. Only the custodian or the right role can act. The actor is taken from the certificate and the time from the transaction. |
| API | `backend/gateway-v2/` | Signs every ledger call with the logged-in user's own certificate. Hashes each upload with SHA-256 and SHA3-256, encrypts and stores it, then builds and validates the manifest and anchors it on the ledger. Also handles file verification, inclusion proofs, L2 identity checks and court outputs. |
| Evidence store | `backend/evidence-store/` (created at run time, gitignored) | Content-addressed and write-once, with AES-256-GCM encryption per file. |
| UI | `frontend-v2/` | Registration wizard (hashes are computed in the browser before upload), transfer inbox, custody timeline, verify-a-file page, custody report, BSA s.63 Part A/B drafts. |

**What goes on the ledger:** only identifiers, fingerprints (`manifest_sha256`, `merkle_root`) and custody events. Files and personal data stay off-chain in the encrypted store.

---

## Quick start

Requirements:

- Linux, Docker with Docker Compose, Node.js ≥ 18 and `jq`.
- The Fabric binaries, which are gitignored. Put the 3.1.5 binaries (from `hyperledger-fabric-linux-amd64-3.1.5.tar.gz`, `bin/`) in `CustodyChain/backend/bin/v3.1.5/`. Put the 2.5.9 binaries, which include `fabric-ca-client`, in `CustodyChain/backend/bin/`, using Fabric's `install-fabric.sh`.

All nodes run on one machine; a laptop with 15 GB RAM was enough.

```bash
cd CustodyChain/backend/network-bft
./network.sh all                 # first run ~3 min: CAs, 4 orderers, 3 peers, chaincode, demo users
                                 # later: ./network.sh stop / ./network.sh start (data kept)

cd ../gateway-v2 && npm install
cd ../../frontend-v2 && npm install && npm run build
cd ../backend/gateway-v2 && node src/server.js      # → http://localhost:4000
```

Log in as `io.sharma`, `examiner.mehta` or `clerk.rao` (password `custody-demo`) and follow the five-minute demo flow in [`CustodyChain/PROTOTYPE.md`](CustodyChain/PROTOTYPE.md).

If the authors' Raft network is running, stop it first (`cd CustodyChain/backend/network && ./network.sh stop`), because the two networks use the same ports. To run the **original system**, follow [`CustodyChain/SETUP_AND_TROUBLESHOOTING.md`](CustodyChain/SETUP_AND_TROUBLESHOOTING.md).

---

## Tests and results

| Check | Command | Result |
|---|---|---|
| Contract rules | `cd CustodyChain/backend/chaincode-v2 && npm test` | 18/18 |
| JS hashing matches the Python reference; encrypted store | `cd CustodyChain/backend/gateway-v2 && npm test` | 10/10 |
| Full scenario through the API on the live BFT network | `npm run e2e` (in `gateway-v2`) | 46/46 |
| Tamper attacks on stored data and contract inputs | `node scripts/tamper-suite.js` | 9/9 detected |
| Full scenario through the browser | `cd CustodyChain/frontend-v2 && npm run test:ui` | 26/26 |
| BFT properties (quorum signatures, f = 1 tolerance, halts with 2 down, leader change, persistence) | `cd CustodyChain/backend/network-bft && ./test-bft.sh` | 8/8 |
| Latency and throughput, BFT-4 vs Raft-4 | `node scripts/bench.js <label>` | [`outputs/evaluation/`](outputs/evaluation/) |

On a single laptop, a custody write takes about 65–180 ms at the median (under 0.3 s at p95) with up to 32 concurrent clients, at about 180–200 committed tx/s. There was no measurable cost of BFT compared with Raft using the same four orderers. See §11.4 of the report.

---

## Report and specification

- **Report:** [`outputs/report/main.pdf`](outputs/report/main.pdf), *Fingerprinting Real-World Evidence for a Permissioned Chain-of-Custody Ledger* (draft v0.2). It covers:
  - the threat model and the two-layer fingerprinting model
  - per-class procedures for 12 evidence classes
  - the custody lifecycle
  - the mapping to BNSS, BSA s.63 and e-Sakshya
  - the network design
  - worked examples with real hashes
  - limitations
  - implementation and evaluation

  To rebuild it, run `cd outputs/report && latexmk -pdf main.tex`. Appendix B lists every command needed to regenerate its numbers.
- **Input specification:** [`outputs/spec/`](outputs/spec/), JSON Schemas for the evidence manifest and custody events, with validated examples.
- **Reference tool:** `outputs/tools/evidence_hash.py` (Python 3, with `numpy`, `Pillow` and `jsonschema`). It hashes, builds manifests, verifies, produces Merkle proofs and runs the pHash and 3D comparisons, independently of the prototype. For example:
  ```bash
  python3 outputs/tools/evidence_hash.py validate outputs/spec/examples/notebook.manifest.json
  ```

---

## Project history

| Stage | What was done |
|---|---|
| Reproduction | The authors' system was run as published on Fabric 2.5.9, with only the changes needed to make it run. Its weaknesses are recorded in `SETUP_AND_TROUBLESHOOTING.md`. |
| Phase 1 | The ledger now survives restarts (`stop` / `start`), and wiping it needs an explicit command. |
| Phase 2 | LaTeX report and machine-readable input specification. |
| Phase 3 | BFT network with 4 agency orderers on Fabric 3.1.5. |
| M0–M9 | Working prototype: identities and roles, evidence contract, encrypted store, API, UI, identity checks, court outputs, evaluation, report v0.2. |

Every design choice is in [`outputs/DECISIONS.md`](outputs/DECISIONS.md). Choices marked *Review: pending* were made during implementation and still need confirmation.

---

## Known limitations

This is a research prototype, not a production system:

- Login uses a local user file and in-memory sessions.
- One gateway holds every agency's storage keys.
- The CAs run without TLS, and all nodes run on one host, so no wide-area latency was measured.
- The L2 thresholds are illustrative and have not been calibrated on real captures.
- The BSA s.63 certificates are pre-filled **drafts** that the certifying person must check, complete and sign.

Next steps are listed in [`outputs/ROADMAP.md`](outputs/ROADMAP.md) and in the report's open questions.
