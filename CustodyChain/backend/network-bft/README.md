# CustodyChain BFT network (Hyperledger Fabric v3.1.5)

This is the multi-agency network agreed with the professor: **Byzantine-fault-tolerant ordering with 4 consensus nodes**, one per agency. It sits beside the original paper's Raft test network in `../network/`, which is kept unchanged for reproducing the paper.

| Agency | BFT consenter (orderer) | Peer | Chaincode service |
|---|---|---|---|
| Police | `orderer.police.custodychain.local:7050` (ID 1) | `peer0.police…:7051` | `police-cc` |
| FSL | `orderer.fsl.custodychain.local:8050` (ID 2) | `peer0.fsl…:8051` | `fsl-cc` |
| Court | `orderer.court.custodychain.local:11050` (ID 3) | `peer0.court…:9051` | `court-cc` |
| Prosecution | `orderer.prosecution.custodychain.local:10050` (ID 4) | none | none |

- **Consensus:** SmartBFT (`OrdererType: BFT`). With n = 4 it tolerates f = 1 faulty or malicious orderer, and every decision needs a quorum of 3.
- **Endorsement:** a write must be signed by a majority of the agency peers (2 of 3).
- **Channel and chaincode:** both are named `custody`. The chaincode is the authors' `../chaincode`, run as a service.
- **Ports:** the Court orderer uses 11050 because 9050 is commonly taken by Tor.

## Prerequisites

- Fabric **3.1.5** binaries in `../bin/v3.1.5/` (`peer`, `orderer`, `configtxgen`, `osnadmin`, `cryptogen`, `configtxlator`). Download them from the Fabric v3.1.5 release (`hyperledger-fabric-linux-amd64-3.1.5.tar.gz`, `bin/`).
- Docker images `hyperledger/fabric-orderer:3.1.5` and `hyperledger/fabric-peer:3.1.5`.
- `jq`.
- The original Raft network must be stopped first, because the two networks share some ports: `cd ../network && ./network.sh stop`.

## Commands

```bash
./network.sh all       # first time: identities, 7 containers, channel, chaincode
./network.sh status    # every orderer's channel height and every peer's height and hash
./network.sh invoke '{"Args":["CreateAsset","E1","who","what","when","where","why","how"]}'
./network.sh query  '{"Args":["GetAllAssets"]}'
./network.sh stop      # pause: ledgers, state and identities are KEPT
./network.sh start     # resume from persisted state
./network.sh down      # WIPE everything (irreversible)
./test-bft.sh          # verification suite; writes test-results.txt
```

`SUBMIT_VIA=fsl ./network.sh invoke …` submits through another agency's orderer. Any consenter accepts transactions and forwards them to the current leader.

## Running the web app against this network

```bash
cd ../gateway
O=../network-bft/organizations/peerOrganizations/police.custodychain.local
CHANNEL_NAME=custody CHAINCODE_NAME=custody MSP_ID=PoliceMSP \
PEER_ENDPOINT=localhost:7051 PEER_HOST_ALIAS=peer0.police.custodychain.local \
KEY_DIRECTORY_PATH=$O/users/User1@police.custodychain.local/msp/keystore \
CERT_DIRECTORY_PATH=$O/users/User1@police.custodychain.local/msp/signcerts \
TLS_CERT_PATH=$O/peers/peer0.police.custodychain.local/tls/ca.crt \
node src/app.js
```

## Verified behaviour (19 Nov 2026, fresh network, `./test-bft.sh`)

| # | Test | Result |
|---|---|---|
| 1 | Channel config | `BFT`, 4 consenters (Police, FSL, Court, Prosecution orderer MSPs) |
| 2 | Transaction, all up | VALID on all 3 peers in 0.2 s; block carries **3 consenter signatures** (a BFT quorum) |
| 3 | 1 orderer stopped (f = 1) | still commits (0.2 s) |
| 4 | 2 orderers stopped | **no block produced**: BFT halts instead of risking safety. The pending request was not lost and was ordered after recovery |
| 5 | Recovery | commits resume about 56 s after restart; all 4 orderers catch up to the same height |
| 6 | Leader failure | leader (consenter 2) stopped; view change elects consenter 3; commits resume after about 54 s |
| 7 | Persistence | `stop`/`start`: identical heights, block hashes and world state; new writes commit |
| 8 | Resources | 10 containers use about 370 MiB RAM in total |

The recovery and view-change times follow the SmartBFT timeouts in `configtx/configtx.yaml` (`LeaderHeartbeatTimeout` 1 min, `ViewChangeTimeout` 20 s).

### How the four guarantees can be checked by hand

- **Consensus type and consenters:** `peer channel fetch config`, decode with `configtxlator`, then read `Orderer.values.ConsensusType` and `Orderer.values.Orderers.consenter_mapping`.
- **Quorum signatures on a block:** decode `metadata[0]` of any block as `common.Metadata`. There are 3 signatures, and each `identifier_header` names its consenter ID.
- **Fault tolerance:** `docker stop orderer.prosecution.custodychain.local` and invoke, which still commits. Then stop a second orderer and invoke, which does not commit.

## Prototype v2 additions (M1, D-035, D-036, D-044)

- **Agency CAs:** `ca.police` (7054), `ca.fsl` (8054) and `ca.court` (9054) run Fabric CA 1.5.12, signing with each agency's existing cryptogen CA, so users they enrol are trusted by the channel as is.
- **Role users:** `./network.sh users` enrols `io.sharma`, `malkhana.desai`, `examiner.mehta` and `clerk.rao`, each with `role=<role>` in their certificate.
- **Two chaincodes:** `custody` (the authors', improved v1) and `evidence` (v2, `../chaincode-v2`, `./network.sh deploy-v2`). Chaincode service containers are named `<agency>-<chaincode>-cc`.
- **`./network.sh all`** now runs up + channel + deploy + deploy-v2 + users. `stop`/`start` include the CAs.

The application on top of this network is described in [`../../PROTOTYPE.md`](../../PROTOTYPE.md).
