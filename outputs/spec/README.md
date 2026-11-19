# CustodyChain Evidence Input Specification v1.0

These schemas are the machine-readable form of the input specification in the report (`outputs/report/main.pdf`, Appendix A).

| File | What it defines |
|---|---|
| `evidence-manifest.schema.json` | The **evidence manifest**: the canonical off-chain record of one evidence item. It covers case, collection, packaging, class-specific attributes for 12 evidence classes, every captured artefact with SHA-256 and SHA3-256, identity fingerprints, and the salted Merkle root. |
| `custody-event.schema.json` | One **lifecycle event** (register, transfer, examine, verify, derive, submit to court, dispose, ...) as submitted to the chaincode. |
| `examples/` | Example manifests and events produced by `outputs/tools/make_worked_examples.py`. All of them validate against the schemas. |

## What goes on the ledger

Only the following are written to the ledger:
- `evidence_id`, `evidence_class`
- `manifest_sha256`: SHA-256 of the RFC 8785 (JCS) canonical form of the manifest
- `merkle_root`: RFC 6962 Merkle tree over salted artefact leaves
- custody events

The actor and the time of each event come from the transaction's certificate and timestamp, never from the client. Files and manifests stay off-chain in encrypted evidence storage.

## Validate

```bash
python3 outputs/tools/evidence_hash.py validate outputs/spec/examples/notebook.manifest.json
```
