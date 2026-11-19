# CustodyChain: Setup, Troubleshooting & Critical Assessment

This document covers:
- how to run the **original authors' CustodyChain system** on a modern Linux machine;
- how to run **our BFT network**: four agencies, Fabric 3.1.5;
- how the ledger **persists**, and where the data actually lives;
- what breaks and how to fix it;
- **where the original system falls short** as a chain of custody for evidence;
- what we keep and what we rebuild.

| | |
|---|---|
| **Base paper** | L. Loffi, G. L. Camillo, C. M. Westphall, C. B. Westphall, *"Blockchain-Based Chain of Custody for Digital Evidence with Hyperledger Fabric"*, ICOIN 2025, IEEE. DOI: [10.1109/ICOIN63865.2025.10992690](https://doi.org/10.1109/ICOIN63865.2025.10992690) |
| **Authors' code** | <https://github.com/leandroloffi/CustodyChain> (last pushed 2024-12-04) |
| **Fidelity check** | `chaincode/lib/assetTransfer.js`, `gateway/src/app.js` and `frontend/src/App.svelte` were **byte-identical** to upstream when imported (verified by SHA-1 on 2026-11-17). Our run-only changes since then are listed in [§4](#4-running-the-original-system-raft-step-by-step). |
| **Verified environment** | Linux, Docker 29.9.2, Node v26.12.0 (host). Original network: Fabric 2.5.9, Fabric CA 1.5.12. BFT network: Fabric 3.1.5. |
| **Last updated** | 2026-11-19 |

### Other documents

| Where | What |
|---|---|
| `backend/network-bft/README.md` | BFT network: commands and test results |
| `../outputs/report/main.pdf` | Report: how evidence is fingerprinted (hashes for photos, notebooks, 3D items and so on), the Indian legal mapping, and the network design |
| `../outputs/spec/` | Input specification (JSON Schemas) for every evidence type |
| `../outputs/PLAN.md` | Post-meeting plan, with each phase's status |
| `PROTOTYPE.md` | **Prototype v2 (M0–M5):** how to run and test the new chaincode, API and UI |
| `../outputs/DECISIONS.md` | Every decision, with who made it and why |

---

## Contents

1. [TL;DR](#1-tldr)
2. [What is in this repository](#2-what-is-in-this-repository)
3. [Prerequisites](#3-prerequisites)
4. [Running the original system (Raft), step by step](#4-running-the-original-system-raft-step-by-step)
5. [Demo script (original system)](#5-demo-script-original-system)
6. [Persistence: where the data lives and how to keep it](#6-persistence-where-the-data-lives-and-how-to-keep-it)
7. [The BFT network (four agencies)](#7-the-bft-network-four-agencies)
8. [Troubleshooting](#8-troubleshooting)
9. [Shortcomings of the original system](#9-shortcomings-of-the-original-system)
10. [Salvage vs. rebuild, and progress so far](#10-salvage-vs-rebuild-and-progress-so-far)
11. [Talking points and meeting outcomes](#11-talking-points-and-meeting-outcomes)
12. [Our improved chaincode/UI: git stash](#12-our-improved-chaincodeui-git-stash)
13. [Quick reference](#13-quick-reference)

---

## 1. TL;DR

- The authors' system **does not run as published** on a current machine. Three environment problems block it: the CA config version, Docker 29 vs. the Fabric chaincode build, and a hardcoded dead server IP. The run-only fixes are **committed** (`17da027`). The authors' logic is untouched.
- Once it runs, **Create** and **View** work. **Transfer Custody, the paper's core feature, fails** on the standard 2-organisation network (`10 ABORTED: failed to collect enough transaction endorsements`). The cause is a non-deterministic `new Date()` inside the smart contract ([§8.4](#84-transfer-custody-fails-aborted-failed-to-collect-enough-transaction-endorsements)).
- **`UpdateAsset` silently overwrites any evidence record, and anyone can call it.** Several of the paper's claims (access control, access logging, integrity) are **not implemented** ([§9](#9-shortcomings-of-the-original-system)).
- **The ledger now persists.** `./network.sh stop` and `start` keep everything; only `down` wipes ([§6](#6-persistence-where-the-data-lives-and-how-to-keep-it)).
- **The BFT network exists.** It runs 4 consensus nodes (Police, FSL, Court, Prosecution) on Fabric 3.1.5 and passes all 8 tests: it survives one faulty node, stops safely with two, and survives a leader change and restarts ([§7](#7-the-bft-network-four-agencies)).
- **Not Kafka.** The original network uses **Raft** with **one** orderer, so it has no real consensus at all. Kafka was removed in Fabric 3.0.
- **Verdict.** Keep the infrastructure (Fabric network, gateway plumbing, toolchain). Rebuild the domain logic (evidence model, custody rules, identity, off-chain storage, verification).

---

## 2. What is in this repository

```
CustodyChain/
├── backend/
│   ├── bin/              Fabric 2.5.9 binaries (gitignored, must be present)
│   │   └── v3.1.5/       Fabric 3.1.5 binaries for the BFT network (gitignored)
│   ├── config/           core.yaml / orderer.yaml / configtx.yaml (2.5)
│   ├── network/          ORIGINAL: Hyperledger "test-network": 2 orgs, 1 Raft orderer, CAs
│   ├── network-bft/      OURS: 4 BFT orderers + 3 peers, one per agency (Fabric 3.1.5)
│   ├── chaincode/        Smart contract: lib/assetTransfer.js (~94 lines) + Dockerfile for CCaaS
│   └── gateway/          Express REST API: src/app.js (~130 lines, port 3000)
└── frontend/             Svelte + Vite UI: src/App.svelte (~150 lines, port 5173)
```

The paper's own contribution is about **370 lines**, a light adaptation of Hyperledger's `asset-transfer-basic` sample.

**Data model.** One mutable key/value record per item with the 5W1H fields:

```json
{ "ID": "...", "Who": "...", "What": "...", "When": "...", "Where": "...", "Why": "...", "How": "..." }
```

**Chaincode functions:** `InitLedger`, `CreateAsset`, `UpdateAsset`, `TransferAsset`, `GetAllAssets`, `AssetExists`.

**REST API (gateway, port 3000):**

| Method | Path | Chaincode call | Response message (Portuguese, original) |
|---|---|---|---|
| `GET` | `/assets` | `GetAllAssets` | JSON array |
| `POST` | `/asset` | `CreateAsset` | `Ativo criado com sucesso!` |
| `PUT` | `/asset/:id` | `UpdateAsset` | `Ativo atualizado com sucesso!` |
| `POST` | `/transferAsset` | `TransferAsset` | `Transferência de posse realizada com sucesso!` |

### The two networks

| | `backend/network` (original) | `backend/network-bft` (ours) |
|---|---|---|
| Purpose | Reproduce the paper exactly | The multi-agency network the professor asked for |
| Fabric | 2.5.9 | 3.1.5 |
| Consensus | Raft, **1 orderer** (no fault tolerance) | **SmartBFT, 4 orderers** (n=4, f=1, quorum 3) |
| Organisations | Org1, Org2 (`example.com`) | Police, FSL, Court, Prosecution (`*.custodychain.local`) |
| Peers | 2 | 3 (Police, FSL, Court) |
| Identities | Fabric CA | cryptogen |
| Channel / chaincode | `mychannel` / `basic` | `custody` / `custody` |
| Persistence | `stop`/`start` (§6) | `stop`/`start` (§7) |

The two networks share ports 7050 and 7051, so **run only one at a time.** Stop one with `./network.sh stop`, which keeps its data, before starting the other.

---

## 3. Prerequisites

| Tool | Version used | Notes |
|---|---|---|
| Docker Engine | 29.9.2 | Your user must be in the `docker` group (`sudo usermod -aG docker $USER`, then log out and back in) |
| Docker Compose | v2 plugin | `docker compose` |
| Node.js / npm | v26 on host (≥ 18 required) | The chaincode container uses `node:18-alpine` |
| jq, curl, git | any | Both `network.sh` scripts use `jq` |
| Fabric binaries (original) | 2.5.9 | `backend/bin/` (gitignored; Fabric's `install-fabric.sh`) |
| Fabric binaries (BFT) | 3.1.5 | `backend/bin/v3.1.5/`, from `hyperledger-fabric-linux-amd64-3.1.5.tar.gz` (`bin/`) |
| Fabric images | `fabric-peer/orderer:2.5.9`, `fabric-ca:1.5.12`; `fabric-peer/orderer:3.1.5` | Pulled on first start, or `docker pull` them |

**Ports.**
- Original network: `7050` (orderer), `7051` and `9051` (peers), `7054`/`8054`/`9054` (CAs).
- BFT network:
  - orderers `7050`, `8050`, `11050`, `10050` (admin ports `7053`, `8053`, `11053`, `10053`)
  - peers `7051`, `8051`, `9051`
  - operations `9443`–`9446`, `9451`–`9453`
- Apps: `3000` (gateway), `5173` (frontend).

---

## 4. Running the original system (Raft), step by step

These steps run the **authors' chaincode, gateway and UI logic unchanged**. Three run-only changes are already committed in `17da027`:
- `backend/chaincode/Dockerfile`
- `backend/chaincode/.dockerignore`
- the localhost URL in `frontend/src/App.svelte`

Our network-script fixes are also committed:
- `network.sh down` really removes the chaincode containers (`41f3b21`);
- `stop`/`start` persistence (`15d2dde`).

### Step 0: One-time checks

**a) Fabric CA version** (only if the CA containers exit at startup):

```bash
cd ~/Projects/Blockchain/CustodyChain/backend/network
grep -n "^version:" organizations/fabric-ca/*/fabric-ca-server-config.yaml
sed -i 's/^version: v1.5.22/version: v1.5.12/' organizations/fabric-ca/*/fabric-ca-server-config.yaml
```

**b) Chaincode-as-a-Service Dockerfile:** already in the repo. For reference:

```dockerfile
# backend/chaincode/Dockerfile: run-only wrapper serving the authors' unmodified chaincode as a service
FROM node:18-alpine
WORKDIR /usr/src/app
COPY package.json npm-shrinkwrap.json ./
RUN npm ci --omit=dev
COPY index.js ./
COPY lib ./lib
EXPOSE 9999
CMD npx fabric-chaincode-node server --chaincode-address=$CHAINCODE_SERVER_ADDRESS --chaincode-id=$CHAINCODE_ID
```

`.dockerignore` excludes `node_modules`, `coverage` and `.nyc_output`. The command lives in the Dockerfile, so the authors' `package.json` needs no `server` script.

**c) Frontend API URL:** already changed from the authors' dead `34.41.10.244` to `localhost:3000`.

### Step 1: First run or resume?

```bash
cd ~/Projects/Blockchain/CustodyChain/backend/network
docker ps -a --filter label=service=hyperledger-fabric --format '{{.Names}}\t{{.Status}}'
```
- **No containers listed:** first run, so go to Step 2.
- **Containers listed but `Exited`:** a stopped network. Resume it with `./network.sh start`, which keeps all records and hashes, then go to Step 4.
- **Fresh start wanted:** `./network.sh down` (**deletes everything**, [§6](#6-persistence-where-the-data-lives-and-how-to-keep-it)).

### Step 2: Start the network and create the channel

```bash
./network.sh up createChannel -c mychannel -ca
```

This succeeds when the output ends with `Channel 'mychannel' joined`. Expected containers: `orderer.example.com`, `peer0.org1.example.com`, `peer0.org2.example.com`, `ca_org1`, `ca_org2`, `ca_orderer`.

### Step 3: Deploy the chaincode as a service

```bash
./network.sh deployCCAAS -ccn basic -ccp ../chaincode/
```

This succeeds when you see `Approvals: [Org1MSP: true, Org2MSP: true]` and `Docker container started succesfully`. Two more containers appear: `peer0org1_basic_ccaas` and `peer0org2_basic_ccaas`. The deploy script now removes stale chaincode containers itself.

> Do **not** use the README's `./network.sh deployCC ...` on Docker 29+. It fails ([§8.2](#82-deploycc-fails-with-broken-pipe-on-docker-29)).

### Step 4: Start the API gateway (terminal 2)

```bash
cd ~/Projects/Blockchain/CustodyChain/backend/gateway
npm install          # first time only
node src/app.js      # -> "Servidor rodando em http://localhost:3000"
```

### Step 5: Start the frontend (terminal 3)

```bash
cd ~/Projects/Blockchain/CustodyChain/frontend
npm install          # first time only
npm run dev -- --host 0.0.0.0     # -> http://localhost:5173
```

### Step 6: Smoke test

```bash
curl -s localhost:3000/assets                       # -> [] on a new network

curl -s -X POST localhost:3000/asset -H 'Content-Type: application/json' -d '{
  "id":"EVID-101","who":"Officer Sharma","what":"Seized laptop, disk image",
  "when":"2026-11-17T10:00:00Z","where":"Cyber PS Gandhinagar",
  "why":"FIR 123/2026","how":"Tamper-evident bag #7741"}'
# -> {"message":"Ativo criado com sucesso!"}

curl -s -X POST localhost:3000/transferAsset -H 'Content-Type: application/json' \
  -d '{"id":"EVID-101","newOwner":"FSL Examiner Patel"}'
# -> {"error":"10 ABORTED: ..."}     <- expected with the original chaincode (§8.4)
```

### Step 7: Shut down

```bash
# Ctrl+C the gateway and the frontend, then:
cd ~/Projects/Blockchain/CustodyChain/backend/network
./network.sh stop     # KEEPS ledger, hashes, identities. Resume later with ./network.sh start
# ./network.sh down   # only when you really want to WIPE everything
```

---

## 5. Demo script (original system)

This takes about 3 minutes and shows the system as the authors published it.

| # | Action | What happens | Point to make |
|---|---|---|---|
| 1 | UI → **View All Assets** | Empty table | Fresh ledger on a 2-org Fabric network |
| 2 | UI → **Create Asset**, fill in the 5W1H fields | "Asset created successfully!" | The paper's main flow works |
| 3 | UI → **View All Assets** | The record appears | Data is on the ledger, held by both peers |
| 4 | UI → **Transfer Custody** (same ID, new owner) | **"Error transferring ownership."** | The core feature fails; explain the endorsement mismatch (§8.4) |
| 5 | Terminal: overwrite the record (command below) | Success message | Anyone can rewrite evidence |
| 6 | UI → **View All Assets** | The record has been replaced | No previous version is shown |

```bash
curl -s -X PUT localhost:3000/asset/EVID-101 -H 'Content-Type: application/json' \
  -d '{"who":"Anyone","what":"Different item","when":"2020-01-01","where":"X","why":"Y","how":"Z"}'
docker logs peer0.org1.example.com 2>&1 | grep "Proposal response mismatch" | tail -1   # proof of step 4
```

**Showing that it really is a blockchain.** The UI hides it, but the peer CLI shows it:
```bash
cd ~/Projects/Blockchain/CustodyChain/backend/network
export PATH=$PWD/../bin:$PATH FABRIC_CFG_PATH=$PWD/../config
. scripts/envVar.sh; setGlobals 1          # setGlobals 2 for Org2's peer
peer channel getinfo -c mychannel          # height, currentBlockHash, previousBlockHash (base64)
```
Both peers report the same height and hashes. Each block stores the previous block's hash, and every write is signed by both organisations.

---

## 6. Persistence: where the data lives and how to keep it

### Where things are stored

| What | Where |
|---|---|
| Blocks (the chain) | Inside each peer and orderer container at `/var/hyperledger/production/...`, backed by **named Docker volumes** (`compose_peer0.org1.example.com`, ...; BFT: `custodychain-bft_peer0.police.custodychain.local`, ...) |
| World state (what "View All Assets" shows) | LevelDB in the same volumes |
| Certificates and keys (identities) | On disk: `backend/network/organizations/` (BFT: `backend/network-bft/organizations/`) |
| **Evidence files** | **Nowhere.** The original system stores only the typed text. The fingerprinting design (report and `outputs/spec/`) keeps files off-chain with only their hashes on the ledger. |

### Commands

| Command | Effect | Data kept? |
|---|---|---|
| `./network.sh stop` | Stops every Fabric container (chaincode → peers → orderers → CAs) | **Yes**, everything |
| `./network.sh start` | Starts them again from the persisted volumes, in dependency order | **Yes** |
| Laptop reboot, Docker restart, crash | Containers are left stopped; volumes intact | **Yes**. Run `./network.sh start` |
| `./network.sh down` | Deletes containers, **ledger volumes, world state and all certificates** | **No: irreversible wipe** (it prints a warning) |

Both networks implement the same `stop`/`start`/`down` semantics.

**Tests (19 Nov 2026).**
- **Original network:**
  - after `stop`/`start`, the same height (7) and the same block hash, the record intact, and a new write committed as block 8;
  - after `docker kill` of every container (simulated power loss) and `start`, both peers came back at height 8 with identical hashes.
- **BFT network:** identical heights, hashes and world state after `stop`/`start` ([§7](#7-the-bft-network-four-agencies)).

> After `start`, restart the gateway (`node src/app.js`) if it was running before.

---

## 7. The BFT network (four agencies)

### What BFT is, in one paragraph

*Consensus* is how independent nodes agree on one order of transactions. In Fabric, the **ordering nodes (orderers)** do this; peers don't vote.
- **Raft** survives nodes that *crash*, but assumes no node lies.
- **Byzantine Fault Tolerance (BFT)** also survives nodes that *lie or act maliciously*. To tolerate `f` bad nodes it needs `n ≥ 3f + 1` nodes, and every decision needs `2f + 1` of them. With `f = 1` that gives **n = 4 and a quorum of 3**, which is why 4 is the minimum.

So no single agency can rewrite, reorder or censor the ledger.

### Topology

| Agency | Orderer (consenter ID) | Peer | Chaincode service |
|---|---|---|---|
| Police | `orderer.police.custodychain.local:7050` (1) | `peer0.police…:7051` | `police-cc` |
| FSL | `orderer.fsl.custodychain.local:8050` (2) | `peer0.fsl…:8051` | `fsl-cc` |
| Court | `orderer.court.custodychain.local:11050` (3) | `peer0.court…:9051` | `court-cc` |
| Prosecution | `orderer.prosecution.custodychain.local:10050` (4) | none | none |

Every write must be endorsed by a **majority of the agency peers** (2 of 3).

### Run it

```bash
cd ~/Projects/Blockchain/CustodyChain/backend
(cd network && ./network.sh stop)        # the original network shares ports; this keeps its data
cd network-bft
./network.sh all       # first time: identities, 7 containers, channel 'custody', chaincode
./network.sh status    # per-orderer channel height + per-peer height/hash
./network.sh invoke '{"Args":["CreateAsset","E1","who","what","when","where","why","how"]}'
./network.sh query  '{"Args":["GetAllAssets"]}'
./test-bft.sh          # verification suite (~5 min), writes test-results.txt
./network.sh stop      # keep everything     |   ./network.sh start   # resume
./network.sh down      # WIPE
```

`SUBMIT_VIA=fsl ./network.sh invoke …` submits through another agency's orderer.

**Web app on the BFT network.** The gateway's paths can now be set by environment variable; the defaults are unchanged.
```bash
cd ~/Projects/Blockchain/CustodyChain/backend/gateway
O=../network-bft/organizations/peerOrganizations/police.custodychain.local
CHANNEL_NAME=custody CHAINCODE_NAME=custody MSP_ID=PoliceMSP \
PEER_ENDPOINT=localhost:7051 PEER_HOST_ALIAS=peer0.police.custodychain.local \
KEY_DIRECTORY_PATH=$O/users/User1@police.custodychain.local/msp/keystore \
CERT_DIRECTORY_PATH=$O/users/User1@police.custodychain.local/msp/signcerts \
TLS_CERT_PATH=$O/peers/peer0.police.custodychain.local/tls/ca.crt \
node src/app.js
```
The frontend needs no change.

### Verified behaviour (`./test-bft.sh`, fresh network, 19 Nov 2026)

| # | Test | Result |
|---|---|---|
| 1 | Channel config | `BFT`, 4 consenters |
| 2 | Transaction, all up | VALID on all 3 peers in 0.2 s; each block carries **3 consenter signatures** (a quorum) |
| 3 | 1 orderer stopped (f = 1) | still commits |
| 4 | 2 orderers stopped | **no block produced**: BFT halts instead of risking safety. The request is kept and ordered after recovery |
| 5 | Recovery | commits resume about 56 s after restart; all 4 orderers catch up |
| 6 | Leader failure | current leader stopped; view change elects a new leader; commits resume after about 54 s |
| 7 | Persistence | identical heights, hashes and world state after `stop`/`start` |
| 8 | Resources | about 370 MiB RAM for all 10 containers |

The authors' chaincode runs unchanged on this network, so the `TransferAsset` timestamp bug (§8.4) still applies there until the improved chaincode is deployed.

---

## 8. Troubleshooting

### 8.1 `network.sh up ... -ca` hangs, or CA containers exit immediately
- **Log:** `Error: Configuration file version 'v1.5.22' is higher than server version 'v1.5.12'`
- **Cause:** the gitignored `organizations/fabric-ca/*/fabric-ca-server-config.yaml` declares a newer CA version than the image.
- **Fix:** Step 0a, then `./network.sh down` and start again.

### 8.2 `deployCC` fails with "broken pipe" on Docker 29+
- **Symptom:** `docker build failed: ... write unix @->/run/docker.sock: write: broken pipe`
- **Cause:** the peer builds chaincode images over `docker.sock` with a legacy client protocol that Docker 29 rejects.
- **Fix:** use **Chaincode-as-a-Service** (`./network.sh deployCCAAS -ccn basic -ccp ../chaincode/`), which needs the committed Dockerfile. The BFT network always uses CCaaS.

### 8.3 Frontend shows connection errors and nothing loads
- **Cause:** the authors hardcoded their old cloud server (`34.41.10.244`).
- **Status:** fixed in the repo (`localhost:3000`). If it comes back after a stash apply or a merge, see §12.

### 8.4 Transfer Custody fails: `ABORTED: failed to collect enough transaction endorsements`
- **Symptom:** create and update work, but transfer always errors. The peer log shows `Proposal response mismatch ... type="write value mismatch"`.
- **Cause:** a bug in the authors' chaincode:
  ```js
  asset.When = new Date().toISOString();   // lib/assetTransfer.js, TransferAsset: differs on every peer
  ```
  Each endorsing peer simulates the transaction separately, and the results must be byte-identical. Each peer reads its own clock, so the results never match. `InitLedger` has the same bug.
- **Fix (improved version, §12):** use the transaction timestamp, which is identical on every peer:
  ```js
  const ts = ctx.stub.getTxTimestamp();
  const when = new Date(ts.seconds.low * 1000 + Math.round(ts.nanos / 1e6)).toISOString();
  ```
- **For demos:** leave it. It's a finding.

### 8.5 The Create button does nothing, or every transaction hangs
- **Symptom:** the UI button seems dead; `curl localhost:3000/assets` hangs; the peer log shows `peer will not accept external chaincode connection <package-id>`.
- **Cause:** the chaincode containers are serving a **different package ID** from the one committed on the channel. The authors' UI has no timeout or error handling, so nothing appears to happen. Two ways this happens:
  1. Old `*_ccaas` containers survived a `network.sh down`. This was a bug in Hyperledger's `network.sh` (the container IDs were quoted into a single argument), **fixed in `41f3b21`**.
  2. Chaincode was re-packaged (gzip timestamps produce a new package ID) after the definition was committed.
- **Fix:**
  - The original network's `deployCCAAS` now removes stale containers before starting new ones.
  - The BFT `deploy` builds a deterministic package and always starts the services with the package ID the channel **approved**.
  - Manual repair:
    ```bash
    docker rm -f peer0org1_basic_ccaas peer0org2_basic_ccaas   # BFT: police-cc fsl-cc court-cc
    ./network.sh deployCCAAS -ccn basic -ccp ../chaincode/     # BFT: ./network.sh deploy
    ```

### 8.6 All records, hashes and history are gone
- **Cause:** `./network.sh down` (or `restart`) was used. It deletes the ledger volumes and certificates.
- **Fix:** use `./network.sh stop` / `start` from now on (§6). Data deleted by `down` can't be recovered.

### 8.7 Gateway crashes on start: `ENOENT ... keystore` or `Nenhum arquivo encontrado`
- **Cause:** the identities don't exist yet, were regenerated, or the env vars point at the wrong network.
- **Fix:** start the gateway after the network is up. Restart it after every `down`/`up`. For the BFT network, use the env vars in §7.

### 8.8 Gateway error: `14 UNAVAILABLE: No connection established`
- **Cause:** the peer it points to isn't running, often because the *other* network is the one running.
- **Fix:** run `docker ps`, then `./network.sh start` on the network you want.

### 8.9 BFT network: `failed to bind host port 0.0.0.0:9050: address already in use`
- **Cause:** port 9050 is commonly held by a local Tor service.
- **Status:** the Court orderer already uses **11050/11053** instead. For any other clash, find the owner with `ss -ltnp | grep :<port>`.

### 8.10 BFT network: transactions hang or don't commit
- **Check `./network.sh status`.** If two or more orderers are down, BFT **deliberately** stops producing blocks: with 4 nodes it needs 3. Start them again (`docker start orderer.<agency>.custodychain.local`). Pending transactions are then ordered, which takes up to about 1 minute while a new leader is elected.
- **The two networks clash on ports.** Stop the other network first.

### 8.11 BFT `peer` CLI: `endorser client failed to connect to localhost:8051`
- **Cause:** a TLS host-name override (`CORE_PEER_TLS_SERVERHOSTOVERRIDE`) set for one peer gets applied to all peers.
- **Fix:** don't set it. The certificates include `localhost` (fixed in `network.sh`).

### 8.12 `permission denied` on `/var/run/docker.sock`, or root-owned `node_modules`
- **Docker socket:** add yourself to the `docker` group and log in again.
- **Root-owned `backend/chaincode/node_modules`:** harmless for CCaaS, since `.dockerignore` excludes it. To run `npm test` locally: `sudo rm -rf backend/chaincode/node_modules && npm install`.

### 8.13 Port already in use (3000 / 5173 / 7051)
```bash
ss -ltnp | grep -E ':3000|:5173|:7051'
```
Vite picks the next free port automatically. Read the URL it prints.

---

## 9. Shortcomings of the original system

Severity: 🔴 critical for a chain-of-custody system · 🟠 major · 🟡 minor or engineering hygiene. These describe the **authors' system**; [§10](#10-salvage-vs-rebuild-and-progress-so-far) tracks what we have addressed so far.

### 9.1 Correctness
| | Issue | Detail |
|---|---|---|
| 🔴 | **Custody transfer is broken** | `new Date()` in `TransferAsset` (and `InitLedger`) makes endorsements disagree on any network with more than one endorsing org (§8.4). |
| 🟠 | **Does not run as published** | CA version mismatch, Docker 29 incompatibility, dead hardcoded IP. |
| 🟠 | **Tests don't match the code** | `test/assetTransfer.test.js` tests Hyperledger's sample asset (`Color`, `Size`, `Owner`, `AppraisedValue`), so the 100% coverage gate is meaningless. |
| 🟡 | **Gateway race on startup** | `initializeGateway()` runs inside `app.listen`'s callback; early requests crash with `gateway is undefined`. |

### 9.2 Integrity and immutability
| | Issue | Detail |
|---|---|---|
| 🔴 | **Evidence records can be overwritten** | `UpdateAsset` replaces every field, for anyone, with no reason recorded. Fabric keeps old values in its key history, but nothing in the original exposes them. |
| 🔴 | **No evidence hash** | Nothing links the record to the evidence; "What" is free text. |
| 🔴 | **Ledger wiped by the standard shutdown** | The only stop command (`network.sh down`) deleted all blocks and certificates, so "immutable" lasted until the next shutdown. |
| 🟠 | **Only the latest state is visible** | Custody history isn't modelled as events. |
| 🟠 | **Client-supplied timestamps** | `CreateAsset`/`UpdateAsset` accept `When` from the user, so records can be backdated. |
| 🟠 | **No link between original and derived evidence** | Forensic images and extracts can't be linked to their source. |

### 9.3 Identity, authentication and access control
| | Issue | Detail |
|---|---|---|
| 🔴 | **One shared identity for everyone** | Every transaction is signed as `User1@org1.example.com`. |
| 🔴 | **"Who" is a text box** | Never derived from the signer's certificate. |
| 🔴 | **No authorisation rules** | Anyone can create, update or transfer anything; there's no receiver acknowledgement. |
| 🟠 | **Open API** | No authentication; `cors({ origin: '*' })`. |
| 🟠 | **Reads aren't logged** | Contradicts the paper's claim that access is monitored. |

### 9.4 Architecture and use of Fabric
| | Issue | Detail |
|---|---|---|
| 🟠 | **No real consensus** | One Raft orderer means no fault tolerance and no agreement between independent parties. |
| 🟠 | **Generic organisations** | Org1/Org2 on `example.com` don't represent Police, FSL, Prosecution or Court. |
| 🟠 | **No endorsement policy tailored to custody** | Default majority only. |
| 🟠 | **No privacy** | All metadata is visible to every member; no private data collections. |
| 🟠 | **No off-chain evidence store** | Nowhere to keep the evidence files. |
| 🟡 | **Unbounded queries; sample leftovers** | Open range scan; chaincode `basic`; "Tomoko"; Portuguese messages. |

### 9.5 Legal and procedural fit (Indian context)
| | Issue | Detail |
|---|---|---|
| 🟠 | **No mapping to procedure** | No FIR, case or seizure-memo concepts; no BNSS s.105 A/V recording or witness requirements; no FSL workflow. |
| 🟠 | **No court-ready output** | Nothing supports a BSA s.63(4)(c) certificate; no way to verify a file against the ledger. |
| 🟠 | **No lifecycle stages** | Everything is "update" or "transfer". |
| 🟡 | **Garbage in, garbage out at collection** | Nothing binds the first record to the actual seizure. |

### 9.6 Evaluation (paper)
| | Issue | Detail |
|---|---|---|
| 🟠 | **Weak results** | Only memory and network-traffic graphs; no throughput, latency or scalability figures. |
| 🟠 | **No threat model** | Immutability is asserted, not analysed. |

| The paper claims | The code |
|---|---|
| "Controlling access ... through encrypted access keys" | One shared identity for all users |
| "Monitoring who accessed them and what actions were taken" | Reads not logged; "Who" is free text |
| Records "cannot be altered" | `UpdateAsset` overwrites everything, for anyone |
| Ensures evidence integrity | No hash of the evidence is stored |
| "Fully operational implementation" | Custody transfer fails on the default 2-org network |

### 9.7 Frontend and UX
🟡 Hardcoded API URL · no validation ("When" is free text) · no update or history screen · `alert()` feedback, with Flowbite and Tailwind installed but barely used · `<tbody>` repeated per row · no timeout or error handling on Create, so a hung network looks like a dead button (§8.5).

---

## 10. Salvage vs. rebuild, and progress so far

### Keep (as is or lightly modified)
| Component | Why |
|---|---|
| Fabric network scripts (`network.sh`, channel creation, `deployCCAAS`) | Working, debugged plumbing |
| Gateway connection layer (`@hyperledger/fabric-gateway`, gRPC/TLS, Express skeleton) | Standard and correct; now configurable by env vars |
| Chaincode tooling (deterministic JSON, mocha/sinon/nyc, eslint) | Reusable |
| Our stash fixes: `getTxTimestamp`, `GetAssetHistory` and `/history` | Needed regardless of the redesign |
| Frontend scaffold and browser-side SHA-256 hashing (stash UI) | First step to hash-on-chain |

### Progress (19 Nov 2026)
| Item | Status |
|---|---|
| Run the original as published | ✅ run-only fixes committed (`17da027`) |
| Persistent ledger | ✅ `stop`/`start` (`15d2dde`); `down` bug fixed (`41f3b21`) |
| Real organisations + real consensus | ✅ BFT network, 4 agencies (`ab0c9a5`) |
| How evidence is fingerprinted: integrity vs. identity, per evidence type, legal mapping | ✅ report `outputs/report/main.pdf` (`065c685`) |
| Well-defined inputs for every evidence type | ✅ JSON Schemas `outputs/spec/` plus reference tool `outputs/tools/` |
| Deterministic transfer + history | 🟡 in `stash@{0}`, not yet committed or deployed |
| Evidence data model (manifest hash + Merkle root + append-only events) | ⬜ specified in the report; chaincode not yet written |
| Identity from certificates, two-phase transfer, custody rules | ⬜ |
| Off-chain encrypted evidence store | ⬜ |
| Verification endpoint, court report, BSA s.63 certificate generation | ⬜ |
| Tests for the new model; Caliper benchmarks | ⬜ |

---

## 11. Talking points and meeting outcomes

### Points presented (meeting of 18 Nov 2026)
1. The paper (Loffi et al., ICOIN 2025) claims a fully operational Fabric chain of custody; its code is public and our copy matched it byte for byte.
2. Reproducing it took real work: the CA version, Docker 29 vs. the chaincode build, and the dead IP.
3. Headline finding: Transfer Custody fails because of `new Date()` in the smart contract.
4. The paper claims more than the code implements (§9.6).
5. Keep the infrastructure; rebuild the domain logic (§10).

### Outcomes and decisions
| Professor's point | Decision | Done |
|---|---|---|
| ~20 consensus nodes? Was Kafka used? | BFT, **4 nodes minimum**; it was Raft with 1 node, not Kafka | ✅ §7 |
| Hashes and history must persist, not be erased each time | `stop`/`start`, keeping `down` as an explicit wipe | ✅ §6 |
| How are real-world items hashed (photos differ every time; notebooks)? | Two-layer model in the report: exact hashes of captures + tolerant re-identification | ✅ report |
| Well-defined inputs | Input spec per evidence type and stage | ✅ `outputs/spec/` |

Open questions for next time are in the report, §10 (O1–O6).

---

## 12. Our improved chaincode/UI: git stash

```
stash@{0}: On main: demo-working-ccaas-history-ui
```

| File | Change |
|---|---|
| `backend/chaincode/lib/assetTransfer.js` | Deterministic timestamps (`getTxTimestamp`); new `GetAssetHistory` |
| `backend/chaincode/package.json` | `server` script (no longer needed; the Dockerfile has the command) |
| `backend/gateway/src/app.js` | `GET /asset/:id/history`; detailed endorsement errors |
| `frontend/src/App.svelte` | New forensic UI: SHA-256 hashing in the browser, history inspector, notifications |

`main` now already contains the localhost edit to `App.svelte` and the env-var change to `app.js`, so applying the stash will report conflicts in those two files. Resolve it like this, on `main`:

```bash
git stash show -p stash@{0}                       # review first
git stash apply stash@{0}                         # conflicts expected in App.svelte (and possibly app.js)
git checkout --theirs CustodyChain/frontend/src/App.svelte   # take the stash UI (it already uses localhost:3000)
# app.js: keep BOTH the env-var paths (main) and the /history route (stash), then:
git add CustodyChain/frontend/src/App.svelte CustodyChain/backend/gateway/src/app.js
```

Then redeploy the chaincode:
- original network: `./network.sh deployCCAAS ...`
- BFT network: `CC_VERSION=1.1 CC_SEQUENCE=2 ./network.sh deploy`

With this version, transfer succeeds and `/asset/<id>/history` returns the custody timeline. The stash isn't a commit, so commit it on `main` once it has been reviewed.

---

## 13. Quick reference

```bash
# ===== ORIGINAL (Raft) network =====
cd ~/Projects/Blockchain/CustodyChain/backend/network
./network.sh start                                    # resume (keeps data), or first time:
#   ./network.sh up createChannel -c mychannel -ca && ./network.sh deployCCAAS -ccn basic -ccp ../chaincode/
cd ../gateway && node src/app.js                      # terminal 2 -> :3000
cd ../../frontend && npm run dev -- --host 0.0.0.0    # terminal 3 -> :5173
./network.sh stop                                     # pause, keep everything
./network.sh down                                     # WIPE

# ===== BFT network (stop the original first) =====
cd ~/Projects/Blockchain/CustodyChain/backend/network-bft
./network.sh all | status | stop | start | down
./test-bft.sh

# ===== health checks =====
docker ps -a --filter label=service=hyperledger-fabric --format "table {{.Names}}\t{{.Status}}"
curl -s localhost:3000/assets
docker logs <peer-container> 2>&1 | grep -iE 'error|mismatch|will not accept' | tail
```

| Service | Original | BFT |
|---|---|---|
| Frontend / gateway | <http://localhost:5173> / <http://localhost:3000> | same (gateway with env vars, §7) |
| Peers | `peer0.org1.example.com:7051`, `peer0.org2.example.com:9051` | `peer0.{police,fsl,court}.custodychain.local:{7051,8051,9051}` |
| Orderers | `orderer.example.com:7050` | `orderer.{police,fsl,court,prosecution}.custodychain.local:{7050,8050,11050,10050}` |
| Chaincode services | `peer0org1_basic_ccaas`, `peer0org2_basic_ccaas` | `police-cc`, `fsl-cc`, `court-cc` |
| Channel / chaincode | `mychannel` / `basic` | `custody` / `custody` |
