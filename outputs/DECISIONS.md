# CustodyChain: decision log

This file records every decision about the project, so that anyone (you, the professor, a reviewer) can see **what was decided, when, by whom, why, and what else was considered**.

## How this log works
- **One entry per decision, numbered `D-xxx` in order.** An entry is never deleted. If a decision changes, a new entry *supersedes* it and the old one is marked `Superseded by D-yyy`.
- **Status:** `Accepted` (in force) · `Proposed` (recommended, not yet agreed) · `Superseded` · `Open` (needs investigation).
- **Decided by:** `User`, `Professor`, or `Implementer` (Claude, while building). Implementer decisions are marked **Review: pending** until you confirm them. Please read those and either confirm or overturn them.
- **Linked to the code:** entries cite the commit that implements them. From now on, commit messages reference the decision ID (e.g. `feat: … (D-032)`).
- **Pending choices** that block upcoming work are listed in [§ Open decisions](#open-decisions-needed-for-the-roadmap) as `P-xx`. Once taken, each becomes a `D-xxx` entry.

---

## Index

| ID | Date | Decision | Status | Decided by | Review |
|---|---|---|---|---|---|
| D-001 | 2026-10-18 | Build on Loffi et al. CustodyChain (Fabric), not Chain4ensic | Accepted | User | — |
| D-002 | 2026-11-17 | Reproduce the authors' system as published; only run-only changes | Accepted | User | — |
| D-003 | 2026-11-17 | Deploy chaincode as a service (CCaaS) instead of `deployCC` | Accepted | Implementer | confirmed (committed at user's request) |
| D-004 | 2026-11-17 | Keep the authors' bugs in the baseline; fix only in improved versions | Accepted | Implementer | confirmed (used in meeting) |
| D-005 | 2026-11-17 | One `main` branch; no feature branches | Accepted | User | — |
| D-006 | 2026-11-17 | No hosted pages/artifacts; documents live as files in the repo | Accepted | User | — |
| D-007 | 2026-11-17 | Fix the upstream `network.sh` chaincode-cleanup bug | Accepted | User | — |
| D-008 | 2026-11-17 | Keep the infrastructure, rebuild the domain logic | Accepted | Implementer → User | professor's view not recorded |
| D-009 | 2026-11-19 | BFT consensus with 4 ordering (consensus) nodes | Accepted | Professor + User | — |
| D-010 | 2026-11-19 | Model real agencies (test phase): Police, FSL, Court, Prosecution | Accepted | User (topology: Implementer) | topology: **pending** |
| D-011 | 2026-11-19 | Test deployment on a single laptop | Accepted | User | — |
| D-012 | 2026-11-19 | Ledger must survive restarts; keep an explicit wipe command | Accepted | User | — |
| D-013 | 2026-11-19 | Order of work: persistence → report/spec → BFT | Accepted | User | — |
| D-014 | 2026-11-19 | Two-layer fingerprinting: exact integrity hashes + tolerant identity checks | Accepted | User | — |
| D-015 | 2026-11-19 | Hash every artefact with SHA-256 **and** SHA3-256; MD5/SHA-1 only as cross-reference | Accepted | Implementer | **pending** |
| D-016 | 2026-11-19 | On-chain: only fingerprints and custody events; files and personal data off-chain | Accepted | Brief + Implementer | **pending** |
| D-017 | 2026-11-19 | Canonical manifest = RFC 8785 JCS; no floating-point numbers | Accepted | Implementer | **pending** |
| D-018 | 2026-11-19 | Bind artefacts with a salted RFC 6962 Merkle tree | Accepted | Implementer | **pending** |
| D-019 | 2026-11-19 | 12 evidence classes (provisional) | Accepted | Implementer → User | — |
| D-020 | 2026-11-19 | Identity-check methods: pHash, symmetric 3D (ICP), seal IDs; thresholds illustrative | Accepted | Implementer | **pending** |
| D-021 | 2026-11-19 | Input specification as JSON Schema; report appendix generated from it | Accepted | Implementer | **pending** |
| D-022 | 2026-11-19 | Report in LaTeX in `outputs/`; internal, rigorous, includes Indian law | Accepted | User | — |
| D-023 | 2026-11-19 | Separate `network-bft/`; keep the authors' Raft network unchanged | Accepted | Implementer | **pending** |
| D-024 | 2026-11-19 | Hyperledger Fabric 3.1.5 for the BFT network | Accepted | Implementer | **pending** |
| D-025 | 2026-11-19 | `cryptogen` identities; separate orderer and peer MSPs per agency | Accepted (test phase) | Implementer | **pending** (see P-02) |
| D-026 | 2026-11-19 | Default endorsement: majority of agency peers (2 of 3) | Accepted (interim) | Implementer | **pending** (see P-04) |
| D-027 | 2026-11-19 | Court orderer on port 11050 (9050 taken by Tor) | Accepted | Implementer | — |
| D-028 | 2026-11-19 | Deterministic chaincode packages; services use the approved package ID | Accepted | Implementer | — |
| D-029 | 2026-11-19 | Gateway identity/peer paths configurable by env vars; defaults unchanged | Accepted | Implementer | **pending** |
| D-030 | 2026-11-19 | Block validation left as in the Fabric BFT sample; peer-side quorum check to be verified | Open | Implementer | **investigate** |
| D-031 | 2026-11-19 | Every decision is recorded in this log | Accepted | User | — |
| D-032 | 2026-11-19 | Autonomous run M0–M5 on branch `prototype/m0-m5` | Accepted | User | — |
| D-033 | 2026-11-19 | Resolve P-01..P-12 with the recommended options for this run | Accepted | Implementer (delegated) | **pending** |
| D-034 | 2026-11-19 | Apply `stash@{0}` as the "improved v1" baseline (P-01) | Accepted | Implementer (delegated) | **pending** |
| D-035 | 2026-11-19 | Users and roles via Fabric CA per agency, reusing the cryptogen org CA (P-02) | Accepted | Implementer (delegated) | **pending** |
| D-036 | 2026-11-19 | Role model and prototype users | Accepted | Implementer (delegated) | **pending** |
| D-037 | 2026-11-19 | New JavaScript chaincode `evidence` in `chaincode-v2/` (P-03, P-09, P-10, P-11) | Accepted | Implementer (delegated) | **pending** |
| D-038 | 2026-11-19 | Inter-agency transfer needs both agencies: key-level endorsement (P-04) | Accepted | Implementer (delegated) | **pending** |
| D-039 | 2026-11-19 | Evidence store: MinIO, AES-256-GCM per file, content-addressed (P-05, P-06) | Accepted | Implementer (delegated) | **pending** |
| D-040 | 2026-11-19 | Hash in browser (SHA-256) and in gateway (SHA-256 + SHA3-256), mismatch rejected (P-07) | Accepted | Implementer (delegated) | **pending** |
| D-041 | 2026-11-19 | Port JCS/Merkle/hashing to JS with cross-tests against Python vectors (P-08) | Accepted | Implementer (delegated) | **pending** |
| D-042 | 2026-11-19 | New `gateway-v2/` and `frontend-v2/`; the authors' code stays untouched | Accepted | Implementer (delegated) | **pending** |
| D-043 | 2026-11-19 | Prototype login: local user file, scrypt-hashed passwords, in-memory sessions | Accepted | Implementer (delegated) | **pending** |
| D-044 | 2026-11-19 | BFT network rebuilt from scratch with per-chaincode service names | Accepted | Implementer (delegated) | **pending** |

---

## Decisions

### D-001 Build on Loffi et al.'s CustodyChain (Hyperledger Fabric)
- **Date:** 2026-10-18 (commit `c49b093`) · **Status:** Accepted · **Decided by:** User
- **Context:** Two candidate base systems were in the project: Chain4ensic (Pezzoni et al., WiMob 2025: Ethereum, IoT network traces) and CustodyChain (Loffi et al., ICOIN 2025: Hyperledger Fabric, digital evidence).
- **Decision:** Build on CustodyChain; Chain4ensic was removed from the repository.
- **Rationale (reconstructed, please confirm):** a permissioned ledger suits multi-agency evidence handling (known participants, no fees, certificate identities); public code; the paper claims a fully operational implementation.
- **Alternatives:** Chain4ensic (Ethereum: public-access notifications, but harder to keep case data private).

### D-002 Reproduce the authors' system as published
- **Date:** 2026-11-17 (commit `17da027`) · **Status:** Accepted · **Decided by:** User
- **Context:** The professor needed to see how the authors' system actually works before deciding what to keep.
- **Decision:** Run the authors' chaincode, gateway and UI logic unmodified (verified byte-identical to GitHub). Only run-only changes are allowed: the CCaaS `Dockerfile` and `.dockerignore`, and the frontend URL changed from the dead cloud IP to `localhost:3000`.
- **Consequences:** the baseline shows the authors' real behaviour, including its bugs (D-004).

### D-003 Deploy chaincode as a service (CCaaS)
- **Date:** 2026-11-17 · **Status:** Accepted · **Decided by:** Implementer (committed at the user's request)
- **Context:** On Docker 29+, `network.sh deployCC` fails (`write unix … docker.sock: broken pipe`): the Fabric peer's built-in image build uses a protocol that Docker 29 rejects.
- **Decision:** Run chaincode as an external service (`deployCCAAS`) using a Dockerfile that serves the unmodified chaincode. The BFT network uses the same approach.
- **Alternatives:** downgrade Docker (affects the whole machine; not durable).

### D-004 Keep the authors' bugs in the baseline
- **Date:** 2026-11-17 · **Status:** Accepted · **Decided by:** Implementer (used in the 2026-11-18 meeting)
- **Context:** `TransferAsset` fails because `new Date()` makes the two orgs' endorsements differ; `UpdateAsset` overwrites records.
- **Decision:** Do not fix these in the reproduced baseline; they are findings. Fixes live in improved versions (`stash@{0}` today, chaincode v2 later).

### D-005 One `main` branch
- **Date:** 2026-11-17 · **Status:** Accepted · **Decided by:** User
- **Decision:** All work is committed directly to `main`; no feature branches.

### D-006 Documents as files in the repository
- **Date:** 2026-11-17 · **Status:** Accepted · **Decided by:** User
- **Decision:** No hosted pages or artifacts unless explicitly requested; analysis goes in the terminal or as files in the repo.

### D-007 Fix the upstream `network.sh` chaincode-cleanup bug
- **Date:** 2026-11-17 (commit `41f3b21`) · **Status:** Accepted · **Decided by:** User
- **Context:** Hyperledger's sample quoted the container-ID list in `docker kill "$(…)"`, so with two chaincode containers nothing was removed. Stale containers then served an old package ID and every transaction hung (the "Create button does nothing" problem).
- **Decision:** Fix the script (`docker rm -f $(…)` without quotes).

### D-008 Keep the infrastructure, rebuild the domain logic
- **Date:** 2026-11-17; presented 2026-11-18 · **Status:** Accepted · **Decided by:** Implementer analysis, adopted by the user
- **Decision:**
  - **Keep:** the Fabric network scripts, the gateway connection layer, the toolchain, and the stash fixes.
  - **Rebuild:** the evidence model, custody rules, identity, multi-agency structure, off-chain storage, verification and evaluation.
- **Rationale:** the authors' own code is about 370 lines on a Hyperledger sample, and the domain logic either doesn't exist or contradicts the paper's claims.
- **Note:** the professor's response to this point was not recorded. Please add it if relevant.

### D-009 BFT consensus with four consensus nodes
- **Date:** meeting 2026-11-18; decided 2026-11-19 (commit `ab0c9a5`) · **Status:** Accepted · **Decided by:** Professor (4 is the minimum) + User (BFT)
- **Context:** The professor asked for about 20 consensus nodes and whether Kafka was used. Finding: the authors' network used **Raft with a single orderer**, not Kafka (Kafka was removed in Fabric 3.0). The professor then gave 4 as the minimum.
- **Decision:** SmartBFT ordering with **n = 4** orderers, so f = 1 faulty or malicious node is tolerated, with a quorum of 3.
- **Alternatives:**
  - Raft: tolerates crashes but assumes no node lies; 3 nodes for f = 1.
  - Kafka: not available in Fabric 3.
  - 20 nodes: more than the laptop phase needs; 7 nodes (f = 2) is the next step if required.
- **Evidence:** `network-bft/test-bft.sh`: tolerates 1 orderer down, halts safely with 2 down, survives a leader change, persists.

### D-010 Model real agencies (test phase)
- **Date:** 2026-11-19 (commit `ab0c9a5`) · **Status:** Accepted · **Decided by:** User; topology by the implementer (**review pending**)
- **Decision:**
  - Police, FSL, Court and Prosecution each operate one BFT orderer.
  - Police, FSL and Court each operate one peer.
  - Prosecution has no peer for now (see P-11).
- **Rationale:** no single agency controls ordering, and the three agencies that physically handle evidence keep ledger copies and endorse.

### D-011 Single laptop for the test phase
- **Date:** 2026-11-19 · **Status:** Accepted · **Decided by:** User
- **Consequences:** all nodes run in Docker on one host; the whole BFT network uses about 370 MiB RAM, so 7 orderers would also fit.

### D-012 Persistence: survive restarts; keep an explicit wipe
- **Date:** 2026-11-19 (commit `15d2dde`) · **Status:** Accepted · **Decided by:** User (scope "a"; keep the wipe command)
- **Context:** `network.sh down` was the only stop command and deleted the ledger volumes and certificates, so all hashes and history were lost.
- **Decision:**
  - `network.sh stop`/`start` stop and resume without deleting anything; chaincode containers are no longer started with `--rm`.
  - `down` remains the explicit wipe and now warns before running.
  - Out of scope for now: node-loss recovery and backups (scopes "b" and "c").
- **Evidence:** identical heights and hashes after stop/start and after `docker kill` (simulated power loss), on both networks.

### D-013 Order of work
- **Date:** 2026-11-19 · **Status:** Accepted · **Decided by:** User
- **Decision:** persistence → report and input specification → BFT network. All three are done (`PLAN.md`).

### D-014 Two-layer fingerprinting model
- **Date:** 2026-11-19 (commit `065c685`) · **Status:** Accepted · **Decided by:** User ("both")
- **Context:** Physical evidence can't be hashed, and no two photographs of it are ever identical.
- **Decision:**
  - **L1 integrity:** exact hashes of every captured file (photo, scan, 3D scan, video, image). This proves records are unaltered.
  - **L2 identity:** tolerant comparison of new captures against the L1-frozen reference captures (perceptual hash, 3D deviation, seal IDs). This gives evidence that the item is the same one.
  - L2 results are themselves recorded as events, with the hashes of the new captures.
- **Consequence:** L2 is never used to establish integrity. The worked example shows a digitally altered photo that L2 cannot detect.

### D-015 SHA-256 and SHA3-256 for every artefact
- **Date:** 2026-11-19 · **Status:** Accepted · **Decided by:** Implementer · **Review: pending**
- **Decision:** Two digests per artefact from unrelated hash families (SHA-2, Keccak). MD5 and SHA-1, which the BSA Schedule still lists, are kept only as cross-references from legacy tools.
- **Rationale:** both MD5 and SHA-1 have practical collisions; the second digest gives algorithm agility; SHA-256 is named on the BSA s.63 certificate.
- **Alternatives:** SHA-256 only (simpler; no fallback if SHA-2 weakens).

### D-016 What goes on-chain
- **Date:** 2026-11-19 · **Status:** Accepted · **Decided by:** Professor's brief (evidence off-chain, events on-chain) + Implementer details · **Review: pending**
- **Decision:**
  - **On-chain:** `evidence_id`, class, parent, `manifest_sha256`, `merkle_root`, artefact count, and the custody events. The actor and time of each event come from the transaction.
  - **Off-chain:** all files, full manifests, and all personal data (witnesses, accused, victims).
- **Rationale:** confidentiality; ledger size; DPDP Act retention and erasure (an off-chain record can be deleted while the ledger keeps a commitment that reveals nothing).

### D-017 Canonical manifest: RFC 8785 JCS, no floats
- **Date:** 2026-11-19 · **Status:** Accepted · **Decided by:** Implementer · **Review: pending**
- **Decision:** The manifest hash is SHA-256 over the RFC 8785 canonical JSON. Decimals are strings and floats are rejected, so every implementation produces identical bytes.
- **Consequence:** the gateway's implementation (JavaScript) must be cross-tested against the Python reference (roadmap M4).

### D-018 Salted RFC 6962 Merkle tree over artefacts
- **Date:** 2026-11-19 · **Status:** Accepted · **Decided by:** Implementer · **Review: pending**
- **Decision:**
  - Leaf = 32-byte random salt ‖ artefact ID ‖ SHA-256.
  - The tree is built exactly as in Certificate Transparency (domain-separated), with RFC 9162 inclusion proofs.
- **Rationale:**
  - A single artefact (e.g. one notebook page) can be proven without revealing the others.
  - The salts stop anyone holding a known file from confirming it is part of a case using ledger data alone.
  - Damage is localised to the exact artefact.

### D-019 Twelve evidence classes (provisional)
- **Date:** 2026-11-19 · **Status:** Accepted · **Decided by:** Implementer proposal, accepted by the user ("will add or remove later")
- **Decision:** scene photograph, A/V recording, CCTV export, physical document, physical item, bio/trace sample, digital device, forensic image, mobile extraction, cloud data, IoT log, procedural document.

### D-020 Identity-check (L2) methods and thresholds
- **Date:** 2026-11-19 · **Status:** Accepted (illustrative) · **Decided by:** Implementer · **Review: pending**
- **Decision:**
  - **Methods:** 64-bit DCT pHash for page scans and photos; ICP-aligned **symmetric** 3D deviation for objects; exact matching of seal, label and serial numbers.
  - **Thresholds:** pHash distance ≤ 10; 3D RMS ≤ 0.60 mm and maximum ≤ 3.00 mm.
  - The thresholds are illustrative only, calibrated on synthetic data.
- **Lesson recorded:** a one-directional 3D comparison accepted a damaged knife, because missing material produces no points to measure. The comparison must be symmetric.
- **Follow-up:** calibrate on real captures (report O3).

### D-021 Input specification as JSON Schema
- **Date:** 2026-11-19 · **Status:** Accepted · **Decided by:** Implementer (to meet the user's "well-defined inputs") · **Review: pending**
- **Decision:** JSON Schema (draft 2020-12) for the evidence manifest (12 classes) and custody events. The report's Appendix A is generated from the schemas so the two can't drift apart. The fields mirror the BSA s.63 Schedule certificate.

### D-022 Report format and scope
- **Date:** 2026-11-19 · **Status:** Accepted · **Decided by:** User
- **Decision:** LaTeX report in `outputs/report/`, for internal discussion with the professor, as rigorous as possible, covering BNSS/BSA and e-Sakshya.

### D-023 Separate BFT network; keep the authors' network unchanged
- **Date:** 2026-11-19 (commit `ab0c9a5`) · **Status:** Accepted · **Decided by:** Implementer · **Review: pending**
- **Decision:** The new network lives in `backend/network-bft/`. `backend/network/` keeps the paper-reproduction network, which still demos.
- **Consequence:** the two share ports, so only one runs at a time.

### D-024 Fabric 3.1.5
- **Date:** 2026-11-19 · **Status:** Accepted · **Decided by:** Implementer · **Review: pending**
- **Context:** BFT ordering requires Fabric v3; 3.1.5 (June 2026) was the latest release. The authors' network stays on 2.5.9.
- **Decision:** Binaries in `backend/bin/v3.1.5/`; images `fabric-orderer/peer:3.1.5`.

### D-025 `cryptogen` identities; separate orderer and peer MSPs per agency
- **Date:** 2026-11-19 · **Status:** Accepted for the test phase · **Decided by:** Implementer · **Review: pending**
- **Decision:**
  - Identities are generated with `cryptogen`.
  - Each agency's orderer and peer get separate MSPs (e.g. `PoliceOrdererMSP` and `PoliceMSP`).
- **Rationale:** simplest working BFT setup; the Fabric sample also uses cryptogen for BFT.
- **Limitation:** cryptogen can't put roles into certificates, so it will be revisited in roadmap M1 (P-02).

### D-026 Default endorsement: majority of agency peers
- **Date:** 2026-11-19 · **Status:** Accepted (interim) · **Decided by:** Implementer · **Review: pending**
- **Decision:** `MAJORITY Endorsement`, which is 2 of 3 peers, for every write.
- **To revisit:** inter-agency transfers should require both the sending and the receiving agency (P-04).

### D-027 Court orderer on port 11050
- **Date:** 2026-11-19 · **Status:** Accepted · **Decided by:** Implementer
- **Context:** port 9050 is held by a local Tor service; the decision was to change our port rather than touch the system service.

### D-028 Deterministic chaincode packages
- **Date:** 2026-11-19 · **Status:** Accepted · **Decided by:** Implementer
- **Context:** re-packaging produced a new package ID (gzip timestamps), and the peer refused containers serving it, so transactions hung.
- **Decision:**
  - Packages are built with fixed mtime and owner, and gzip without timestamps.
  - Chaincode services always use the package ID the channel **approved**.

### D-029 Gateway paths configurable by environment variables
- **Date:** 2026-11-19 (commit `ab0c9a5`) · **Status:** Accepted · **Decided by:** Implementer · **Review: pending**
- **Decision:** `KEY_DIRECTORY_PATH`, `CERT_DIRECTORY_PATH` and `TLS_CERT_PATH` can override the authors' hardcoded `User1@org1` paths; the defaults are unchanged. This lets the same web app run on the BFT network.
- **Note:** this is a small change to an authors' file. The baseline behaviour is unchanged.

### D-030 BFT block validation: peer-side enforcement to be verified
- **Date:** 2026-11-19 · **Status:** Open · **Decided by:** Implementer · **Investigate**
- **Context:**
  - The channel keeps `BlockValidation: ANY Writers`, as in the Fabric BFT sample; Fabric 3.1.5 has no special BFT policy type.
  - Verified: every block carries **3 consenter signatures** (a quorum).
  - Not yet verified: that peers **reject** a block carrying fewer.
- **Next step:** confirm from Fabric documentation and source, or with a test, before claiming in the report that a single malicious orderer cannot get a block accepted by peers.

### D-031 Every decision is recorded in this log
- **Date:** 2026-11-19 · **Status:** Accepted · **Decided by:** User
- **Decision:** From now on, every decision is added here when it is taken, before or together with the commit that implements it. Implementer decisions stay marked "Review: pending" until the user confirms them.

### D-032 Autonomous run M0–M5 on a separate branch
- **Date:** 2026-11-19 · **Status:** Accepted · **Decided by:** User
- **Decision:** The user delegated M0–M5 of `ROADMAP.md` to an autonomous run, asking for every decision to be documented and the work to go on **a different branch**. Work happens on `prototype/m0-m5`.
- **Relation to D-005:** this is a user-requested exception to "one `main` branch" for this run. Merging back to `main` is left to the user after review.

### D-033 Open choices resolved with the recommended options
- **Date:** 2026-11-19 · **Status:** Accepted · **Decided by:** Implementer, with the user's delegation ("do as much as you can in auto mode") · **Review: pending**
- **Decision:** P-01 to P-12 are resolved with the recommendation listed for each (entries D-034 to D-043).
- **P-12 (build order):** the user asked for at least M5, so the build follows the full M0–M5 path. The UI concentrates on four evidence classes (scene photograph, physical document, physical item, digital device); the API accepts all 12 classes through the schema.

### D-034 Apply `stash@{0}` as the "improved v1" baseline (P-01)
- **Date:** 2026-11-19 · **Status:** Accepted · **Decided by:** Implementer (delegated) · **Review: pending**
- **Decision:** The stash (deterministic timestamps, `GetAssetHistory`, `/asset/:id/history`, forensic UI) is applied and committed on the branch as the fixed version of the authors' system.
- **Conflicts:**
  - `App.svelte`: takes the stash version, which already uses `localhost:3000`.
  - `app.js`: keeps both the env-var paths (D-029) and the history route.
- **Rationale:** a comparable "paper, fixed" version is useful for evaluation, and its UI ideas carry over to `frontend-v2`.

### D-035 Users and roles: Fabric CA per agency, reusing the cryptogen org CA (P-02)
- **Date:** 2026-11-19 · **Status:** Accepted · **Decided by:** Implementer (delegated) · **Review: pending**
- **Context:** cryptogen can't put attributes (roles) into certificates.
- **Decision:**
  - A `fabric-ca-server` (v1.5.12) per peer agency (Police, FSL, Court) is started **with that agency's existing cryptogen CA certificate and key**. Users it enrols are therefore trusted by the existing MSPs without changing the channel.
  - Users are registered as type `client` with an `ecert` attribute `role=<role>`; the chaincode reads it via `ctx.clientIdentity.getAttributeValue('role')`.
  - The CA servers listen on localhost without TLS (prototype only).
- **Alternatives:** a fresh Fabric CA hierarchy (would mean regenerating the channel MSPs); certificates hand-made with OpenSSL carrying the attribute extension (fragile).

### D-036 Role model and prototype users
- **Date:** 2026-11-19 · **Status:** Accepted · **Decided by:** Implementer (delegated) · **Review: pending**
- **Roles:**
  - `io`: Police investigating officer. Registers evidence.
  - `malkhana`: Police property-store in-charge. Custodian; can seal and reseal.
  - `examiner`: FSL examiner. Examines, derives, verifies identity.
  - `court_clerk`: Court property clerk. Receives, records submission, return and disposal.
- **Rules applying to everyone:**
  - Any holder of a role may read, record `ACCESS`, and run `VERIFY_INTEGRITY`.
  - Custody actions (transfer, seal, examine, dispose…) are allowed only for the **current custodian**.
  - Only the named receiver may accept or reject a transfer.
- **Users:** `io.sharma` and `malkhana.desai` (Police), `examiner.mehta` (FSL), `clerk.rao` (Court).
- **Prosecution:** has an orderer but no peer or users yet (P-11).

### D-037 New evidence chaincode `evidence` (JavaScript) in `chaincode-v2/`
- **Date:** 2026-11-19 · **Status:** Accepted · **Decided by:** Implementer (delegated) · **Review: pending**
- **Language (P-03):** JavaScript, the same toolchain as the authors.
- **Data model:**
  - An evidence record holds `evidence_id`, class, case reference, parent, `manifest_sha256`, `merkle_root`, artefact count, spec version, current custodian (MSP + certificate subject + role), status, and any pending transfer.
  - Events are separate append-only keys `event~<evidence_id>~<seq>`. Each event's actor comes from the certificate and its time from `getTxTimestamp()`.
  - Indexes support listing by case, by custodian and by pending receiver.
- **Scope choices:**
  - **5W1H dropped (P-09).** Its content is carried by the manifest and the event fields.
  - **One channel for all agencies (P-10).** Only fingerprints are stored on-chain.
  - **No Prosecution peer (P-11).**
- **Kept as is:** the authors' `chaincode/` (`custody`/`basic`), for reproduction.

### D-038 Inter-agency transfer requires both agencies (key-level endorsement, P-04)
- **Date:** 2026-11-19 · **Status:** Accepted · **Decided by:** Implementer (delegated) · **Review: pending**
- **Decision:**
  - `InitiateTransfer` sets a key-level (state-based) endorsement policy on the evidence key requiring peers of **both** the sending and the receiving agency.
  - `AcceptTransfer`/`RejectTransfer` must therefore be endorsed by both. The gateway names the two organisations as endorsers.
  - After acceptance, the key's policy becomes "new custodian's agency".
- **Rationale:** neither agency alone can fabricate or complete a handover.

### D-039 Evidence store: MinIO, per-file AES-256-GCM, content-addressed (P-05, P-06)
- **Date:** 2026-11-19 · **Status:** Accepted · **Decided by:** Implementer (delegated) · **Review: pending**
- **Decision:**
  - A MinIO (S3-compatible) container on the BFT Docker network, with a named volume. It is included in `network.sh stop`/`start`.
  - Each file is encrypted in the gateway with a fresh AES-256-GCM key. That key is wrapped (AES-256-GCM) with the uploading agency's master key, which is read from a local file (prototype).
  - Objects are named by the SHA-256 of the plaintext and are never overwritten. Manifests are stored the same way.
- **Limitation:** master keys on local disk. Production needs a KMS or HSM.

### D-040 Hashing in browser and gateway (P-07)
- **Date:** 2026-11-19 · **Status:** Accepted · **Decided by:** Implementer (delegated) · **Review: pending**
- **Decision:**
  - The browser computes SHA-256 (WebCrypto) of each file before upload and sends it with the file.
  - The gateway recomputes SHA-256 and SHA3-256 while streaming, and **rejects the upload if the SHA-256 differs**.
- **Note:** WebCrypto has no SHA3, so SHA3-256 is computed by the gateway only.

### D-041 Port the reference logic to JavaScript with cross-tests (P-08)
- **Date:** 2026-11-19 · **Status:** Accepted · **Decided by:** Implementer (delegated) · **Review: pending**
- **Decision:** JCS, the salted RFC 6962 Merkle tree with inclusion proofs, and the file hashing are implemented in `gateway-v2/src/lib/`.
- **Cross-check:** a test recomputes the manifest hash and Merkle root of every example manifest produced by the Python reference (`outputs/spec/examples/`) and must match it exactly.
- **Identity checks (L2, M6):** these stay in Python.

### D-042 New `gateway-v2/` and `frontend-v2/`
- **Date:** 2026-11-19 · **Status:** Accepted · **Decided by:** Implementer (delegated) · **Review: pending**
- **Decision:** The new API and UI are new directories. Both keep the authors' stack (Express + `@hyperledger/fabric-gateway`; Svelte 5 + Vite + Tailwind 3, P-08 of the UI). The authors' `gateway/` and `frontend/` are untouched apart from D-029 and D-034.

### D-043 Prototype authentication
- **Date:** 2026-11-19 · **Status:** Accepted · **Decided by:** Implementer (delegated) · **Review: pending**
- **Decision:**
  - Users log in with a username and password listed in a local `users.json`, with scrypt-hashed passwords.
  - The gateway keeps an in-memory session token and acts on the ledger with **that user's own Fabric certificate**, never a shared identity.
- **Limitation:** not production authentication. Real deployment would use agency SSO or a hardware token bound to the certificate.

### D-044 BFT network rebuilt with per-chaincode service names
- **Date:** 2026-11-19 · **Status:** Accepted · **Decided by:** Implementer (delegated) · **Review: pending**
- **Context:** chaincode service containers were named `<agency>-cc`, so two chaincodes couldn't run side by side.
- **Decision:**
  - Services are named `<agency>-<chaincode>-cc`, and `network.sh all` now also starts the CAs, enrols users, starts MinIO and deploys both `custody` (authors') and `evidence` (v2).
  - The test network was wiped and rebuilt. It held only test records from `test-bft.sh`.

---

## Open decisions needed for the roadmap

> **Status 2026-11-19:** all P-01..P-12 were resolved with the recommended option for the autonomous run (D-033 to D-043, review pending). The table is kept as a record of the options.

| ID | Question | Options | Recommendation | Blocks |
|---|---|---|---|---|
| P-01 | What to do with `stash@{0}` (deterministic timestamps, history route, forensic UI) | (a) commit to `main` as the "improved v1" baseline; (b) drop it, since v2 supersedes it | **(a):** keeps a comparable fixed version of the paper and its UI is the starting point for M5 | M0, M5 |
| P-02 | How users get identities and roles | (a) Fabric CA per agency, with role attributes in certificates; (b) keep cryptogen (agency-level identity only) | **(a)** for the full build; **(b)** acceptable for the thin slice | M1, M2 |
| P-03 | Chaincode language for v2 | (a) JavaScript (as the authors); (b) Go (Fabric's primary language) | **(a):** same toolchain and team familiarity | M2 |
| P-04 | Who must endorse an inter-agency transfer | (a) channel majority only; (b) key-level policy: both sender and receiver agencies | **(b):** no single agency can fabricate a handover | M2 |
| P-05 | Off-chain evidence store | (a) MinIO (S3-compatible); (b) private IPFS cluster; (c) local encrypted files | **(a)** for the full build; **(c)** for the thin slice | M3 |
| P-06 | Encryption and key custody | (a) per-file AES-256-GCM keys wrapped by an agency key held by the gateway (prototype); (b) external KMS/HSM | **(a)**, with the limitation documented | M3 |
| P-07 | Where files are hashed | (a) gateway only; (b) browser before upload **and** re-hashed by the gateway, rejecting any mismatch | **(b):** closer to capture, and a cross-check | M4, M5 |
| P-08 | Gateway hashing logic | (a) port JCS, Merkle and hashing to JavaScript with cross-tests against the Python reference; (b) call the Python tool from Node | **(a)** for the core; Python as a service only for L2 (M6) | M4 |
| P-09 | The authors' 5W1H fields in v2 | (a) drop (replaced by manifest + events); (b) keep as free-text notes | **(a)**; the 5W1H content is covered by the manifest and event fields | M2 |
| P-10 | Visibility between agencies | (a) one channel, all agencies see all ledger records (fingerprints only); (b) private data collections per case | **(a)** for the prototype; (b) later | M2 |
| P-11 | Does Prosecution get a peer? | (a) orderer only; (b) add a peer that endorses court submissions | **(a)** for now | M2 |
| P-12 | Build order | (a) thin vertical slice first (2 evidence classes, about 3–4 weeks), then deepen; (b) full build layer by layer (about 2–3 months) | **(a)** | all |
