#!/usr/bin/env python3
"""
make_worked_examples.py: generate the worked examples used in the report, with real computed values.

Creates synthetic but realistic artefacts, builds and validates evidence manifests, runs L1 (integrity)
and L2 (identity) checks under tampering and re-capture scenarios, and writes:

  outputs/worked-example/files/...      generated artefacts (regenerable; not committed)
  outputs/spec/examples/*.json          manifests, ledger records, events (validated against the schemas)
  outputs/report/generated/*.tex        tables and macros \\input by the report
  outputs/report/figures/*.png|jpg      small figures for the report
  outputs/worked-example/results.json   every number, machine-readable

Deterministic: fixed RNG seeds and demo salts (--demo-seed), so reruns with the same library versions
reproduce the same bytes and hashes.
"""
from __future__ import annotations

import json
import shutil
import sys
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFont

sys.path.insert(0, str(Path(__file__).resolve().parent))
import evidence_hash as eh  # noqa: E402

ROOT = Path(__file__).resolve().parent.parent          # outputs/
FILES = ROOT / "worked-example" / "files"
EXAMPLES = ROOT / "spec" / "examples"
GEN = ROOT / "report" / "generated"
FIG = ROOT / "report" / "figures"
SEED = "custodychain-report-2026-11"

CASE = {"fir_number": "123/2026", "police_station": "Cyber Crime Police Station Gandhinagar",
        "district": "Gandhinagar", "state": "Gujarat", "sections_invoked": ["BNS s.318(4)", "BNS s.61(2)"],
        "court": "Chief Judicial Magistrate, Gandhinagar"}
IO = {"name": "Insp. A. Sharma", "role": "Investigating Officer", "designation": "Police Inspector",
      "badge_or_employee_id": "GJP-44821", "organisation": "Gujarat Police",
      "pki_subject": "CN=a.sharma,OU=client,O=police.custodychain.local"}
WITNESSES = [{"name": "R. Patel", "role": "Independent Witness", "address": "Sector 21, Gandhinagar"},
             {"name": "M. Desai", "role": "Independent Witness", "address": "Sector 22, Gandhinagar"}]
LOC = {"description": "Office premises of accused, ground floor, room 2", "address": "Plot 14, GIDC, Gandhinagar",
       "latitude": "23.2156", "longitude": "72.6369", "position_source": "GNSS"}
PHONE = {"device_type": "Mobile", "make_model": "Departmental smartphone (ICJS spec)", "serial_number": "R58N91XKQ2",
         "imei_uin_uid_mac_cloud_id": "IMEI 356938035643809", "software": "e-Sakshya (simulated)",
         "clock_check": {"reference": "NTP via mobile network", "offset_seconds": 0}}
SCANNER = {"device_type": "Flatbed Scanner", "make_model": "A4 flatbed, 600 dpi optical (simulated)",
           "serial_number": "FBS-0091", "software": "scan utility 4.2 (simulated)"}
SCANNER3D = {"device_type": "3D Scanner", "make_model": "Structured-light handheld scanner (simulated)",
             "serial_number": "SL3D-2207", "software": "scan suite 3.1 (simulated)"}


def font(size):
    for p in ["/usr/share/fonts/TTF/DejaVuSans.ttf", "/usr/share/fonts/dejavu/DejaVuSans.ttf",
              "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf", "/usr/share/fonts/noto/NotoSans-Regular.ttf"]:
        if Path(p).exists():
            return ImageFont.truetype(p, size)
    return ImageFont.load_default()


def hx(h: str, n: int | None = None) -> str:
    """Hex string for LaTeX, breakable every 8 characters; optionally truncated to n chars."""
    s = h if n is None else h[:n]
    body = r"\allowbreak{}".join(s[i:i + 8] for i in range(0, len(s), 8))
    return r"\texttt{" + body + ("\\ldots" if n is not None and n < len(h) else "") + "}"


def tex_escape(s: str) -> str:
    rep = {"&": r"\&", "%": r"\%", "$": r"\$", "#": r"\#", "_": r"\_", "{": r"\{", "}": r"\}",
           "~": r"\textasciitilde{}", "^": r"\textasciicircum{}", "\\": r"\textbackslash{}"}
    return "".join(rep.get(c, c) for c in s)


def write(path: Path, text: str):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(text)


def add_noise(im: Image.Image, sigma: float, rng) -> Image.Image:
    a = np.asarray(im).astype(np.float64)
    a = np.clip(a + rng.normal(0, sigma, a.shape), 0, 255).astype(np.uint8)
    return Image.fromarray(a, im.mode)


def save_jpeg_with_exif(im: Image.Image, path: Path, when: str, quality=92):
    exif = Image.Exif()
    exif[0x010F] = "DeptPhone"            # Make
    exif[0x0110] = "ICJS-Spec-1"          # Model
    exif[0x0132] = when                   # DateTime
    ifd = exif.get_ifd(0x8769)
    ifd[0x9003] = when                    # DateTimeOriginal
    im.save(path, "JPEG", quality=quality, exif=exif.tobytes(), optimize=False, subsampling=0)


# ================================================================================================
# A. Crime-scene photograph: L1 vs L2 under copy, re-save, metadata edit, re-shoot, tamper
# ================================================================================================

def draw_scene(variant="A", erase_knife=False):
    W, H = 1600, 1200
    im = Image.new("RGB", (W, H), (184, 176, 160))
    d = ImageDraw.Draw(im)
    for x in range(0, W, 160):             # floor tiles
        d.line([(x, 0), (x, H)], fill=(160, 152, 138), width=3)
    for y in range(0, H, 160):
        d.line([(0, y), (W, y)], fill=(160, 152, 138), width=3)
    if variant == "A":
        d.rectangle([980, 140, 1480, 560], fill=(120, 82, 50), outline=(70, 45, 25), width=6)   # table
        d.ellipse([430, 610, 760, 820], fill=(122, 18, 20))                                     # stain
        d.ellipse([520, 650, 600, 700], fill=(150, 30, 30))
        if not erase_knife:
            d.polygon([(560, 470), (900, 420), (905, 438), (566, 492)], fill=(205, 208, 212), outline=(90, 90, 95))
            d.rectangle([470, 470, 566, 500], fill=(30, 30, 32))
        d.polygon([(300, 900), (380, 900), (340, 820)], fill=(250, 210, 20), outline=(40, 40, 0))  # marker 1
        d.text((330, 860), "1", fill=(0, 0, 0), font=font(40))
        d.polygon([(1150, 760), (1230, 760), (1190, 680)], fill=(250, 210, 20), outline=(40, 40, 0))  # marker 2
        d.text((1180, 720), "2", fill=(0, 0, 0), font=font(40))
        d.rectangle([1000, 820, 1100, 870], fill=(30, 60, 140))                                 # phone on floor
    else:  # a different scene
        d.rectangle([150, 700, 700, 1100], fill=(60, 90, 60), outline=(20, 40, 20), width=6)
        d.ellipse([1000, 200, 1400, 500], fill=(90, 15, 15))
        d.polygon([(1200, 900), (1280, 900), (1240, 820)], fill=(250, 210, 20))
        d.text((1230, 860), "3", fill=(0, 0, 0), font=font(40))
    for i in range(0, 501, 10):            # scale ruler (mm ticks)
        x = 200 + i * 1.2
        d.line([(x, 1080), (x, 1080 - (30 if i % 50 == 0 else 15))], fill=(0, 0, 0), width=2)
    d.rectangle([200, 1080, 800, 1100], fill=(240, 240, 240), outline=(0, 0, 0))
    d.text((200, 1105), "0", fill=(0, 0, 0), font=font(24))
    d.text((770, 1105), "50 cm", fill=(0, 0, 0), font=font(24))
    return im


def scenario_photo(results):
    out = FILES / "photo"
    out.mkdir(parents=True, exist_ok=True)
    rng = np.random.default_rng(11)
    when = "2026:11:19 10:42:05"

    base = add_noise(draw_scene("A"), 2.0, np.random.default_rng(1))
    save_jpeg_with_exif(base, out / "IMG_0001.jpg", when)

    shutil.copyfile(out / "IMG_0001.jpg", out / "IMG_0001_exact_copy.jpg")                 # 1 exact copy

    with Image.open(out / "IMG_0001.jpg") as im:                                           # 2 re-saved
        im.load()
        save_jpeg_with_exif(im.copy(), out / "IMG_0001_resaved.jpg", when, quality=92)

    with Image.open(out / "IMG_0001.jpg") as im:                                           # 3 metadata edit only
        im.load()
        exif = im.getexif()
        exif[0x0132] = "2026:11:18 22:10:00"
        im.save(out / "IMG_0001_exif_edited.jpg", "JPEG", quality="keep", exif=exif.tobytes())

    second = draw_scene("A").rotate(0.8, resample=Image.Resampling.BICUBIC, translate=(9, -6),     # 4 re-shoot
                                    fillcolor=(184, 176, 160))
    second = Image.eval(second, lambda v: min(255, int(v * 1.05)))
    second = add_noise(second, 3.0, rng)
    save_jpeg_with_exif(second, out / "IMG_0002_second_shot.jpg", "2026:11:19 10:42:09")

    tampered = add_noise(draw_scene("A", erase_knife=True), 2.0, np.random.default_rng(1))  # 5 knife erased
    save_jpeg_with_exif(tampered, out / "IMG_0001_knife_removed.jpg", when)

    other = add_noise(draw_scene("B"), 2.0, np.random.default_rng(2))                      # 6 different scene
    save_jpeg_with_exif(other, out / "IMG_0107_other_scene.jpg", "2026:11:19 11:05:40")

    variants = [
        ("IMG_0001.jpg", "Original file as produced by the device"),
        ("IMG_0001_exact_copy.jpg", "Byte-for-byte copy (e.g. to the master-negative disk)"),
        ("IMG_0001_resaved.jpg", "Opened and re-saved as JPEG (same quality setting)"),
        ("IMG_0001_exif_edited.jpg", "Only the EXIF date/time edited; pixels untouched"),
        ("IMG_0002_second_shot.jpg", "Second photograph of the same scene, seconds later"),
        ("IMG_0001_knife_removed.jpg", "Original with the knife digitally removed"),
        ("IMG_0107_other_scene.jpg", "Photograph of a different scene"),
    ]
    ref = eh.hash_file(out / variants[0][0])
    ref_ph = eh.phash(out / variants[0][0])
    rows = []
    for fn, desc in variants:
        h = eh.hash_file(out / fn)
        ph = eh.phash(out / fn)
        dist = eh.hamming(ref_ph, ph)
        same = h["sha256"] == ref["sha256"]
        rows.append({"file": fn, "description": desc, "sha256": h["sha256"], "size": h["size_bytes"],
                     "sha256_equal": same, "phash": ph, "phash_hamming": dist})
    results["photo"] = {"threshold": 10, "rows": rows}

    lines = [r"\begin{tabular}{@{}p{0.30\linewidth}p{0.25\linewidth}cc>{\centering\arraybackslash}p{0.11\linewidth}@{}}",
             r"\toprule",
             r"Variant of \texttt{IMG\_0001} & SHA-256 (first 16 hex) & L1 equal? & pHash $d_H$ & L2 ($d_H\le 10$)\\",
             r"\midrule"]
    for r in rows:
        lines.append(f"{tex_escape(r['description'])} & {hx(r['sha256'], 16)} & "
                     f"{'yes' if r['sha256_equal'] else r'\textbf{no}'} & {r['phash_hamming']} & "
                     f"{'same' if r['phash_hamming'] <= 10 else 'different'}\\\\")
    lines += [r"\bottomrule", r"\end{tabular}"]
    write(GEN / "photo_table.tex", "\n".join(lines) + "\n")

    # figure thumbnails
    FIG.mkdir(parents=True, exist_ok=True)
    for fn, name in [("IMG_0001.jpg", "scene_original"), ("IMG_0002_second_shot.jpg", "scene_second"),
                     ("IMG_0001_knife_removed.jpg", "scene_tampered")]:
        with Image.open(out / fn) as im:
            im.convert("RGB").resize((480, 360), Image.Resampling.LANCZOS).save(FIG / f"{name}.jpg", quality=85)

    # manifest for the original photograph (one SCENE_PHOTOGRAPH item)
    draft = {
        "spec_version": "1.0", "evidence_id": "GJ-GNR-CYBPS-2026-000123-E001", "parent_evidence_id": None,
        "evidence_class": "SCENE_PHOTOGRAPH", "title": "Scene photograph: overall view of room 2 with markers 1-2",
        "description": "Overall view taken by the first responder on entering room 2, before any item was moved.",
        "case": CASE,
        "collection": {"collected_at": "2026-11-19T10:42:05+05:30", "location": LOC, "collected_by": IO,
                       "witnesses": WITNESSES, "legal_basis": "BNSS s.176(3) scene of crime; BNSS s.105 search",
                       "av_recording_ref": "GJ-GNR-CYBPS-2026-000123-E010"},
        "packaging": {"container": "none (born-digital); file on departmental phone"},
        "class_attributes": {"photo_series_id": "SOC-123-2026-A", "frame_number": 1, "view": "overall",
                             "scale_present": True, "colour_reference_present": False,
                             "subject": "Room 2: knife near stain (marker 1), phone (marker 2)",
                             "original_format": "JPEG", "flash": False},
        "artefacts": [{"artefact_id": "A001", "sequence": 1, "role": "scene_photo", "media_type": "image/jpeg",
                       "file_name": "photo/IMG_0001.jpg", "captured_at": "2026-11-19T10:42:05+05:30",
                       "hashed_at": "2026-11-19T10:42:06+05:30", "hashed_on": "capture device",
                       "capture_device": PHONE,
                       "capture_parameters": {"resolution": "1600x1200", "jpeg_quality": "92", "exposure": "auto"}}],
        "identity_fingerprints": [{"method": "phash-dct-64", "method_version": "1", "source_artefact_ids": ["A001"],
                                   "value": "auto", "match_rule": "hamming<=10"}],
    }
    return draft


# ================================================================================================
# B. Recovered notebook (physical document): per-page scans, Merkle tree, rescan, page substitution
# ================================================================================================

PAGE_W, PAGE_H = 1240, 1748          # A6 at 300 dpi


def draw_page(page_no: int, content_seed: int) -> Image.Image:
    rng = np.random.default_rng(content_seed)
    im = Image.new("L", (PAGE_W, PAGE_H), 246)
    d = ImageDraw.Draw(im)
    for y in range(180, PAGE_H - 60, 70):
        d.line([(60, y), (PAGE_W - 60, y)], fill=200, width=2)
    d.line([(150, 0), (150, PAGE_H)], fill=170, width=2)
    d.text((PAGE_W - 150, 60), f"- {page_no} -", fill=60, font=font(36))
    for y in range(180, PAGE_H - 140, 70):        # pseudo-handwriting: word-like stroke clusters
        if rng.random() < 0.15:
            continue
        x = 175
        while x < PAGE_W - 150:
            wlen = int(rng.integers(50, 190))
            pts, cx = [], x
            while cx < x + wlen:
                pts.append((cx, y - 8 - int(rng.integers(0, 34))))
                cx += int(rng.integers(6, 16))
            d.line(pts, fill=int(rng.integers(20, 70)), width=3)
            x += wlen + int(rng.integers(25, 60))
    if page_no == 3:                               # a distinguishing mark on page 3: torn corner + stain
        d.polygon([(PAGE_W, PAGE_H - 220), (PAGE_W, PAGE_H), (PAGE_W - 180, PAGE_H)], fill=255)
        d.ellipse([820, 1100, 1060, 1320], outline=150, width=12)
    return im


def rescan(im: Image.Image, rng) -> Image.Image:
    r = im.rotate(float(rng.uniform(-0.6, 0.6)), resample=Image.Resampling.BICUBIC,
                  translate=(int(rng.integers(-8, 9)), int(rng.integers(-8, 9))), fillcolor=246)
    r = Image.eval(r, lambda v: int(v * 0.97))
    return add_noise(r, 2.5, rng)


def draw_cover() -> Image.Image:
    im = Image.new("RGB", (1200, 1600), (35, 70, 120))
    d = ImageDraw.Draw(im)
    for y in range(80, 1560, 60):                       # spiral binding
        d.ellipse([20, y, 70, y + 36], outline=(200, 200, 205), width=6)
    d.rectangle([300, 300, 1000, 520], fill=(235, 230, 215))
    d.text((340, 360), "ACCOUNTS 2026", fill=(20, 20, 20), font=font(64))
    d.ellipse([700, 1100, 1000, 1380], outline=(120, 85, 40), width=18)   # ring stain
    for i in range(0, 1101, 10):
        d.line([(100 + i, 1540), (100 + i, 1540 - (30 if i % 100 == 0 else 15))], fill=(255, 255, 255), width=2)
    return add_noise(im, 2.0, np.random.default_rng(5))


def scenario_notebook(results):
    out = FILES / "notebook"
    (out / "fsl_rescan").mkdir(parents=True, exist_ok=True)
    n_pages = 6
    save_jpeg_with_exif(draw_cover(), out / "cover.jpg", "2026:11:19 11:20:00")
    edge = Image.new("RGB", (1600, 400), (240, 238, 230))
    de = ImageDraw.Draw(edge)
    for i, y in enumerate(range(120, 280, 5)):
        de.line([(60, y), (1540, y)], fill=(200 - (i % 3) * 25,) * 3, width=2)
    save_jpeg_with_exif(add_noise(edge, 2.0, np.random.default_rng(6)), out / "edge.jpg", "2026:11:19 11:20:30")

    pages = [draw_page(p, 1000 + p) for p in range(1, n_pages + 1)]
    for p, im in enumerate(pages, 1):
        im.save(out / f"page_{p:03d}.png", optimize=True)
    rng = np.random.default_rng(77)
    for p, im in enumerate(pages, 1):                       # FSL re-scan of the same physical pages
        rescan(im, rng).save(out / "fsl_rescan" / f"page_{p:03d}.png", optimize=True)
    forged = draw_page(4, 9999)                              # page 4 substituted with a re-written page
    (out / "forged").mkdir(exist_ok=True)
    rescan(forged, np.random.default_rng(78)).save(out / "forged" / "page_004.png", optimize=True)

    arts = [
        {"artefact_id": "A001", "sequence": 1, "role": "cover_photo", "media_type": "image/jpeg",
         "file_name": "notebook/cover.jpg", "captured_at": "2026-11-19T11:20:00+05:30", "capture_device": PHONE,
         "hashed_on": "capture device"},
        {"artefact_id": "A002", "sequence": 2, "role": "edge_photo", "media_type": "image/jpeg",
         "file_name": "notebook/edge.jpg", "captured_at": "2026-11-19T11:20:30+05:30", "capture_device": PHONE,
         "hashed_on": "capture device"},
    ]
    for p in range(1, n_pages + 1):
        arts.append({"artefact_id": f"A{p + 2:03d}", "sequence": p + 2, "role": "page_scan", "media_type": "image/png",
                     "file_name": f"notebook/page_{p:03d}.png", "captured_at": f"2026-11-19T15:{10 + p:02d}:00+05:30",
                     "capture_device": SCANNER, "hashed_on": "police station designated desktop",
                     "capture_parameters": {"dpi": "300", "colour_mode": "GRAY-8", "format": "PNG (lossless)", "page": str(p)}})
    draft = {
        "spec_version": "1.0", "evidence_id": "GJ-GNR-CYBPS-2026-000123-E004", "parent_evidence_id": None,
        "evidence_class": "PHYSICAL_DOCUMENT", "title": "Spiral notebook 'ACCOUNTS 2026' recovered from desk drawer",
        "description": "Blue spiral notebook, A6, handwritten entries in blue/black ink on 6 sides; found in the top drawer of the desk in room 2.",
        "case": CASE,
        "collection": {"collected_at": "2026-11-19T11:18:00+05:30", "location": LOC, "collected_by": IO,
                       "witnesses": WITNESSES, "legal_basis": "BNSS s.105 search and seizure",
                       "seizure_memo_ref": "GJ-GNR-CYBPS-2026-000123-E020",
                       "av_recording_ref": "GJ-GNR-CYBPS-2026-000123-E010",
                       "condition_on_collection": "Intact; corner of page 3 torn; ring stain on cover"},
        "packaging": {"container": "tamper-evident evidence bag", "seal_ids": ["TEB-GJ-0007741"],
                      "label_id": "QR:GJ-GNR-CYBPS-2026-000123-E004", "sealed_by": IO,
                      "sealed_at": "2026-11-19T11:31:00+05:30"},
        "class_attributes": {"document_type": "spiral notebook", "page_count": n_pages, "leaf_count": 3,
                             "dimensions_mm": {"width": "105", "height": "148", "thickness": "4"},
                             "binding": "metal spiral, left edge", "writing_media": ["blue ballpoint", "black ballpoint"],
                             "distinguishing_features": ["'ACCOUNTS 2026' label on cover", "ring-shaped stain on cover",
                                                         "bottom-right corner of page 3 torn", "ring stain on page 3"],
                             "scan_dpi": 300, "scan_colour_mode": "GRAY-8", "scan_file_format": "PNG"},
        "artefacts": arts,
        "identity_fingerprints": [{"method": "phash-dct-64", "method_version": "1",
                                   "source_artefact_ids": [f"A{p + 2:03d}"], "value": "auto",
                                   "match_rule": "hamming<=10"} for p in range(1, n_pages + 1)]
                                 + [{"method": "seal-id-exact", "method_version": "1", "source_artefact_ids": ["A001"],
                                     "value": "TEB-GJ-0007741", "match_rule": "exact"}],
    }

    # per-page comparison: original scan vs FSL re-scan, and vs forged page 4
    rows = []
    for p in range(1, n_pages + 1):
        o, r = out / f"page_{p:03d}.png", out / "fsl_rescan" / f"page_{p:03d}.png"
        ho, hr = eh.hash_file(o), eh.hash_file(r)
        d = eh.hamming(eh.phash(o), eh.phash(r))
        rows.append({"page": p, "orig_sha256": ho["sha256"], "rescan_sha256": hr["sha256"], "phash_hamming": d,
                     "kind": "FSL re-scan of the same page"})
    fo = out / "forged" / "page_004.png"
    dforged = eh.hamming(eh.phash(out / "page_004.png"), eh.phash(fo))
    rows.append({"page": 4, "orig_sha256": eh.hash_file(out / "page_004.png")["sha256"],
                 "rescan_sha256": eh.hash_file(fo)["sha256"], "phash_hamming": dforged,
                 "kind": "Substituted (re-written) page 4"})
    results["notebook_rescan"] = rows

    lines = [r"\begin{tabular}{@{}c>{\raggedright}p{0.24\linewidth}llcc@{}}", r"\toprule",
             r"Page & Comparison & Original scan & New scan & $d_H$ & L2 verdict\\", r"\midrule"]
    for r in rows:
        verdict = "MATCH" if r["phash_hamming"] <= 10 else r"\textbf{NO MATCH}"
        lines.append(f"{r['page']} & {tex_escape(r['kind'])} & {hx(r['orig_sha256'], 12)} & {hx(r['rescan_sha256'], 12)} & "
                     f"{r['phash_hamming']} & {verdict}\\\\")
    lines += [r"\bottomrule", r"\end{tabular}"]
    write(GEN / "notebook_rescan_table.tex", "\n".join(lines) + "\n")

    with Image.open(out / "page_003.png") as im:
        im.convert("L").resize((310, 437), Image.Resampling.LANCZOS).save(FIG / "notebook_page3.png")
    with Image.open(out / "cover.jpg") as im:
        im.convert("RGB").resize((300, 400), Image.Resampling.LANCZOS).save(FIG / "notebook_cover.jpg", quality=85)
    return draft


# ================================================================================================
# C. Physical item: 3D scan reference vs re-scans (same item, damaged item, look-alike item)
# ================================================================================================

def knife_points(n: int, rng, blade_len=180.0, tip_cut=0.0, notch=False) -> np.ndarray:
    """Sample points on a simplified knife: tapered flat blade (thickness 2.4 mm) + elliptic handle."""
    pts = []
    n_blade, n_handle = int(n * 0.55), n - int(n * 0.55)
    L = blade_len - tip_cut
    # blade outline: width 32 mm at heel tapering to a point at x = blade_len, spine straight (y = 0..w(x))
    def width(x):
        return 32.0 * np.clip(1 - (x / blade_len) ** 2.2, 0, 1)
    while len(pts) < n_blade:
        x = rng.uniform(0, L, 4096)
        y = rng.uniform(0, 32.0, 4096)
        keep = y < width(x)
        if notch:
            keep &= ~((x > 95) & (x < 103) & (y < 5.0))       # 8 mm x 5 mm nick in the edge
        for xi, yi in zip(x[keep], y[keep]):
            face = rng.integers(0, 2)
            pts.append((xi, yi, 1.2 if face else -1.2))
            if len(pts) >= n_blade:
                break
    t = rng.uniform(0, 2 * np.pi, n_handle)                     # handle: x in [-115, 0]
    hx_ = rng.uniform(-115, 0, n_handle)
    pts += list(zip(hx_, 16 + 11 * np.cos(t), 8.0 * np.sin(t)))
    p = np.asarray(pts[:n])
    return p


def write_ply(path: Path, p: np.ndarray):
    with open(path, "w", encoding="ascii") as f:
        f.write(f"ply\nformat ascii 1.0\ncomment synthetic structured-light scan\nelement vertex {len(p)}\n"
                "property float x\nproperty float y\nproperty float z\nend_header\n")
        for x, y, z in p:
            f.write(f"{x:.3f} {y:.3f} {z:.3f}\n")


def random_pose(p: np.ndarray, rng) -> np.ndarray:
    q = rng.normal(size=4)
    q /= np.linalg.norm(q)
    a, b, c, d = q
    r = np.array([[a*a+b*b-c*c-d*d, 2*(b*c-a*d), 2*(b*d+a*c)],
                  [2*(b*c+a*d), a*a-b*b+c*c-d*d, 2*(c*d-a*b)],
                  [2*(b*d-a*c), 2*(c*d+a*b), a*a-b*b-c*c+d*d]])
    return p @ r.T + rng.uniform(-200, 200, 3)


def scenario_knife(results):
    out = FILES / "knife"
    out.mkdir(parents=True, exist_ok=True)
    ref = knife_points(16000, np.random.default_rng(100))
    write_ply(out / "reference_scan.ply", ref)
    noise = 0.15
    cases = [
        ("rescan_same.ply", "Same knife, re-scanned at FSL (new pose, new sampling, 0.15 mm noise)", {}),
        ("rescan_notched.ply", "Same knife after an 8 x 5 mm nick appeared in the edge", {"notch": True}),
        ("rescan_tip_broken.ply", "Same knife with 6 mm of the tip broken off", {"tip_cut": 6.0}),
        ("lookalike_longer.ply", "Look-alike knife, blade 6 mm longer", {"blade_len": 186.0}),
    ]
    rows = []
    for i, (fn, desc, kw) in enumerate(cases):
        rng = np.random.default_rng(200 + i)
        q = knife_points(16000, rng, **kw)
        q = random_pose(q + rng.normal(0, noise, q.shape), rng)
        write_ply(out / fn, q)
        m = eh.compare_mesh(out / "reference_scan.ply", out / fn)
        rows.append({"file": fn, "description": desc, **m})
    rule = {"rms_mm": 0.60, "max_mm": 3.00}
    for r in rows:
        r["match"] = r["rms_mm"] <= rule["rms_mm"] and r["max_mm"] <= rule["max_mm"]
    results["knife"] = {"rule": rule, "rows": rows, "ref_points": len(ref)}

    lines = [r"\begin{tabular}{@{}p{0.46\linewidth}cccc@{}}", r"\toprule",
             r"Query scan compared with the reference scan & RMS (mm) & P95 (mm) & Max (mm) & L2 verdict\\", r"\midrule"]
    for r in rows:
        lines.append(f"{tex_escape(r['description'])} & {r['rms_mm']:.3f} & {r['p95_mm']:.3f} & {r['max_mm']:.3f} & "
                     f"{'MATCH' if r['match'] else r'\textbf{NO MATCH}'}\\\\")
    lines += [r"\bottomrule", r"\end{tabular}"]
    write(GEN / "knife_table.tex", "\n".join(lines) + "\n")

    # top-view rendering of the reference scan for the report
    img = Image.new("RGB", (900, 260), (250, 250, 248))
    d = ImageDraw.Draw(img)
    for x, y, z in ref[::2]:
        px, py = int(60 + (x + 115) * 2.6), int(230 - (y + 0) * 5.0)
        shade = 40 if z > 0 else 95
        d.rectangle([px, py, px + 1, py + 1], fill=(shade, shade, shade + 25))
    img.save(FIG / "knife_scan_top.png")

    draft = {
        "spec_version": "1.0", "evidence_id": "GJ-GNR-CYBPS-2026-000123-E002", "parent_evidence_id": None,
        "evidence_class": "PHYSICAL_ITEM", "title": "Kitchen knife recovered beside stain (marker 1)",
        "description": "Single-edged kitchen knife, steel blade approx. 180 mm, black handle.",
        "case": CASE,
        "collection": {"collected_at": "2026-11-19T10:58:00+05:30", "location": LOC, "collected_by": IO,
                       "witnesses": WITNESSES, "legal_basis": "BNSS s.105 search and seizure",
                       "seizure_memo_ref": "GJ-GNR-CYBPS-2026-000123-E020",
                       "av_recording_ref": "GJ-GNR-CYBPS-2026-000123-E010",
                       "condition_on_collection": "Reddish-brown stains on blade; no visible damage"},
        "packaging": {"container": "rigid weapon tube inside tamper-evident bag", "seal_ids": ["TEB-GJ-0007738"],
                      "label_id": "QR:GJ-GNR-CYBPS-2026-000123-E002", "sealed_by": IO,
                      "sealed_at": "2026-11-19T11:05:00+05:30"},
        "class_attributes": {"item_category": "edged weapon", "dimensions_mm": {"length": "295", "width": "32", "height": "22"},
                             "mass": {"value": "148.5", "unit": "g"}, "material": "steel blade, polymer handle",
                             "colour": "silver / black", "serial_or_make_marks": "none visible",
                             "unique_marks": ["scratch 12 mm long on left face near heel", "chip in handle end cap"],
                             "scan_3d": {"method": "structured-light", "point_spacing_mm": "0.5", "stated_accuracy_mm": "0.1"},
                             "expected_changes": ["swabbing of stains at FSL", "possible removal of trace material"]},
        "artefacts": [
            {"artefact_id": "A001", "sequence": 1, "role": "scan_3d", "media_type": "model/ply",
             "file_name": "knife/reference_scan.ply", "captured_at": "2026-11-19T13:40:00+05:30",
             "capture_device": SCANNER3D, "hashed_on": "police station designated desktop",
             "capture_parameters": {"points": str(len(ref)), "units": "mm", "format": "PLY ASCII"}},
            {"artefact_id": "A002", "sequence": 2, "role": "closeup_photo", "media_type": "image/jpeg",
             "file_name": "photo/IMG_0001.jpg", "captured_at": "2026-11-19T10:42:05+05:30", "capture_device": PHONE,
             "hashed_on": "capture device"},
        ],
        "identity_fingerprints": [{"method": "mesh-icp-rms", "method_version": "1", "source_artefact_ids": ["A001"],
                                   "value": "auto", "match_rule": "rms_mm<=0.60 and max_mm<=3.00"},
                                  {"method": "seal-id-exact", "method_version": "1", "source_artefact_ids": ["A002"],
                                   "value": "TEB-GJ-0007738", "match_rule": "exact"}],
    }
    return draft


# ================================================================================================
# D. Disk image: acquisition-stream hash, verification, chunk-level localisation of a flipped byte
# ================================================================================================

def scenario_disk(results):
    out = FILES / "disk"
    out.mkdir(parents=True, exist_ok=True)
    rng = np.random.default_rng(300)
    src = out / "source_media.bin"
    src.write_bytes(rng.integers(0, 256, 8 * 1024 * 1024, dtype=np.uint8).tobytes())
    # "acquisition": read source once, hash the stream while writing the image
    import hashlib
    h = hashlib.sha256()
    with open(src, "rb") as fi, open(out / "image.dd", "wb") as fo:
        while block := fi.read(1 << 20):
            h.update(block)
            fo.write(block)
    stream = h.hexdigest()
    verify = eh.hash_file(out / "image.dd")["sha256"]
    # later: a single bit flipped in a working copy at offset 5,000,000
    data = bytearray((out / "image.dd").read_bytes())
    data[5_000_000] ^= 0x01
    (out / "working_copy_corrupted.dd").write_bytes(bytes(data))
    bad = eh.hash_file(out / "working_copy_corrupted.dd")["sha256"]
    cs = 1 << 20
    def chunk_hashes(p):
        with open(p, "rb") as f:
            return [hashlib.sha256(b).hexdigest() for b in iter(lambda: f.read(cs), b"")]
    ca, cb = chunk_hashes(out / "image.dd"), chunk_hashes(out / "working_copy_corrupted.dd")
    diff = [i for i, (x, y) in enumerate(zip(ca, cb)) if x != y]
    results["disk"] = {"size_bytes": len(data), "source_stream_sha256": stream, "verification_sha256": verify,
                       "corrupted_sha256": bad, "chunk_size": cs, "differing_chunks": diff,
                       "chunk_root_good": eh.chunk_merkle_root(out / "image.dd", cs),
                       "chunk_root_bad": eh.chunk_merkle_root(out / "working_copy_corrupted.dd", cs)}
    lines = [r"\begin{tabular}{@{}ll@{}}", r"\toprule", r"Quantity & Value\\", r"\midrule",
             f"Source media size & {len(data):,} bytes (8 MiB)\\\\".replace(",", "{,}"),
             f"SHA-256 of bit stream read during acquisition & {hx(stream, 32)}\\\\",
             f"SHA-256 recomputed from finished image & {hx(verify, 32)}\\\\",
             f"Acquisition verified (stream = image) & {'yes' if stream == verify else 'NO'}\\\\",
             f"SHA-256 of working copy with 1 bit flipped at byte 5{{,}}000{{,}}000 & {hx(bad, 32)}\\\\",
             f"Chunk Merkle root (1 MiB chunks), good image & {hx(results['disk']['chunk_root_good'], 32)}\\\\",
             f"Chunk Merkle root, corrupted copy & {hx(results['disk']['chunk_root_bad'], 32)}\\\\",
             f"Chunks that differ (0-based) & {', '.join(map(str, diff))} (bytes {diff[0] * cs:,}--{(diff[0] + 1) * cs - 1:,})\\\\".replace(",", "{,}"),
             r"\bottomrule", r"\end{tabular}"]
    write(GEN / "disk_table.tex", "\n".join(lines) + "\n")


# ================================================================================================
# Build manifests, ledger records, proofs, events; write macros
# ================================================================================================

def main():
    if FILES.exists():
        shutil.rmtree(FILES)
    FILES.mkdir(parents=True)
    EXAMPLES.mkdir(parents=True, exist_ok=True)
    GEN.mkdir(parents=True, exist_ok=True)
    FIG.mkdir(parents=True, exist_ok=True)
    results = {}

    drafts = {"scene-photo": scenario_photo(results), "notebook": scenario_notebook(results),
              "knife": scenario_knife(results)}
    scenario_disk(results)

    manifests, records = {}, {}
    for name, draft in drafts.items():
        m = eh.build_manifest(draft, FILES, demo_seed=SEED)
        errs = eh.validate(m)
        if errs:
            raise SystemExit(f"{name}: schema validation failed:\n" + "\n".join(errs))
        probs = eh.verify_manifest(m, FILES)
        if probs:
            raise SystemExit(f"{name}: verification failed:\n" + "\n".join(probs))
        manifests[name], records[name] = m, eh.ledger_record(m)
        write(EXAMPLES / f"{name}.manifest.json", json.dumps(m, indent=2, ensure_ascii=False) + "\n")
        write(EXAMPLES / f"{name}.ledger-record.json", json.dumps(records[name], indent=2) + "\n")

    # Tamper test on the notebook: substitute page 4 in the evidence store, re-verify
    nb = manifests["notebook"]
    tampered_dir = FILES.parent / "files_tampered"
    if tampered_dir.exists():
        shutil.rmtree(tampered_dir)
    shutil.copytree(FILES, tampered_dir)
    shutil.copyfile(FILES / "notebook" / "forged" / "page_004.png", tampered_dir / "notebook" / "page_004.png")
    tamper_problems = eh.verify_manifest(nb, tampered_dir, ledger=records["notebook"])
    # Attack 2: the attacker also rewrites the off-chain manifest so it agrees with the substituted file
    nb2 = json.loads(json.dumps(nb))
    a6 = next(a for a in nb2["artefacts"] if a["artefact_id"] == "A006")
    a6.update(eh.hash_file(tampered_dir / "notebook" / "page_004.png"))
    nb2["integrity"]["merkle_root"] = eh.manifest_merkle_root(nb2)
    tamper2_problems = eh.verify_manifest(nb2, tampered_dir, ledger=records["notebook"])
    shutil.rmtree(tampered_dir)
    results["notebook_tamper"] = tamper_problems
    results["notebook_tamper_manifest_rewritten"] = tamper2_problems

    # Inclusion proof for page 4 (artefact A006)
    arts = eh.ordered_artefacts(nb)
    idx = next(i for i, a in enumerate(arts) if a["artefact_id"] == "A006")
    leaves = [eh.artefact_leaf(a) for a in arts]
    path = eh.inclusion_path(idx, leaves)
    ok = eh.verify_inclusion(leaves[idx], idx, len(leaves), path, bytes.fromhex(nb["integrity"]["merkle_root"]))
    results["proof"] = {"artefact_id": "A006", "index": idx, "size": len(leaves), "path": [p.hex() for p in path], "verifies": ok}

    # Example custody events (validated)
    ev = [
        {"spec_version": "1.0", "evidence_id": nb["evidence_id"], "event_type": "REGISTER",
         "reason": "Seized under BNSS s.105 during search of premises (FIR 123/2026)", "location": LOC["address"],
         "manifest_sha256": records["notebook"]["manifest_sha256"], "merkle_root": records["notebook"]["merkle_root"]},
        {"spec_version": "1.0", "evidence_id": nb["evidence_id"], "event_type": "TRANSFER_INITIATE",
         "reason": "Forwarded to FSL Gandhinagar for questioned-document examination, letter no. CPS/FSL/412/2026",
         "to_org_msp": "FSLMSP", "to_custodian_subject": "CN=k.mehta,OU=client,O=fsl.custodychain.local"},
        {"spec_version": "1.0", "evidence_id": nb["evidence_id"], "event_type": "TRANSFER_ACCEPT",
         "reason": "Received at FSL evidence counter", "transfer_ref": "<tx id of TRANSFER_INITIATE>",
         "seal_ids_observed": ["TEB-GJ-0007741"], "seal_intact": True},
        {"spec_version": "1.0", "evidence_id": nb["evidence_id"], "event_type": "VERIFY_IDENTITY",
         "reason": "Identity check on receipt: re-scan of all 6 sides compared with reference scans",
         "verification": {"method": "phash-dct-64", "method_version": "1", "result": "MATCH",
                          "score": str(max(r["phash_hamming"] for r in results["notebook_rescan"][:6])),
                          "threshold": "10",
                          "query_artefact_sha256": [r["rescan_sha256"] for r in results["notebook_rescan"][:6]]}},
    ]
    for e in ev:
        errs = eh.validate(e, "custody-event.schema.json")
        if errs:
            raise SystemExit("event validation failed: " + "; ".join(errs))
    write(EXAMPLES / "notebook.events.json", json.dumps(ev, indent=2) + "\n")

    # ---- LaTeX outputs ----
    def rec_table(name, label):
        r = records[name]
        return "\n".join([r"\begin{tabular}{@{}lp{0.62\linewidth}@{}}", r"\toprule", r"Ledger field & Value\\", r"\midrule",
                          f"\\texttt{{evidence\\_id}} & \\texttt{{{tex_escape(r['evidence_id'])}}}\\\\",
                          f"\\texttt{{evidence\\_class}} & \\texttt{{{tex_escape(r['evidence_class'])}}}\\\\",
                          f"\\texttt{{artefact\\_count}} & {r['artefact_count']}\\\\",
                          f"\\texttt{{manifest\\_sha256}} & {hx(r['manifest_sha256'])}\\\\",
                          f"\\texttt{{merkle\\_root}} & {hx(r['merkle_root'])}\\\\",
                          r"\bottomrule", r"\end{tabular}"]) + "\n"
    for name in records:
        write(GEN / f"{name}_ledger_table.tex", rec_table(name, name))

    rows = [r"\begin{tabular}{@{}clll@{}}", r"\toprule", r"Artefact & Role & Size (bytes) & SHA-256\\", r"\midrule"]
    for a in arts:
        rows.append(f"\\texttt{{{a['artefact_id']}}} & {tex_escape(a['role'])} & {a['size_bytes']} & {hx(a['sha256'], 24)}\\\\")
    rows += [r"\bottomrule", r"\end{tabular}"]
    write(GEN / "notebook_artefacts_table.tex", "\n".join(rows) + "\n")

    def short(p):
        p = p.replace("notebook/", "")
        out = []
        for tok in p.split(" "):
            if len(tok) == 64 and all(c in "0123456789abcdef" for c in tok):
                out.append(r"\texttt{" + tok[:12] + r"\ldots}")
            else:
                out.append(tex_escape(tok))
        return " ".join(out)
    write(GEN / "notebook_tamper.tex", r"\begin{itemize}[nosep]" + "\n" + "\n".join(r"\item " + short(p) for p in tamper_problems) + "\n" + r"\end{itemize}" + "\n")
    write(GEN / "notebook_tamper2.tex", r"\begin{itemize}[nosep]" + "\n" + "\n".join(r"\item " + short(p) for p in tamper2_problems) + "\n" + r"\end{itemize}" + "\n")

    pr = results["proof"]
    plines = [r"\begin{tabular}{@{}ll@{}}", r"\toprule",
              f"Leaf (artefact) & \\texttt{{A006}} (page 4), index {pr['index']} of {pr['size']}\\\\",
              f"Leaf salt & {hx(arts[idx]['leaf_salt'], 32)}\\\\",
              f"Artefact SHA-256 & {hx(arts[idx]['sha256'], 32)}\\\\"]
    for i, p in enumerate(pr["path"]):
        plines.append(f"Audit path [{i}] & {hx(p, 32)}\\\\")
    plines += [f"Merkle root & {hx(nb['integrity']['merkle_root'], 32)}\\\\",
               f"Proof verifies & {'yes' if pr['verifies'] else 'NO'}\\\\", r"\bottomrule", r"\end{tabular}"]
    write(GEN / "proof_table.tex", "\n".join(plines) + "\n")

    k = results["knife"]
    ph = results["photo"]["rows"]
    nbr = results["notebook_rescan"]
    macros = {
        "NbManifestHash": records["notebook"]["manifest_sha256"],
        "NbMerkleRoot": records["notebook"]["merkle_root"],
        "PhotoManifestHash": records["scene-photo"]["manifest_sha256"],
        "PhotoSha": ph[0]["sha256"],
        "PhotoPhash": ph[0]["phash"],
        "KnifeRefPoints": str(k["ref_points"]),
        "KnifeRuleRms": f"{k['rule']['rms_mm']:.2f}",
        "KnifeRuleMax": f"{k['rule']['max_mm']:.2f}",
        "NbRescanMaxDist": str(max(r["phash_hamming"] for r in nbr[:6])),
        "NbForgedDist": str(nbr[6]["phash_hamming"]),
        "PhotoSecondDist": str(ph[4]["phash_hamming"]),
        "PhotoTamperDist": str(ph[5]["phash_hamming"]),
        "PhotoOtherDist": str(ph[6]["phash_hamming"]),
        "PhotoResaveDist": str(ph[2]["phash_hamming"]),
    }
    write(GEN / "macros.tex", "".join(f"\\newcommand{{\\{k_}}}{{{v}}}\n" for k_, v in macros.items()))

    results["records"] = records
    write(ROOT / "worked-example" / "results.json", json.dumps(results, indent=2) + "\n")
    print(json.dumps({"photo": [(r["file"], r["sha256_equal"], r["phash_hamming"]) for r in ph],
                      "notebook_rescan": [(r["page"], r["phash_hamming"]) for r in nbr],
                      "notebook_tamper": tamper_problems, "tamper2": tamper2_problems,
                      "knife": [(r["file"], r["rms_mm"], r["max_mm"], r["match"]) for r in k["rows"]],
                      "disk_diff_chunks": results["disk"]["differing_chunks"],
                      "proof_ok": pr["verifies"], "records": records}, indent=1))


if __name__ == "__main__":
    main()
