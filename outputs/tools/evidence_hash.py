#!/usr/bin/env python3
"""
evidence_hash.py: reference implementation of the CustodyChain evidence fingerprinting spec v1.0.

Two layers:
  L1 integrity  : exact cryptographic hashes (SHA-256 + SHA3-256) of every captured artefact (file),
                  combined into a salted RFC 6962 Merkle tree, and an RFC 8785 canonical manifest whose
                  SHA-256 is anchored on the ledger. Proves "these bytes have not changed".
  L2 identity   : tolerant fingerprints (DCT perceptual hash for images, ICP RMS for 3D scans) used to
                  re-identify a physical item or visual content later. Gives evidence of
                  "this is the same item"; it is never an integrity proof.

Subcommands:
  hash FILE...                      SHA-256 / SHA3-256 / size of files
  manifest IN.json OUT.json --base DIR [--demo-seed S]
                                    fill artefact hashes + salts + Merkle root; print manifest hash
  verify MANIFEST.json --base DIR   re-hash every artefact and check the Merkle root and manifest hash
  validate MANIFEST.json            validate against outputs/spec/evidence-manifest.schema.json
  ledger-record MANIFEST.json       print the on-chain record derived from a manifest
  prove MANIFEST.json ARTEFACT_ID   print a Merkle inclusion proof for one artefact
  phash IMAGE...                    64-bit DCT perceptual hash (and dHash)
  compare-images A B                SHA-256 equality + perceptual Hamming distance
  compare-mesh REF.ply QUERY.ply    rigid ICP alignment, RMS deviation in mm

Only the Python standard library, numpy, Pillow (images) and jsonschema (validation) are needed.
"""
from __future__ import annotations

import argparse
import hashlib
import hmac
import json
import os
import secrets
import sys
from pathlib import Path

SPEC_DIR = Path(__file__).resolve().parent.parent / "spec"
CHUNK = 1 << 20  # 1 MiB streaming block

# ----------------------------------------------------------------------------------------------
# L1: file hashing
# ----------------------------------------------------------------------------------------------

def hash_file(path: str | os.PathLike) -> dict:
    """Stream a file once and return its size, SHA-256 and SHA3-256 (hex)."""
    h2, h3, n = hashlib.sha256(), hashlib.sha3_256(), 0
    with open(path, "rb") as f:
        while block := f.read(CHUNK):
            h2.update(block)
            h3.update(block)
            n += len(block)
    return {"size_bytes": n, "sha256": h2.hexdigest(), "sha3_256": h3.hexdigest()}


def chunk_merkle_root(path: str | os.PathLike, chunk_size: int) -> str:
    """Unsalted RFC 6962 Merkle root over fixed-size chunks of a file (localises damage in big files)."""
    leaves = []
    with open(path, "rb") as f:
        while block := f.read(chunk_size):
            leaves.append(block)
    return mth(leaves).hex()

# ----------------------------------------------------------------------------------------------
# RFC 8785 JSON Canonicalization Scheme (JCS), restricted profile: no floating-point numbers
# ----------------------------------------------------------------------------------------------

def _jcs_string(s: str) -> str:
    out = ['"']
    for ch in s:
        o = ord(ch)
        if ch == '"':
            out.append('\\"')
        elif ch == "\\":
            out.append("\\\\")
        elif ch == "\b":
            out.append("\\b")
        elif ch == "\f":
            out.append("\\f")
        elif ch == "\n":
            out.append("\\n")
        elif ch == "\r":
            out.append("\\r")
        elif ch == "\t":
            out.append("\\t")
        elif o < 0x20:
            out.append("\\u%04x" % o)
        else:
            out.append(ch)
    out.append('"')
    return "".join(out)


def _utf16_key(s: str):
    return s.encode("utf-16-be")  # JCS sorts property names by UTF-16 code units


def jcs(value) -> bytes:
    """Serialise a JSON value to its RFC 8785 canonical UTF-8 bytes."""
    def enc(v) -> str:
        if v is None:
            return "null"
        if v is True:
            return "true"
        if v is False:
            return "false"
        if isinstance(v, int):
            if abs(v) > 2**53 - 1:
                raise ValueError("integer outside the IEEE-754 safe range; carry it as a string")
            return str(v)
        if isinstance(v, float):
            raise ValueError("floating-point numbers are not allowed in manifests; use a decimal string")
        if isinstance(v, str):
            return _jcs_string(v)
        if isinstance(v, list):
            return "[" + ",".join(enc(x) for x in v) + "]"
        if isinstance(v, dict):
            items = sorted(v.items(), key=lambda kv: _utf16_key(kv[0]))
            return "{" + ",".join(_jcs_string(k) + ":" + enc(x) for k, x in items) + "}"
        raise TypeError(f"not a JSON value: {type(v)!r}")
    return enc(value).encode("utf-8")


def manifest_hash(manifest: dict) -> str:
    return hashlib.sha256(jcs(manifest)).hexdigest()

# ----------------------------------------------------------------------------------------------
# RFC 6962 Merkle tree (domain-separated: 0x00 leaf, 0x01 node), salted leaves
# ----------------------------------------------------------------------------------------------

def _leaf_hash(data: bytes) -> bytes:
    return hashlib.sha256(b"\x00" + data).digest()


def _node_hash(left: bytes, right: bytes) -> bytes:
    return hashlib.sha256(b"\x01" + left + right).digest()


def _split(n: int) -> int:
    """Largest power of two strictly less than n (n >= 2)."""
    k = 1
    while k << 1 < n:
        k <<= 1
    return k


def mth(leaves: list[bytes]) -> bytes:
    """Merkle Tree Hash per RFC 6962 section 2.1."""
    n = len(leaves)
    if n == 0:
        return hashlib.sha256(b"").digest()
    if n == 1:
        return _leaf_hash(leaves[0])
    k = _split(n)
    return _node_hash(mth(leaves[:k]), mth(leaves[k:]))


def inclusion_path(m: int, leaves: list[bytes]) -> list[bytes]:
    """RFC 6962 audit path for leaf index m."""
    n = len(leaves)
    if n <= 1:
        return []
    k = _split(n)
    if m < k:
        return inclusion_path(m, leaves[:k]) + [mth(leaves[k:])]
    return inclusion_path(m - k, leaves[k:]) + [mth(leaves[:k])]


def verify_inclusion(leaf_data: bytes, index: int, size: int, path: list[bytes], root: bytes) -> bool:
    """RFC 9162 section 2.1.3.2 verification of an inclusion proof."""
    if index >= size:
        return False
    fn, sn = index, size - 1
    r = _leaf_hash(leaf_data)
    for p in path:
        if sn == 0:
            return False
        if fn & 1 or fn == sn:
            r = _node_hash(p, r)
            if not fn & 1:
                while fn & 1 == 0 and fn != 0:
                    fn >>= 1
                    sn >>= 1
        else:
            r = _node_hash(r, p)
        fn >>= 1
        sn >>= 1
    return sn == 0 and hmac.compare_digest(r, root)


def artefact_leaf(a: dict) -> bytes:
    """Leaf data = salt (32 B) || artefact_id (ASCII) || sha256 (32 B). The salt stops a party holding a
    candidate file from confirming, from public leaf hashes alone, that it is part of a case."""
    return bytes.fromhex(a["leaf_salt"]) + a["artefact_id"].encode("ascii") + bytes.fromhex(a["sha256"])


def ordered_artefacts(manifest: dict) -> list[dict]:
    return sorted(manifest["artefacts"], key=lambda a: (a.get("sequence", 0), a["artefact_id"]))


def manifest_merkle_root(manifest: dict) -> str:
    return mth([artefact_leaf(a) for a in ordered_artefacts(manifest)]).hex()

# ----------------------------------------------------------------------------------------------
# L2: identity fingerprints
# ----------------------------------------------------------------------------------------------

def _gray_array(path, size):
    from PIL import Image
    import numpy as np
    with Image.open(path) as im:
        im = im.convert("L").resize(size, Image.Resampling.LANCZOS)
        return np.asarray(im, dtype=np.float64)


def _dct_matrix(n: int):
    import numpy as np
    k = np.arange(n)[:, None]
    i = np.arange(n)[None, :]
    m = np.cos(np.pi * (2 * i + 1) * k / (2 * n)) * np.sqrt(2.0 / n)
    m[0, :] = np.sqrt(1.0 / n)
    return m


def phash(path) -> str:
    """64-bit DCT perceptual hash: 32x32 grey -> 2-D DCT-II -> 8x8 lowest frequencies -> bit = coeff > median
    (median taken over the 63 AC coefficients)."""
    import numpy as np
    g = _gray_array(path, (32, 32))
    d = _dct_matrix(32)
    coeffs = (d @ g @ d.T)[:8, :8].flatten()
    med = np.median(coeffs[1:])
    bits = coeffs > med
    return "%016x" % int("".join("1" if b else "0" for b in bits), 2)


def dhash(path) -> str:
    """64-bit difference hash: 9x8 grey, bit = pixel brighter than its right neighbour."""
    g = _gray_array(path, (9, 8))
    bits = (g[:, 1:] > g[:, :-1]).flatten()
    return "%016x" % int("".join("1" if b else "0" for b in bits), 2)


def hamming(a_hex: str, b_hex: str) -> int:
    return bin(int(a_hex, 16) ^ int(b_hex, 16)).count("1")


def load_ply_points(path):
    """Read vertex x y z from an ASCII PLY (as written by make_worked_examples.py and most scanners' exports)."""
    import numpy as np
    with open(path, "r", encoding="ascii") as f:
        n = None
        for line in f:
            if line.startswith("element vertex"):
                n = int(line.split()[2])
            if line.strip() == "end_header":
                break
        pts = [list(map(float, f.readline().split()[:3])) for _ in range(n)]
    return np.asarray(pts)


def _nearest(src, dst):
    import numpy as np
    try:
        from scipy.spatial import cKDTree  # fast path
        dist, idx = cKDTree(dst).query(src)
        return idx, dist
    except ImportError:
        pass
    idx = np.empty(len(src), dtype=np.int64)
    dist = np.empty(len(src))
    for s in range(0, len(src), 512):
        block = src[s:s + 512]
        d2 = ((block[:, None, :] - dst[None, :, :]) ** 2).sum(-1)
        j = d2.argmin(1)
        idx[s:s + 512] = j
        dist[s:s + 512] = np.sqrt(d2[np.arange(len(block)), j])
    return idx, dist


def _kabsch(p, q):
    import numpy as np
    pc, qc = p.mean(0), q.mean(0)
    h = (p - pc).T @ (q - qc)
    u, _, vt = np.linalg.svd(h)
    dfix = np.diag([1, 1, np.sign(np.linalg.det(vt.T @ u.T))])
    r = vt.T @ dfix @ u.T
    return r, qc - r @ pc


def compare_mesh(ref_path, query_path, iterations: int = 40) -> dict:
    """Rigidly align QUERY to REF (PCA initialisation over the 4 proper sign flips, then point-to-point ICP)
    and report the RMS / 95th-percentile / max nearest-neighbour deviation in the scan's units (mm)."""
    import numpy as np
    ref, qry = load_ply_points(ref_path), load_ply_points(query_path)

    def pca_frame(x):
        c = x.mean(0)
        _, _, vt = np.linalg.svd(x - c, full_matrices=False)
        return c, vt

    rc, rv = pca_frame(ref)
    qc, qv = pca_frame(qry)
    best = None
    for sx, sy in [(1, 1), (1, -1), (-1, 1), (-1, -1)]:
        s = np.diag([sx, sy, sx * sy])  # keep det = +1
        r0 = rv.T @ s @ qv
        cur = (qry - qc) @ r0.T + rc
        for _ in range(iterations):
            idx, _ = _nearest(cur, ref)
            r, t = _kabsch(cur, ref[idx])
            cur = cur @ r.T + t
        # Symmetric deviation: query->reference catches added/moved material,
        # reference->query catches MISSING material (a nick, a broken tip), which one direction alone cannot see.
        _, d_qr = _nearest(cur, ref)
        _, d_rq = _nearest(ref, cur)
        both = np.concatenate([d_qr, d_rq])
        rms = float(np.sqrt((both ** 2).mean()))
        if best is None or rms < best["rms"]:
            best = {"rms": rms, "p95": float(np.percentile(both, 95)), "max": float(both.max()),
                    "max_qr": float(d_qr.max()), "max_rq": float(d_rq.max())}
    return {"rms_mm": round(best["rms"], 4), "p95_mm": round(best["p95"], 4), "max_mm": round(best["max"], 4),
            "max_query_to_ref_mm": round(best["max_qr"], 4), "max_ref_to_query_mm": round(best["max_rq"], 4),
            "ref_points": int(len(ref)), "query_points": int(len(qry))}

# ----------------------------------------------------------------------------------------------
# Manifest build / verify / validate
# ----------------------------------------------------------------------------------------------

def _salt(artefact_id: str, demo_seed: str | None) -> str:
    if demo_seed is None:
        return secrets.token_hex(32)
    # Deterministic salts ONLY for reproducible documentation examples, never in production.
    return hashlib.sha256(f"demo-salt|{demo_seed}|{artefact_id}".encode()).hexdigest()


def build_manifest(draft: dict, base: Path, demo_seed: str | None = None) -> dict:
    m = json.loads(json.dumps(draft))  # deep copy
    by_id = {}
    for a in m["artefacts"]:
        h = hash_file(base / a["file_name"])
        a.update(h)
        a.setdefault("leaf_salt", _salt(a["artefact_id"], demo_seed))
        by_id[a["artefact_id"]] = a
    for fp in m.get("identity_fingerprints", []):
        if fp.get("value") == "auto":
            src = base / by_id[fp["source_artefact_ids"][0]]["file_name"]
            if fp["method"] == "phash-dct-64":
                fp["value"] = phash(src)
            elif fp["method"] == "dhash-64":
                fp["value"] = dhash(src)
            elif fp["method"] == "mesh-icp-rms":
                fp["value"] = by_id[fp["source_artefact_ids"][0]]["sha256"]
    m["integrity"] = {
        "hash_algorithms": ["SHA-256", "SHA3-256"],
        "merkle_scheme": "RFC6962-SHA256-salted-v1",
        "merkle_root": manifest_merkle_root(m),
        "canonicalisation": "RFC8785-JCS",
    }
    return m


def ledger_record(m: dict) -> dict:
    return {
        "evidence_id": m["evidence_id"],
        "evidence_class": m["evidence_class"],
        "parent_evidence_id": m.get("parent_evidence_id"),
        "manifest_sha256": manifest_hash(m),
        "merkle_root": m["integrity"]["merkle_root"],
        "artefact_count": len(m["artefacts"]),
        "spec_version": m["spec_version"],
    }


def verify_manifest(m: dict, base: Path, ledger: dict | None = None) -> list[str]:
    """Check (1) every stored file against the manifest, (2) the Merkle root recomputed from the FILES,
    (3) the manifest's internal Merkle root, and (4) optionally the manifest hash and root against the ledger."""
    problems = []
    from_files = json.loads(json.dumps(m))
    for a, af in zip(m["artefacts"], from_files["artefacts"]):
        p = base / a["file_name"]
        if not p.exists():
            problems.append(f"{a['artefact_id']}: file missing ({a['file_name']})")
            continue
        h = hash_file(p)
        af["sha256"] = h["sha256"]
        for k in ("size_bytes", "sha256", "sha3_256"):
            if h[k] != a[k]:
                problems.append(f"{a['artefact_id']} ({a['file_name']}): {k} mismatch: manifest {a[k]} != file {h[k]}")
    files_root = manifest_merkle_root(from_files)
    if files_root != m["integrity"]["merkle_root"]:
        problems.append(f"Merkle root from files mismatch: manifest {m['integrity']['merkle_root']} != files {files_root}")
    if manifest_merkle_root(m) != m["integrity"]["merkle_root"]:
        problems.append("Manifest internally inconsistent: its artefact hashes do not produce its Merkle root")
    if ledger is not None:
        mh = manifest_hash(m)
        if mh != ledger["manifest_sha256"]:
            problems.append(f"Manifest hash mismatch: ledger {ledger['manifest_sha256']} != manifest {mh}")
        if m["integrity"]["merkle_root"] != ledger["merkle_root"]:
            problems.append(f"Merkle root mismatch: ledger {ledger['merkle_root']} != manifest {m['integrity']['merkle_root']}")
    return problems


def validate(m: dict, schema_name: str = "evidence-manifest.schema.json") -> list[str]:
    import jsonschema
    schema = json.loads((SPEC_DIR / schema_name).read_text())
    v = jsonschema.Draft202012Validator(schema)
    return [f"{'/'.join(map(str, e.absolute_path)) or '<root>'}: {e.message}" for e in sorted(v.iter_errors(m), key=str)]

# ----------------------------------------------------------------------------------------------
# CLI
# ----------------------------------------------------------------------------------------------

def _load(p):
    return json.loads(Path(p).read_text())


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sp = ap.add_subparsers(dest="cmd", required=True)
    s = sp.add_parser("hash"); s.add_argument("files", nargs="+")
    s = sp.add_parser("manifest"); s.add_argument("draft"); s.add_argument("out"); s.add_argument("--base", default=".")
    s.add_argument("--demo-seed", default=None)
    s = sp.add_parser("verify"); s.add_argument("manifest"); s.add_argument("--base", default=".")
    s = sp.add_parser("validate"); s.add_argument("file"); s.add_argument("--schema", default="evidence-manifest.schema.json")
    s = sp.add_parser("ledger-record"); s.add_argument("manifest")
    s = sp.add_parser("prove"); s.add_argument("manifest"); s.add_argument("artefact_id")
    s = sp.add_parser("phash"); s.add_argument("images", nargs="+")
    s = sp.add_parser("compare-images"); s.add_argument("a"); s.add_argument("b")
    s = sp.add_parser("compare-mesh"); s.add_argument("ref"); s.add_argument("query")
    a = ap.parse_args(argv)

    if a.cmd == "hash":
        for f in a.files:
            print(json.dumps({"file": f, **hash_file(f)}))
    elif a.cmd == "manifest":
        m = build_manifest(_load(a.draft), Path(a.base), a.demo_seed)
        Path(a.out).write_text(json.dumps(m, indent=2, ensure_ascii=False) + "\n")
        print(json.dumps(ledger_record(m), indent=2))
    elif a.cmd == "verify":
        m = _load(a.manifest)
        probs = verify_manifest(m, Path(a.base))
        print("manifest_sha256:", manifest_hash(m))
        print("\n".join(probs) if probs else "OK: all artefacts, sizes, hashes and the Merkle root verify")
        return 1 if probs else 0
    elif a.cmd == "validate":
        doc = _load(a.file)
        docs = doc if isinstance(doc, list) else [doc]
        errs = [f"[{i}] {e}" if len(docs) > 1 else e for i, d in enumerate(docs) for e in validate(d, a.schema)]
        print("\n".join(errs) if errs else f"OK: valid against {a.schema}")
        return 1 if errs else 0
    elif a.cmd == "ledger-record":
        print(json.dumps(ledger_record(_load(a.manifest)), indent=2))
    elif a.cmd == "prove":
        m = _load(a.manifest)
        arts = ordered_artefacts(m)
        idx = next(i for i, x in enumerate(arts) if x["artefact_id"] == a.artefact_id)
        leaves = [artefact_leaf(x) for x in arts]
        path = inclusion_path(idx, leaves)
        ok = verify_inclusion(leaves[idx], idx, len(leaves), path, bytes.fromhex(m["integrity"]["merkle_root"]))
        print(json.dumps({"artefact_id": a.artefact_id, "leaf_index": idx, "tree_size": len(leaves),
                          "leaf_salt": arts[idx]["leaf_salt"], "sha256": arts[idx]["sha256"],
                          "audit_path": [p.hex() for p in path], "merkle_root": m["integrity"]["merkle_root"],
                          "verifies": ok}, indent=2))
    elif a.cmd == "phash":
        for f in a.images:
            print(json.dumps({"file": f, "phash": phash(f), "dhash": dhash(f)}))
    elif a.cmd == "compare-images":
        ha, hb = hash_file(a.a), hash_file(a.b)
        pa, pb = phash(a.a), phash(a.b)
        print(json.dumps({"sha256_equal": ha["sha256"] == hb["sha256"], "phash_a": pa, "phash_b": pb,
                          "phash_hamming": hamming(pa, pb), "dhash_hamming": hamming(dhash(a.a), dhash(a.b))}, indent=2))
    elif a.cmd == "compare-mesh":
        print(json.dumps(compare_mesh(a.ref, a.query), indent=2))
    return 0


if __name__ == "__main__":
    sys.exit(main())
