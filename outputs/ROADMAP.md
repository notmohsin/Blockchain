# CustodyChain: roadmap to a working prototype

*Last updated 2026-11-19. Decisions are logged in [`DECISIONS.md`](DECISIONS.md). Completed phases 1–3 are in [`PLAN.md`](PLAN.md).*

> **Status:** **M0–M5 are done** on branch `prototype/m0-m5` (autonomous run, D-032). How to run and test it: [`CustodyChain/PROTOTYPE.md`](../CustodyChain/PROTOTYPE.md).
>
> | Milestone | Commit | Evidence |
> |---|---|---|
> | M0 | `ad6c409`, `468b836` | docs committed; stash applied as "improved v1" (D-034) |
> | M1 | `05e8b18` | agency CAs; role users; the chaincode reads `role` from the certificate |
> | M2 | `dcd9410` | evidence chaincode, 18/18 unit tests |
> | M3 + M4 | `ac9610f` | encrypted store + API; 34/34 end-to-end checks on the live BFT network, including the D-038 endorsement attack |
> | M5 | `818b4af` | UI; 24/24 browser checks |
>
> **Remaining:** M6 (identity checks run by the app), M7 (court outputs), M8 (benchmarks and formal tamper suite), M9 (report chapters).

## 1. Where we are

| Layer | State today | What the prototype needs |
|---|---|---|
| Network | ✅ BFT network: 4 agency orderers, 3 peers, persistent, tested (`network-bft/`) | Users with roles (not just one `User1` per agency) |
| Design | ✅ Report, two-layer fingerprinting model, legal mapping (`outputs/report/`) | Implementation and evaluation chapters once built |
| Input spec | ✅ JSON Schemas for 12 evidence classes and custody events (`outputs/spec/`) | Enforced by the gateway and (partly) the chaincode |
| Hashing logic | ✅ Python reference tool, tested (`outputs/tools/`) | Same logic in the gateway, proven byte-compatible |
| Chaincode | ❌ Still the authors' 5W1H `asset-transfer` (mutable records; transfer broken) | **New evidence-registry chaincode** |
| Evidence storage | ❌ None: files are not stored anywhere | **Encrypted off-chain store** |
| Gateway (API) | ⚠️ Authors' 4 routes, one shared identity | **New API**: per-user identity, upload and hash, register, transfer, verify, report |
| UI | ⚠️ Authors' 3 screens (an improved UI exists in `stash@{0}`) | **New UI**: register wizard, custody timeline, transfer inbox, verify, report |
| Court outputs | ❌ None | Custody report; BSA s.63 Part A/B pre-filled |
| Testing / evaluation | ⚠️ Network tests only | Chaincode unit tests, end-to-end and tamper tests, benchmarks |

**Bottom line:** the foundations are in place (network, design, specification, reference hashing). The **application itself is not built yet**: chaincode, storage, API and UI. That is most of the remaining work.

## 2. What "working prototype" means (proposed acceptance scenario)

The prototype is done when this scenario runs end to end on the BFT network, entirely through the UI, and every step can be checked independently against the ledger.

> **Case FIR 123/2026, Cyber PS Gandhinagar**
> 1. **Police (IO)** registers two items: a **scene photograph** (file uploaded and hashed) and a **recovered notebook** (cover photo + page scans). Each item gets a validated manifest; files go to the encrypted store; `REGISTER` is written to the ledger.
> 2. Police seals the notebook (seal number recorded) and **initiates a transfer to FSL**.
> 3. **FSL (examiner)** sees the item in its inbox and **accepts** it, recording the seal number read and its condition.
> 4. FSL **re-scans the notebook pages**; the system runs **identity verification** (pHash against the reference scans) and records `VERIFY_IDENTITY: MATCH`.
> 5. FSL records the examination and attaches the report (hashed); custody returns to Police.
> 6. Police **submits to court**.
> 7. **Court (clerk/judge)** uploads the photograph produced in court; the system reports **MATCH** against the ledger. A tampered copy is reported as **NO MATCH**, naming which artefact differs.
> 8. Court downloads the **custody report** and the pre-filled **BSA s.63(4)(c) certificate** data.
> 9. Throughout, no user can act outside their role; each event's actor and time come from the certificate and the transaction, not from typed input.

## 3. Remaining work

Sizes are rough estimates of **focused working days** for one person, with Claude writing most of the code. Your review, testing and understanding of each piece is included and is usually the bottleneck. They are planning numbers, not commitments.

| # | Milestone | Main tasks | Done when | Size | Depends on |
|---|---|---|---|---|---|
| **M0** | Housekeeping | Commit the setup doc and meeting script; decide the fate of `stash@{0}` (P-01); push | Clean `main` on GitHub | 0.5–1 d | none |
| **M1** | Identities and roles | Fabric CA per agency on the BFT network; enrol users with role attributes (e.g. `io`, `malkhana`, `examiner`, `prosecutor`, `court_clerk`); wallet for the gateway | A user certificate carries `role=examiner`, and the chaincode can read it | 3–5 d | P-02 |
| **M2** | **Evidence-registry chaincode v2** | Evidence record (`manifest_sha256`, `merkle_root`, class, parent, custodian); append-only events (composite keys); `Register`, `InitiateTransfer`/`Accept`/`Reject`, `RecordEvent` (access, examine, verify, submit, dispose), `Derive`, `Correction`; actor from `ctx.clientIdentity`, time from `getTxTimestamp`; role and custodian checks; key-level endorsement so an inter-agency transfer needs both agencies; queries (by item, case, custodian); unit tests | All event types from `custody-event.schema.json` work; illegal actions are rejected; tests pass on the BFT network | 7–10 d | M1, P-03, P-04 |
| **M3** | Encrypted off-chain evidence store | MinIO (S3-compatible) container on the network; per-file encryption; content-addressed by SHA-256; never overwrite; access logged | Upload → stored encrypted → retrievable only through the API; re-hash equals the ledger | 3–5 d | P-05, P-06 |
| **M4** | **Gateway / API v2** | Login mapped to wallet identities; upload and stream-hash (SHA-256 + SHA3-256); manifest build and JSON-Schema validation (ajv); port JCS and salted Merkle tree to JS, **cross-tested against the Python reference vectors**; endpoints for every event; verify-a-file; inclusion proofs; error handling and timeouts | The acceptance scenario runs via `curl`; JS and Python produce identical manifest hashes and roots | 7–10 d | M2, M3, P-07 |
| **M5** | **UI v2** | Role-aware screens: register wizard (photo, notebook, physical item, device, A/V), hashes shown before upload, custody timeline, transfer inbox (accept/reject with seal check), verify-a-file, item and case search; build on the stash UI | Acceptance scenario runs through the browser | 7–10 d | M4, P-08 |
| **M6** | Identity-verification service | Wrap the Python L2 functions (pHash, 3D comparison) as a small service called by the gateway; results recorded as `VERIFY_IDENTITY` | Step 4 of the scenario works from the UI | 3–4 d | M4 |
| **M7** | Court outputs | Custody report (PDF/HTML) generated from ledger events and manifests; BSA s.63 Part A/B fields pre-filled; verification instructions for a third party | Step 8 works; the report verifies independently with `evidence_hash.py` | 3–4 d | M4 |
| **M8** | Testing and evaluation | End-to-end script for the scenario; tamper suite (file swap, manifest rewrite, illegal transfer, wrong role, broken seal); Hyperledger Caliper benchmarks (throughput and latency, BFT-4 vs Raft-1; 4 vs 7 orderers) | Reproducible results tables | 5–7 d | M2–M7 |
| **M9** | Documentation | Keep `DECISIONS.md` current (continuous); report chapters "Implementation" and "Evaluation"; user guide; update setup doc | Report v1.0 for the professor | 3–4 d (+ continuous) | M8 |

**Total: about 40–60 working days**, i.e. roughly **2–3 months** at a steady pace.

The critical path is **M1 → M2 → M4 → M5 → M8**. M3 can be built in parallel with M2, and M6 and M7 in parallel with M5.

### A faster option: a thin vertical slice first (about 3–4 weeks)

To have something demonstrable at the next meeting, build the acceptance scenario for **two evidence classes only** (scene photograph and physical document), with these cuts:
- **Roles at agency level only.** The identity is the MSP (Police, FSL, Court), with no per-user roles yet. This skips most of M1.
- **Simpler storage.** An encrypted local file store instead of MinIO.
- **Manual identity check.** The examiner records the identity check by hand; the comparison tool is run from the command line.
- **Simpler report.** An HTML custody report, and no s.63 certificate generation yet.

Everything else (append-only events, two-phase transfer, verification against the ledger) stays. This is my recommendation. It makes the whole idea visible early, and the full version then deepens each layer.

## 4. Known issues to fix along the way
- Authors' gateway: `initializeGateway()` runs inside `app.listen`, so early requests fail (race on startup).
- Authors' UI: no timeouts or error handling (a hung network looks like a dead button).
- Authors' chaincode tests target the sample asset model; they will be replaced in M2.
- **To verify:** that Fabric v3 peers *reject* blocks that lack a BFT quorum of signatures. Today we have only verified that blocks *carry* 3 signatures (see D-030).
- L2 thresholds are illustrative; calibration needs real or realistically staged captures (report §10, O3).

## 5. Out of scope for the prototype (later)
Private data collections per case · certificate revocation and key-compromise handling · capture app or e-Sakshya integration · RFC 3161 trusted timestamps · L2 calibration study · multi-host deployment · scaling beyond 7 orderers.
