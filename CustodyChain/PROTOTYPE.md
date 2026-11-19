# CustodyChain prototype v2: run and test guide

This is the working prototype built in milestones M0–M5 of [`outputs/ROADMAP.md`](../outputs/ROADMAP.md). Every design choice is recorded in [`outputs/DECISIONS.md`](../outputs/DECISIONS.md) (D-032 to D-047 for this build).

## What it is

A chain-of-custody system for evidence, run by four agencies on a Byzantine-fault-tolerant ledger:

| Layer | Directory | What it does |
|---|---|---|
| Ledger | `backend/network-bft/` | Hyperledger Fabric 3.1.5, SmartBFT with 4 orderers (Police, FSL, Court, Prosecution); peers for Police, FSL and Court; a Fabric CA per agency issuing **user certificates with roles** |
| Smart contract | `backend/chaincode-v2/` (`evidence`) | Fingerprints of each item's manifest; append-only custody events; two-phase transfer that **both agencies must endorse**; custodian-only and role-only actions |
| API | `backend/gateway-v2/` | Login; every ledger call is signed with **the user's own certificate**. Upload → hash (SHA-256 + SHA3-256) → encrypt → store → manifest (validated against `outputs/spec`) → anchor. Verify, download, inclusion proofs |
| Evidence store | `backend/evidence-store/` (created at run time, gitignored) | Content-addressed, AES-256-GCM per file, write-once |
| UI | `frontend-v2/` | Register wizard, inbox, evidence page with timeline and actions, verify page |

The authors' original system (`backend/network`, `chaincode`, `gateway`, `frontend`) is kept for reproducing the paper. See `SETUP_AND_TROUBLESHOOTING.md`.

## Run it

```bash
# 0. The original Raft network shares ports: stop it (keeps its data)
cd ~/Projects/Blockchain/CustodyChain/backend/network && ./network.sh stop

# 1. Ledger: 4 BFT orderers, 3 peers, 3 CAs, both chaincodes, role users (first time ~3 min)
cd ../network-bft
./network.sh all          # later: ./network.sh stop / ./network.sh start (data kept)

# 2. API + UI on one port
cd ../gateway-v2 && npm install          # first time
cd ../../frontend-v2 && npm install && npm run build   # first time / after UI changes
cd ../backend/gateway-v2 && node src/server.js         # -> http://localhost:4000
```

Open <http://localhost:4000>. For UI development, run `npm run dev` in `frontend-v2` (port 5174, proxies `/api` to 4000).

### Demo accounts (password `custody-demo`)

| User | Agency | Role | Can |
|---|---|---|---|
| `io.sharma` | Police | Investigating Officer | register evidence; custody actions on items they hold |
| `malkhana.desai` | Police | Malkhana In-charge | custody actions on items they hold |
| `examiner.mehta` | FSL | Examiner | examine, record identity checks, derive items |
| `clerk.rao` | Court | Property Clerk | receive, record court submission, return/dispose on court order |

Anyone can verify a file against the ledger. Change the passwords with `node scripts/make-users.js <password>` in `gateway-v2`.

### Demo flow (about 5 minutes)

1. **`io.sharma`**: Register evidence → *Physical document* → fill in the case, seal number and details → add page scans. Each file's SHA-256 appears **before** upload → Register. The result shows the on-chain manifest hash and Merkle root.
2. On the evidence page, **Transfer custody** to `examiner.mehta`. The status becomes *in transfer*; custody hasn't moved yet.
3. **`examiner.mehta`**: *Incoming transfers* (1) → open → **Accept custody**, confirming the seal number. Record an identity check, start and complete the examination (the report is hashed in the browser), then transfer to `clerk.rao`.
4. **`clerk.rao`**: accept, then *Record court submission*. Use **Verify a file** with an original page (**MATCH**, naming the artefact), then with any edited copy (**NO MATCH**).
5. The **chain of custody** timeline shows every step, with the actor taken from their certificate and the time from the ledger.

## Tests

| Command | What it checks | Result (2026-11-19) |
|---|---|---|
| `cd backend/chaincode-v2 && npm test` | contract rules on an in-memory ledger that, like Fabric, doesn't let a transaction read its own writes | 18/18 |
| `cd backend/gateway-v2 && npm test` | JS fingerprints byte-identical to the Python reference; encrypted store (tamper, overwrite, AAD binding) | 10/10 |
| `cd backend/gateway-v2 && npm run e2e` | the acceptance scenario through the API on the live BFT network, including an attack: a Police→FSL handover endorsed by FSL+Court only is **rejected by the ledger** | 34/34 |
| `cd frontend-v2 && npm run test:ui` (gateway running) | the acceptance scenario through the browser (headless Chromium) | 24/24 |
| `cd backend/network-bft && ./test-bft.sh` | BFT properties: quorum signatures, f=1 tolerance, halts with 2 down, leader change, persistence (16 containers, about 507 MiB) | 8/8 |

Screenshots: `outputs/prototype-screenshots/`.

## Known limitations (prototype)

- **Authentication:** a local `users.json` with scrypt hashes and in-memory sessions (D-043). Production would use agency SSO or a hardware token bound to the certificate.
- **Key custody:** one gateway holds all agencies' storage master keys (D-045). Production would run one gateway and key service per agency.
- **Network:** CAs run without TLS on localhost, and all nodes run on one laptop (D-011, D-035).
- **Identity checks (L2):** pHash and 3D comparison are not yet run by the app; the examiner records the result. The Python tool computes them (roadmap M6).
- **Court outputs:** no custody-report PDF or BSA s.63 certificate generation yet (roadmap M7).
- **Block validation:** peer-side enforcement of BFT quorum signatures is still to be confirmed (D-030).
