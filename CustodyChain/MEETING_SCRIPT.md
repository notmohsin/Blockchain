# Meeting Script: Reproducing CustodyChain (about 10 minutes)

> The spoken parts are written to be said roughly as is. Lines marked **[DO]** are actions, and *italics* are notes for you.
> Total ≈ 10 min: Context 1.5 · Demo 3.5 · Findings 2 · Keep vs. rebuild 2 · Questions 1.

---

## Before the meeting (15 minutes early)

**[DO]** Open three terminals and start everything:

```bash
# Terminal 1: network and chaincode (≈2 min)
cd ~/Projects/Blockchain/CustodyChain/backend/network
./network.sh down
docker rm -f peer0org1_basic_ccaas peer0org2_basic_ccaas 2>/dev/null   # 'down' leaves these running (network.sh bug); stale ones make every transaction hang
./network.sh up createChannel -c mychannel -ca
./network.sh deployCCAAS -ccn basic -ccp ../chaincode/

# Terminal 2: API gateway
cd ~/Projects/Blockchain/CustodyChain/backend/gateway && node src/app.js

# Terminal 3: frontend
cd ~/Projects/Blockchain/CustodyChain/frontend && npm run dev -- --host 0.0.0.0
```

**[DO]** Check it's working:
- `curl -s localhost:3000/assets` should print `[]`.
- Open <http://localhost:5173> in the browser and leave it on the home screen.

**[DO]** Have these ready in tabs:
- the paper PDF (`Papers/Blockchain-Based_Chain_of_Custody_for_Digital_Evidence_with_Hyperledger_Fabric-1.pdf`)
- the GitHub repo <https://github.com/leandroloffi/CustodyChain>
- `SETUP_AND_TROUBLESHOOTING.md`, §7 (Shortcomings)

**[DO]** Keep a fourth terminal open in `backend/network` for the log command later.

> *Don't run `./network.sh down` after the demo until the meeting is over. It wipes the ledger.*

---

## 1. Context (≈1.5 min)

> "As a starting point I picked the Loffi et al. paper from ICOIN 2025, *Blockchain-Based Chain of Custody for Digital Evidence with Hyperledger Fabric*, from the Federal University of Santa Catarina in Brazil.
>
> I chose it because it's one of the few papers in this area that claims a *fully operational* implementation rather than just a framework, and their code is public on GitHub. So my first goal was to reproduce it exactly as published, and then judge which parts we can build on.
>
> Their system has three parts: a Hyperledger Fabric network with two organisations, a JavaScript smart contract that stores each piece of evidence as a 5W1H record (who, what, when, where, why, how), and a small Node.js API with a Svelte web UI on top.
>
> I checked that the code I'm running is byte-for-byte identical to their GitHub repo."

**[DO]** Briefly show the GitHub tab.

---

## 2. Live demo (≈3.5 min)

> "First, a note on getting it running. It doesn't run as published on a current machine. There were three problems: a Fabric CA version mismatch, newer Docker versions breaking the way Fabric builds the smart contract (so I run it as a separate service instead), and a frontend hardcoded to the authors' old cloud server, which no longer exists. I fixed these without touching their logic, and it's all documented. So what you're about to see is their system, as they wrote it."

**[DO]** UI → **View All Assets**

> "This is a fresh ledger on the two-organisation network. It's empty."

**[DO]** UI → **Create Asset**. Fill in:
- ID `EVID-101`
- Who `Officer Sharma`
- What `Seized laptop, disk image`
- When `2026-11-18`
- Where `Cyber PS Gandhinagar`
- Why `FIR 123/2026`
- How `Tamper-evident bag 7741`

Then click **Create**.

> "Registering evidence works. This is the main flow in their paper."

**[DO]** UI → **View All Assets**

> "The record is on the ledger, and both organisations' peers have a copy."

**[DO]** UI → **Transfer Custody**: ID `EVID-101`, New Owner `FSL Examiner Patel` → **Transfer**

> "Now the central operation of a chain of custody, handing evidence from one custodian to the next. It fails."

*Pause and let the error alert show.*

**[DO]** In the fourth terminal:

```bash
docker logs peer0.org1.example.com 2>&1 | grep "Proposal response mismatch" | tail -1
```

> "The peer log shows why. In Fabric, each organisation's peer runs the transaction independently, and their results must match exactly before it's accepted. The authors call `new Date()` inside the smart contract, so each peer stamps a slightly different time, the results never match, and every transfer is rejected. It's a well-known Fabric mistake, and the fix is to use the transaction's own timestamp, which I've already done in my improved version."

**[DO]** In the terminal, overwrite the record:

```bash
curl -s -X PUT localhost:3000/asset/EVID-101 -H 'Content-Type: application/json' \
  -d '{"who":"Anyone","what":"Different item","when":"2020-01-01","where":"X","why":"Y","how":"Z"}'
```

**[DO]** UI → **View All Assets**

> "And the second problem: anyone can call this update endpoint and replace every field of an evidence record, including the date. Their UI and API never show the earlier version. For a chain-of-custody system, that's the one thing that must not be possible."

---

## 3. Key findings (≈2 min)

> "Putting together the demo and a read of the code, there are four main findings."

1. > "**The core feature doesn't work.** Custody transfer fails on their own default network."
2. > "**There's no real identity.** Every request is signed with one shared Fabric identity, and 'Who' is just a text box. So the ledger can't prove who actually handled the evidence, even though certificate-based identity is the main reason to use Fabric."
3. > "**There's no link to the actual evidence.** No hash of the file or disk image is stored, and no evidence is stored anywhere. Only the text you type in. So the ledger can't show that the evidence itself is unchanged."
4. > "**The paper claims more than the code does.** It claims access control with encrypted keys, logging of who accessed what, and records that can't be altered. None of these are implemented. Their results are memory and network graphs only, with no throughput or latency figures."

> "There's also a practical point: the standard shutdown command deletes the entire ledger. So in this setup, 'immutable' only lasts until someone tears the network down."

> *If asked for detail: §7 of SETUP_AND_TROUBLESHOOTING.md has the full list, grouped by severity.*

---

## 4. What we keep vs. what we rebuild (≈2 min)

> "The paper's own code is only about 370 lines on top of Hyperledger's sample network. So my proposal is to **keep the infrastructure and rebuild the domain logic**."

> "**We keep:** the Fabric network setup and deployment scripts, the gateway's connection code, and the testing toolchain. I also already have a working improved version with the timestamp fix, a full custody-history view, and SHA-256 hashing of files in the browser."

> "**We rebuild:**
> - an evidence model built as an append-only log of events (collected, transferred, examined, submitted to court), with each item's hash and links from derived evidence such as forensic images back to the original
> - identity taken from each user's certificate, with roles, so only the current custodian can transfer and the receiver has to accept
> - real organisations, such as Police, FSL and Court, with rules that inter-agency transfers need both sides to sign
> - an encrypted off-chain evidence store, with only the hash on the ledger
> - a way to verify a file against the ledger
> - proper benchmarks."

> "This matches the architecture in your brief: evidence stays off-chain, and the ledger records hashes and custody events. The brief also makes the point that the blockchain only preserves what goes in. If a record is wrong at collection, the ledger keeps it wrong. So the collection step, meaning who records it, with what proof and witnesses, needs as much design work as the ledger itself."

---

## 5. Questions for the professor (≈1 min)

> "To plan the next steps, I'd like your direction on a few things:"

1. **Scope:** "Digital evidence only, or physical evidence documented digitally as well?"
2. **Organisations:** "Which agencies should the network model: Police, FSL, Prosecution, Court?"
3. **Indian legal context:** "Should the prototype follow BNSS procedures and support BSA Section 63 certificates, or stay generic for now?"
4. **Output:** "Are we aiming for a reproduction-and-critique write-up, an extended system, or both?"
5. **Evaluation:** "Is there a scenario or dataset you'd like it tested on, for example a mock case end to end?"

---

## Backup: likely questions and short answers

| If the professor asks... | Answer |
|---|---|
| "Did the authors' transfer ever work?" | "It can only succeed if both peers happen to run in the same millisecond. Their paper shows a transfer screen, but on the default two-org network it failed in my run. With a single endorsing org it would have worked, which may be how they tested it." *(Be clear the last part is a guess.)* |
| "Why Hyperledger Fabric and not Ethereum?" | "It's permissioned: only known agencies join, there are no transaction fees, identities come from certificates, and data can be kept private between agencies. The other paper I looked at, Chain4ensic from Politecnico di Milano, uses Ethereum. That works for public access notifications, but it's harder to keep case data private." |
| "Where is the evidence stored?" | "In their system, nowhere. Only the typed text is on the ledger, inside Docker volumes on the peers. The design I'm proposing keeps the files encrypted off-chain with the hash on the ledger." |
| "How long will the rebuild take?" | "I'd first agree the data model and the organisations with you, then build in stages: the event model and identity first, then storage and verification, then evaluation." *(Don't commit to dates yet.)* |
| "What did you change in their code?" | "Only what was needed to run it: a Dockerfile to run the smart contract as a service, and the frontend's server address changed from their dead cloud IP to localhost. Their logic is untouched. It's one commit on GitHub, so the difference is visible." |

---

## After the meeting

```bash
# Ctrl+C the gateway and frontend, then:
cd ~/Projects/Blockchain/CustodyChain/backend/network && ./network.sh down
```

Write down the professor's answers to section 5. They decide the data model for the rebuild.
