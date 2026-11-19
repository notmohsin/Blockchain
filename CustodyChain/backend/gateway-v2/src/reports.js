'use strict';
// Court outputs (M7, D-049): print-ready HTML custody report and BSA s.63(4)(c) certificate drafts.
const fp = require('./lib/fingerprint');

const esc = (v) => String(v === undefined || v === null ? '' : v).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const ORG = { PoliceMSP: 'Police', FSLMSP: 'Forensic Science Laboratory', CourtMSP: 'Court' };
const LABEL = { REGISTER: 'Registered', DERIVE: 'Derived item created', TRANSFER_INITIATE: 'Transfer initiated', TRANSFER_ACCEPT: 'Transfer accepted',
    TRANSFER_REJECT: 'Transfer rejected', TRANSFER_CANCEL: 'Transfer cancelled', ACCESS: 'Accessed', SEAL: 'Sealed', RESEAL: 'Resealed',
    EXAMINE_START: 'Examination started', EXAMINE_END: 'Examination completed', VERIFY_INTEGRITY: 'Integrity verified',
    VERIFY_IDENTITY: 'Identity verified', SUBMIT_COURT: 'Submitted in court', RETURN: 'Returned', ARCHIVE: 'Archived', DISPOSE: 'Disposed', CORRECTION: 'Correction' };
const SCHEDULE_DEVICES = ['Computer/Storage Media', 'DVR', 'Mobile', 'Flash Drive', 'CD/DVD', 'Server', 'Cloud', 'Other'];

function ist(iso) {
    if (!iso) return '';
    return new Date(iso).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }) + ' IST';
}

function eventSummary(ev) {
    const d = ev.details || {};
    switch (ev.type) {
    case 'REGISTER': return d.derived_from ? `Derived from ${d.derived_from}` : `manifest ${String(d.manifest_sha256 || '').slice(0, 16)}…`;
    case 'TRANSFER_INITIATE': return `to ${d.to_user} (${ORG[d.to_msp] || d.to_msp})`;
    case 'TRANSFER_ACCEPT': case 'TRANSFER_REJECT':
        return `from ${d.from && d.from.cn}; seal read: ${(d.seal_ids_observed || []).join(', ') || 'none'}, ${d.seal_intact ? 'intact' : 'NOT INTACT'}${d.seals_match === false ? ' (DIFFERS from recorded seal)' : ''}`;
    case 'SEAL': case 'RESEAL': return `seal ${(d.seal_ids || []).join(', ')}`;
    case 'VERIFY_INTEGRITY': case 'VERIFY_IDENTITY': {
        const v = d.verification || {};
        return `${v.method}: ${v.result}${d.matched_artefact_id ? ` (${d.matched_artefact_id})` : ''}${v.score !== undefined ? `, score ${v.score}/${v.threshold}` : ''}${(d.notes || []).length ? `; ${d.notes.join('; ')}` : ''}`;
    }
    case 'ACCESS': return d.purpose ? `${d.purpose}${d.artefact_id ? ` ${d.artefact_id}` : ''}` : '';
    case 'EXAMINE_END': return (d.attachments_sha256 || []).map((h) => `report sha256 ${h.slice(0, 16)}…`).join(', ');
    case 'SUBMIT_COURT': return [d.court, d.exhibit].filter(Boolean).join(', ');
    case 'DERIVE': return `child ${d.child_evidence_id}`;
    default: return d.court_order_ref ? `court order ${d.court_order_ref}` : '';
    }
}

const CSS = `
  @page { size: A4; margin: 16mm 14mm; }
  body { font-family: 'IBM Plex Sans', 'Segoe UI', Arial, sans-serif; color: #141a2b; font-size: 10.5pt; line-height: 1.35; margin: 0; }
  .wrap { max-width: 190mm; margin: 0 auto; padding: 8mm 0; }
  h1 { font-size: 17pt; margin: 0 0 2mm; } h2 { font-size: 11.5pt; text-transform: uppercase; letter-spacing: .05em; color: #2c3753; border-bottom: 1.5px solid #2c3753; padding-bottom: 1mm; margin: 6mm 0 2.5mm; }
  .mono { font-family: 'IBM Plex Mono', Consolas, monospace; font-size: 8.5pt; word-break: break-all; }
  table { border-collapse: collapse; width: 100%; } th, td { text-align: left; vertical-align: top; padding: 1.4mm 1.6mm; border-bottom: 0.5px solid #c9d1e1; font-size: 9pt; }
  th { background: #eef1f6; font-size: 8.5pt; text-transform: uppercase; letter-spacing: .03em; }
  .kv td:first-child { width: 48mm; color: #3f4c69; }
  .ok { color: #256641; font-weight: 600; } .bad { color: #922e26; font-weight: 600; }
  .banner { border: 1px solid #c47f1f; background: #fdf6ec; padding: 2.5mm 3.5mm; margin: 3mm 0; font-size: 9pt; }
  .muted { color: #7d8aa6; font-size: 8.5pt; } .box { display: inline-block; width: 3.4mm; height: 3.4mm; border: 1px solid #141a2b; margin-right: 1.4mm; vertical-align: -0.6mm; text-align: center; line-height: 3.2mm; font-size: 8pt; }
  .sig { margin-top: 12mm; display: flex; justify-content: space-between; } .line { border-top: 1px solid #141a2b; min-width: 60mm; padding-top: 1mm; font-size: 9pt; }
  tr { page-break-inside: avoid; }`;

function page(title, body) {
    return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${esc(title)}</title><style>${CSS}</style></head><body><div class="wrap">${body}</div></body></html>`;
}

function custodyReport({ record, history, manifest, generatedBy, generatedAt }) {
    const ok = manifest && fp.manifestHash(manifest) === record.manifest_sha256 && fp.manifestMerkleRoot(manifest) === record.merkle_root;
    const arts = manifest ? manifest.artefacts : [];
    const idChecks = history.filter((e) => e.type === 'VERIFY_IDENTITY');
    const seals = history.filter((e) => ['SEAL', 'RESEAL', 'TRANSFER_ACCEPT', 'TRANSFER_REJECT'].includes(e.type));
    const c = manifest ? manifest.collection : null;
    const body = `
  <p class="muted">CustodyChain · Chain-of-custody report · generated ${esc(ist(generatedAt))} by ${esc(generatedBy.name)} (${esc(generatedBy.role_label)}, ${esc(generatedBy.org_name)})</p>
  <h1>${esc(record.title)}</h1>
  <p class="mono" style="font-size:10pt">${esc(record.evidence_id)}</p>
  <div class="banner">This report is generated from the BFT ledger operated by Police, FSL, Court and Prosecution, and from the encrypted evidence store.
   Off-chain manifest re-verified against the ledger at generation: <span class="${ok ? 'ok' : 'bad'}">${ok ? 'MATCHES (manifest SHA-256 and Merkle root)' : 'DOES NOT MATCH: do not rely on this report'}</span>.</div>

  <h2>Case and item</h2>
  <table class="kv">
    <tr><td>FIR / police station</td><td>${esc(record.case.fir_number)}, ${esc(record.case.police_station)}${manifest ? `, ${esc(manifest.case.district)}, ${esc(manifest.case.state)}` : ''}</td></tr>
    ${manifest && manifest.case.sections_invoked && manifest.case.sections_invoked.length ? `<tr><td>Sections</td><td>${esc(manifest.case.sections_invoked.join(', '))}</td></tr>` : ''}
    <tr><td>Evidence class</td><td>${esc(record.evidence_class)}${record.parent_evidence_id ? `, derived from ${esc(record.parent_evidence_id)}` : ''}</td></tr>
    <tr><td>Status / custodian</td><td>${esc(record.status)}, ${esc(record.custodian.cn)} (${esc(ORG[record.custodian.msp] || record.custodian.msp)}, ${esc(record.custodian.role)}) since ${esc(ist(record.custodian.since))}</td></tr>
    ${c ? `<tr><td>Collected</td><td>${esc(ist(c.collected_at))} at ${esc(c.location.description)}${c.location.address ? `, ${esc(c.location.address)}` : ''}<br>by ${esc(c.collected_by.name)}, ${esc(c.collected_by.designation || c.collected_by.role)}<br>Legal basis: ${esc(c.legal_basis)}${(c.witnesses || []).length ? `<br>Witnesses: ${c.witnesses.map((w) => `${esc(w.name)}${w.address ? ` (${esc(w.address)})` : ''}`).join('; ')}` : ''}</td></tr>` : ''}
    <tr><td>Recorded seal(s)</td><td>${esc((record.seal_ids || []).join(', ') || 'none')}</td></tr>
  </table>

  <h2>On-chain fingerprints</h2>
  <table class="kv">
    <tr><td>Manifest SHA-256</td><td class="mono">${esc(record.manifest_sha256)}</td></tr>
    <tr><td>Merkle root (${esc(record.artefact_count)} artefacts)</td><td class="mono">${esc(record.merkle_root)}</td></tr>
    <tr><td>Scheme</td><td>RFC 8785 canonical JSON; salted RFC 6962 Merkle tree; SHA-256 and SHA3-256 per file</td></tr>
  </table>

  <h2>Files fingerprinted at collection (hash report)</h2>
  <table><tr><th>ID</th><th>Role / file</th><th>Captured</th><th>SHA-256 / SHA3-256</th></tr>
  ${arts.map((a) => `<tr><td>${esc(a.artefact_id)}</td><td>${esc(a.role)}<br>${esc(a.file_name)}<br><span class="muted">${esc(a.size_bytes)} bytes, ${esc(a.media_type)}</span></td><td>${esc(ist(a.captured_at))}<br><span class="muted">${esc(a.capture_device.device_type)}: ${esc(a.capture_device.make_model)}</span></td><td class="mono">${esc(a.sha256)}<br>${esc(a.sha3_256)}</td></tr>`).join('')}
  </table>

  <h2>Chain of custody (${history.length} ledger events)</h2>
  <table><tr><th>#</th><th>Time</th><th>Event</th><th>By</th><th>Reason / details</th></tr>
  ${history.map((e, i) => `<tr><td>${i + 1}</td><td>${esc(ist(e.timestamp))}</td><td>${esc(LABEL[e.type] || e.type)}</td><td>${esc(e.actor.cn)}<br><span class="muted">${esc(ORG[e.actor.msp] || e.actor.msp)}, ${esc(e.actor.role)}</span></td><td>${esc(e.reason)}${eventSummary(e) ? `<br><span class="muted">${esc(eventSummary(e))}</span>` : ''}<br><span class="mono muted">tx ${esc(e.tx_id)}</span></td></tr>`).join('')}
  </table>

  <h2>Seal and identity checks</h2>
  <table><tr><th>Time</th><th>Check</th><th>Result</th></tr>
  ${seals.concat(idChecks).sort((a, b) => (a.timestamp < b.timestamp ? -1 : 1)).map((e) => `<tr><td>${esc(ist(e.timestamp))}</td><td>${esc(LABEL[e.type])} by ${esc(e.actor.cn)}</td><td>${esc(eventSummary(e))}</td></tr>`).join('') || '<tr><td colspan="3">none recorded</td></tr>'}
  </table>

  <h2>How to verify this report independently</h2>
  <ol>
    <li>Obtain the files and the manifest from the custodian (or the verification bundle for <span class="mono">${esc(record.evidence_id)}</span>).</li>
    <li>Read the evidence record directly from any agency's ledger peer and compare its <i>manifest_sha256</i> and <i>merkle_root</i> with the values above.</li>
    <li>Run <span class="mono">evidence_hash.py verify manifest.json --base &lt;files&gt; --ledger ledger-record.json</span>, or compute SHA-256 of each file with any standard tool (e.g. <span class="mono">sha256sum</span>) and compare with the hash report.</li>
  </ol>
  <p class="muted">Times are ledger transaction times (IST). Actors are taken from each signer's X.509 certificate (organisation, name, role), not from typed input. Prototype output; not a substitute for the statutory certificate.</p>`;
    return page(`Custody report ${record.evidence_id}`, body);
}

function bsa63({ record, manifest, part, certifier }) {
    const isB = part === 'B';
    const devices = [];
    for (const a of manifest.artefacts) {
        const d = a.capture_device;
        const key = `${d.device_type}|${d.make_model}|${d.serial_number || ''}`;
        if (!devices.find((x) => x.key === key)) devices.push({ key, ...d });
    }
    const tick = (t) => (devices.some((d) => (SCHEDULE_DEVICES.includes(d.device_type) ? d.device_type : 'Other') === t) ? '✓' : '');
    const nameLine = certifier ? esc(certifier.name) : '______________________';
    const body = `
  <div class="banner"><b>DRAFT generated from CustodyChain records.</b> The certifying ${isB ? 'expert' : 'person'} must check every entry against the device and records, complete the blanks and sign. Generating this draft does not certify anything.</div>
  <p style="text-align:center;margin:4mm 0 0"><b>THE SCHEDULE</b><br>[See section 63(4)(c)]<br><b>CERTIFICATE</b><br><b>PART ${isB ? 'B' : 'A'}</b><br>(To be filled by the ${isB ? 'Expert' : 'Party'})</p>
  <p>I, ${nameLine} (Name), son/daughter/spouse of ______________________ residing/employed at ${certifier ? esc(certifier.org_name) : '______________________'} do hereby solemnly affirm and sincerely state and submit as follows:</p>
  <p>${isB ? 'The produced electronic record/output of the digital record are obtained from the following device/digital record source' : 'I have produced electronic record/output of the digital record taken from the following device/digital record source'} (tick mark):</p>
  <p>${SCHEDULE_DEVICES.map((t) => `<span class="box">${tick(t)}</span>${esc(t)}`).join('&nbsp;&nbsp; ')}</p>
  <table class="kv">
  ${devices.map((d, i) => `<tr><td>Device ${i + 1}: make &amp; model</td><td>${esc(d.make_model)}${d.colour ? `, colour ${esc(d.colour)}` : ''}</td></tr>
    <tr><td>Serial number</td><td>${esc(d.serial_number || '____________')}</td></tr>
    <tr><td>IMEI/UIN/UID/MAC/Cloud ID</td><td>${esc(d.imei_uin_uid_mac_cloud_id || '____________')}</td></tr>`).join('')}
    <tr><td>Other relevant information</td><td>Evidence ${esc(record.evidence_id)}, ${esc(record.title)}; FIR ${esc(record.case.fir_number)}, ${esc(record.case.police_station)}</td></tr>
  </table>
  ${isB ? '' : `<p>The digital device or the digital record source was under the lawful control for regularly creating, storing or processing information for the purposes of carrying out regular activities and during this period, the computer or the communication device was working properly and the relevant information was regularly fed into the computer during the ordinary course of business. If the computer/digital device at any point of time was not working properly or out of operation, then it has not affected the electronic/digital record or its accuracy. The digital device or the source of the digital record is: <span class="box"></span>Owned <span class="box"></span>Maintained <span class="box"></span>Managed <span class="box"></span>Operated by me (select as applicable).</p>`}
  <p>I state that the HASH value/s of the electronic/digital record/s is/are as listed below, obtained through the following algorithm:<br>
   <span class="box"></span>SHA1 &nbsp; <span class="box">✓</span>SHA256 &nbsp; <span class="box"></span>MD5 &nbsp; <span class="box">✓</span>Other: SHA3-256 (FIPS 202) (Legally acceptable standard)</p>
  <table><tr><th>Record</th><th>SHA256</th><th>SHA3-256</th></tr>
  ${manifest.artefacts.map((a) => `<tr><td>${esc(a.artefact_id)} ${esc(a.file_name)}</td><td class="mono">${esc(a.sha256)}</td><td class="mono">${esc(a.sha3_256)}</td></tr>`).join('')}
  </table>
  <p class="muted">(Hash report to be enclosed with the certificate: the CustodyChain custody report for ${esc(record.evidence_id)}, whose manifest SHA-256 ${esc(record.manifest_sha256)} is anchored on the ledger.)</p>
  <div class="sig"><div><div>Date (DD/MM/YYYY): __________</div><div>Time (IST): ________ hours (in 24 hours format)</div><div>Place: __________</div></div>
  <div class="line">(Name${isB ? ', designation' : ''} and signature)</div></div>`;
    return page(`BSA s.63 certificate Part ${part} ${record.evidence_id}`, body);
}

module.exports = { custodyReport, bsa63, eventSummary };
