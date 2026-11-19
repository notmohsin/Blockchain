# CustodyChain: post-meeting work plan (2026-11-19)

These are the decisions agreed after the meeting with the professor.

| # | Decision |
|---|---|
| Consensus | **BFT**, **4 consensus (orderer) nodes**. That is the minimum for BFT: n = 3f + 1, with f = 1 node that may fail or misbehave. |
| Organisations | Model real agencies (test phase): each consensus node and each peer belongs to a named agency. |
| Hardware | This laptop only (15 GB RAM, 12 cores). |
| Persistence | It must survive a laptop or Docker restart (scope "a"). Keep a separate, explicit "wipe everything" command. |
| Report | LaTeX, in `outputs/`, for internal discussion with the professor, as rigorous as possible. It must cover the Indian legal framework, both kinds of fingerprint (integrity hash and identity fingerprint), and per-type hashing for each class of evidence. |
| Inputs | A well-defined set of inputs per evidence type and lifecycle stage, specifying how each type's hash is computed (e.g. crime-scene photo ≠ recovered notebook). |
| Order | Persistence → report and input spec → BFT and 4 orderers. |

---

## Phase 1: Persistent ledger (current Raft network, carried over to BFT)

**Problem.** `network.sh down` deletes the ledger volumes and all crypto material. The chaincode containers are started with `--rm`, so stopping them removes them.

1. `network.sh stop`: stop every container (CAs, orderers, peers, chaincode). **Nothing is deleted.**
2. `network.sh start`: start them again in dependency order (CAs → orderers → peers → chaincode).
3. `deployCCAAS.sh`: run the chaincode containers **without `--rm`** so they survive a stop or start, and remove any stale container before `docker run`.
4. `network.sh down`: unchanged (it stays the wipe command), but it now prints an explicit warning.
5. **Verify:** create a record, note the block height and hash, then `stop` and `start`. The same record, height and hashes must come back, and the gateway must work again without re-deploying.
6. Commit to `main`.

## Phase 2: LaTeX report and evidence input specification (`outputs/report/`)

Report: *Evidence Fingerprinting and Chain of Custody on a Permissioned Ledger*.

1. Problem framing: what a hash proves and what it does not; threat model.
2. Cryptographic background:
   - hash properties
   - SHA-256 and SHA-3
   - Merkle trees
   - canonical serialisation (RFC 8785)
   - signatures and trusted time
3. **The two-layer model:**
   - **L1 integrity hash.** An exact cryptographic hash of each captured *artefact* (file, scan, image). It proves the record has not been altered.
   - **L2 identity fingerprint.** A tolerant comparison of the *physical item* against its reference capture: perceptual hashes, 3D-scan matching, seals, tags. It proves the item is the same one.
   - **Evidence manifest.** A canonical record of all the artefacts and metadata, with a Merkle root. The root goes on the ledger.
4. Per-type procedures (inputs, capture, what is hashed, verification). Types:
   - crime-scene photographs
   - video and CCTV
   - physical documents (e.g. a recovered notebook)
   - general physical items, including 3D scans
   - biological and trace samples
   - devices and disk images
   - mobile extractions
   - cloud and social-media data
   - IoT and log data
   - procedural paperwork (seizure memo, forensic report)
5. Derived evidence and the provenance graph (parent → child hashes).
6. Lifecycle events and what each one records.
7. Indian legal and procedural mapping: BNSS 2023 (§105, §176(3), …), BSA 2023 (§§61–63 and the Schedule certificate), e-Sakshya, and the SOP for audio-visual recording.
8. Network and consensus: BFT, the 4-node rationale, mapping agencies to nodes, persistence.
9. Limitations and open questions:
   - garbage in at collection
   - collisions in perceptual fingerprints
   - privacy of low-entropy data
   - algorithm agility
   - DPDP Act vs an immutable ledger
10. Appendices:
    - the input specification (tables)
    - a worked example with real computed hashes
11. Machine-readable spec: JSON Schema per evidence type in `outputs/spec/`, and a reference hashing tool in `outputs/tools/` used to produce the report's worked examples.
12. Compile to PDF with `latexmk` and commit to `main`.

## Phase 3: BFT consensus with 4 orderers and real organisations

1. Upgrade the Fabric binaries and images 2.5.9 → **3.1.5** (BFT ordering requires Fabric v3). Smoke-test the existing Raft network on 3.1.5 first.
2. Organisation model (test phase), with each agency running one consensus node and, where relevant, one peer:

   | Agency | Orderer (BFT consenter) | Peer |
   |---|---|---|
   | Police (investigating agency) | orderer.police | peer0.police |
   | FSL (forensic science laboratory) | orderer.fsl | peer0.fsl |
   | Court (judiciary) | orderer.court | peer0.court |
   | Prosecution | orderer.prosecution | (none at first) |

   No single agency controls ordering. BFT tolerates one faulty or malicious consenter.
3. New crypto config, `configtx` (BFT profile), compose files, env scripts and connection profile. The gateway connects to the Police peer.
4. Deploy the authors' chaincode via CCaaS on all peers. The endorsement policy (majority) is defined explicitly.
5. **Verify:**
   - all 4 consenters are in the channel config
   - transactions commit
   - with **1 orderer stopped**, the network still commits
   - with 2 stopped, it halts (as BFT predicts)
   - persistence (Phase 1) works on the BFT network
6. Measure memory use, update the docs, and commit to `main`.
