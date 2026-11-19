#!/usr/bin/env python3
"""eval_to_tex.py: render the evaluation results (outputs/evaluation/*.json) and the decision-log index
(outputs/DECISIONS.md) as LaTeX tables for the report (M9). Missing inputs produce a placeholder line."""
import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
EV = ROOT / "evaluation"
GEN = ROOT / "report" / "generated"
GEN.mkdir(parents=True, exist_ok=True)


def esc(s):
    rep = {"&": r"\&", "%": r"\%", "$": r"\$", "#": r"\#", "_": r"\_", "{": r"\{", "}": r"\}", "~": r"\textasciitilde{}",
           "^": r"\textasciicircum{}", "\\": r"\textbackslash{}", "<": r"\textless{}", ">": r"\textgreater{}", "…": r"\ldots{}", "→": r"$\rightarrow$"}
    return "".join(rep.get(c, c) for c in str(s))


def write(name, text):
    (GEN / name).write_text(text)


# ---------------------------------------------------------------- tamper suite
t = EV / "tamper-suite.json"
if t.exists():
    d = json.loads(t.read_text())
    lines = [r"\begin{longtable}{@{}p{0.30\linewidth}p{0.24\linewidth}p{0.32\linewidth}l@{}}",
             r"\caption{Tamper suite: attack, expected behaviour, observed behaviour (gateway-v2/scripts/tamper-suite.js).}\label{tab:tamper}\\", r"\toprule",
             r"Attack & Expected & Observed & \\ \midrule\endhead"]
    for r in d["rows"]:
        lines.append(f"{esc(r['attack'])} & {esc(r['expected'])} & \\footnotesize {esc(r['observed'][:120])} & {'\\textbf{detected}' if r['detected'] else '\\textbf{MISSED}'}\\\\")
    lines += [r"\bottomrule", r"\end{longtable}"]
    write("tamper_table.tex", "\n".join(lines) + "\n")
else:
    write("tamper_table.tex", "Tamper-suite results not available (run \\code{gateway-v2/scripts/tamper-suite.js}).\n")

# ---------------------------------------------------------------- benchmarks
runs = {k: json.loads((EV / f"bench-{k}.json").read_text()) for k in ("bft4", "raft4") if (EV / f"bench-{k}.json").exists()}
if runs:
    ops = list(next(iter(runs.values()))["ops"].keys())
    out = []
    for op in ops:
        out += [r"\begin{table}[htbp]\centering\small", r"\begin{tabular}{@{}r" + "rrrr" * len(runs) + "@{}}", r"\toprule",
                " & " + " & ".join(f"\\multicolumn{{4}}{{c}}{{{'BFT, 4 orderers' if k == 'bft4' else 'Raft, 4 orderers (control)'}}}" for k in runs) + r"\\",
                " ".join(f"\\cmidrule(lr){{{2 + 4 * i}-{5 + 4 * i}}}" for i in range(len(runs))),
                "Conc. & " + " & ".join(["p50 ms & p95 ms & max ms & tx/s"] * len(runs)) + r"\\", r"\midrule"]
        levels = [r["concurrency"] for r in next(iter(runs.values()))["ops"][op]]
        for i, c in enumerate(levels):
            cells = []
            for k in runs:
                r = runs[k]["ops"][op][i]
                cells.append(f"{r['p50_ms']} & {r['p95_ms']} & {r['max_ms']} & {r['throughput_tps']}")
            out.append(f"{c} & " + " & ".join(cells) + r"\\")
        fails = {k: sum(r["failures"] for r in runs[k]["ops"][op]) for k in runs}
        out += [r"\bottomrule", r"\end{tabular}",
                f"\\caption{{{esc(op)}: latency and committed throughput by concurrency (failed transactions: " + ", ".join(f"{k} {v}" for k, v in fails.items()) + ").}",
                f"\\label{{tab:bench-{re.sub(r'[^a-z]', '', op.lower())}}}", r"\end{table}", ""]
    write("bench_tables.tex", "\n".join(out))
    host = next(iter(runs.values()))["host"]
    write("bench_host.tex", f"{host['cpus']} logical CPUs, {host['mem_gb']} GB RAM\n")
else:
    write("bench_tables.tex", "Benchmark results not available (run \\code{gateway-v2/scripts/bench.js}).\n")
    write("bench_host.tex", "the test laptop\n")

# ---------------------------------------------------------------- decision index
dec = (ROOT / "DECISIONS.md").read_text()
rows = re.findall(r"^\| (D-\d{3}) \| ([^|]+) \| ([^|]+) \| ([^|]+) \| ([^|]+) \| ([^|]+) \|$", dec, re.M)
lines = [r"\begin{longtable}{@{}lp{0.12\linewidth}p{0.47\linewidth}p{0.13\linewidth}p{0.13\linewidth}@{}}", r"\toprule",
         r"ID & Date & Decision & Status & Decided by\\ \midrule\endhead"]
for i, date, title, status, by, review in rows:
    clean = lambda s: esc(re.sub(r"\*\*|`", "", s.strip()))
    lines.append(f"{i} & {clean(date)} & {clean(title)} & {clean(status)} & {clean(by)}{' (review pending)' if 'pending' in review else ''}\\\\")
lines += [r"\bottomrule", r"\end{longtable}"]
write("decisions_table.tex", "\n".join(lines) + "\n")
print(f"tamper: {t.exists()}, bench runs: {list(runs)}, decisions: {len(rows)}")
