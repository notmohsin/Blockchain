<script>
  import { api } from '../lib/api.js';
  import { sha256File } from '../lib/hash.js';
  import { human } from '../lib/time.js';
  import { CLASS_LABEL, EVENT_LABEL, ORG_SHORT } from '../lib/labels.js';
  import Hash from '../components/Hash.svelte';
  import StatusChip from '../components/StatusChip.svelte';
  import Notice from '../components/Notice.svelte';
  let { id, user } = $props();

  let rec = $state(null);
  let history = $state([]);
  let manifest = $state(null);
  let checks = $state(null);
  let users = $state([]);
  let error = $state('');
  let ok = $state('');
  let busy = $state(false);
  let panel = $state('');
  let proof = $state(null);
  // action form state
  let a = $state({ to_user: '', reason: '', seals: '', intact: true, method: 'phash-dct-64', result: 'MATCH', score: '', threshold: '10', court_order: '', exhibit: '', attach: [] });
  let verifyResult = $state(null);
  let idResult = $state(null);

  async function load() {
    error = '';
    try {
      const r = await api.get(id);
      rec = r.record; history = r.history;
      if (r.manifest_available) { const m = await api.manifest(id); manifest = m.manifest; checks = m.checks; }
    } catch (e) { error = e.message; }
  }
  $effect(() => { load(); api.users().then((u) => (users = u)).catch(() => {}); });

  const isCustodian = $derived(rec && rec.custodian.cn === user.username && rec.custodian.msp === user.msp);
  const isReceiver = $derived(rec && rec.pending_transfer && rec.pending_transfer.to_user === user.username);
  const final = $derived(rec && ['DISPOSED', 'RETURNED'].includes(rec.status));
  const canAct = $derived(isCustodian && rec.status !== 'IN_TRANSFER' && !final);

  function open(p) {
    panel = panel === p ? '' : p; ok = ''; error = ''; verifyResult = null; idResult = null;
    a.reason = ''; a.seals = p === 'accept' || p === 'reject' ? (rec.seal_ids || []).join(', ') : ''; a.attach = [];
    if (p === 'dispose') a.result = 'RETURN';
    if (p === 'identity') a.result = 'MATCH';
  }
  async function run(fn, msg) {
    busy = true; error = ''; ok = '';
    try { await fn(); ok = msg; panel = ''; a.reason = ''; a.attach = []; await load(); } catch (e) { error = e.message; } finally { busy = false; }
  }
  const seals = () => a.seals.split(',').map((s) => s.trim()).filter(Boolean);
  async function hashesOf(fileList) { return Promise.all([...fileList].map(sha256File)); }

  const doTransfer = () => run(() => api.transfer(id, { to_user: a.to_user, reason: a.reason }), 'Transfer initiated. Custody moves when the receiver accepts.');
  const doAccept = () => run(() => api.accept(id, { seal_ids_observed: seals(), seal_intact: a.intact, reason: a.reason }), 'Custody accepted. You are now the custodian.');
  const doReject = () => run(() => api.reject(id, { seal_ids_observed: seals(), seal_intact: a.intact, reason: a.reason }), 'Transfer rejected. The item stays with the sender.');
  const doCancel = () => run(() => api.cancel(id, { reason: a.reason }), 'Transfer cancelled.');
  const doEvent = (type, details) => run(() => api.event(id, { type, details, reason: a.reason }), `${EVENT_LABEL[type]}: recorded on the ledger.`);

  async function doIdentity() {
    const q = await hashesOf(a.attach);
    await doEvent('VERIFY_IDENTITY', { verification: { method: a.method, method_version: '1', result: a.result, score: a.score || undefined, threshold: a.threshold || undefined, query_artefact_sha256: q } });
  }
  async function doIdentityRun() {
    busy = true; error = ''; ok = '';
    try {
      const fd = new FormData();
      [...a.attach].forEach((f, i) => fd.append(`q${i}`, f, f.name));
      fd.append('reason', a.reason);
      idResult = await api.identityCheck(id, fd);
      panel = ''; a.reason = ''; a.attach = []; await load();
    } catch (e) { error = e.message; } finally { busy = false; }
  }
  async function doExamEnd() { await doEvent('EXAMINE_END', { attachments_sha256: await hashesOf(a.attach) }); }

  async function doVerify(ev) {
    const file = ev.target.files[0];
    if (!file) return;
    busy = true; verifyResult = null; error = '';
    try {
      const fd = new FormData(); fd.append('file', file, file.name);
      verifyResult = await api.verify(id, fd);
      await load();
    } catch (e) { error = e.message; } finally { busy = false; ev.target.value = ''; }
  }
  async function download(aid) {
    const reason = prompt('Reason for accessing this file (recorded on the ledger):');
    if (!reason) return;
    try {
      const blob = await api.download(id, aid, reason);
      const art = manifest.artefacts.find((x) => x.artefact_id === aid);
      const url = URL.createObjectURL(blob);
      Object.assign(document.createElement('a'), { href: url, download: art.file_name || aid }).click();
      setTimeout(() => URL.revokeObjectURL(url), 2000);
      await load();
    } catch (e) { error = e.message; }
  }
  // M7 (D-049): court outputs open in a new tab (Print -> Save as PDF); generating one is recorded as ACCESS
  async function openDoc(kind, part) {
    const w = window.open('', '_blank');
    try {
      if (kind === 'bundle') {
        const b = await api.bundle(id);
        const url = URL.createObjectURL(new Blob([JSON.stringify(b, null, 2)], { type: 'application/json' }));
        Object.assign(document.createElement('a'), { href: url, download: `${id}.bundle.json` }).click();
        w && w.close();
      } else {
        const blob = kind === 'report' ? await api.report(id) : await api.bsa63(id, part);
        const html = await blob.text();
        if (w) { w.document.open(); w.document.write(html); w.document.close(); }
      }
      await load();
    } catch (e) { w && w.close(); error = e.message; }
  }
  async function showProof(aid) { try { proof = await api.proof(id, aid); } catch (e) { error = e.message; } }

  function summary(ev) {
    const d = ev.details || {};
    switch (ev.type) {
    case 'REGISTER': return d.derived_from ? `Derived from ${d.derived_from}` : `Manifest ${d.manifest_sha256?.slice(0, 12)}…`;
    case 'TRANSFER_INITIATE': return `to ${d.to_user} (${ORG_SHORT[d.to_msp]})`;
    case 'TRANSFER_ACCEPT': case 'TRANSFER_REJECT': return `from ${d.from?.cn} (${ORG_SHORT[d.from?.msp]}); seal ${d.seal_ids_observed?.join(', ') || 'none'}: ${d.seal_intact ? 'intact' : 'NOT intact'}${d.seals_match === false ? ', MISMATCH with recorded seal' : ''}`;
    case 'SEAL': case 'RESEAL': return `seal ${d.seal_ids?.join(', ')}`;
    case 'VERIFY_INTEGRITY': case 'VERIFY_IDENTITY': return `${d.verification?.method}: ${d.verification?.result}${d.matched_artefact_id ? ` (${d.matched_artefact_id})` : ''}${d.verification?.score ? `, score ${d.verification.score}/${d.verification.threshold}` : ''}`;
    case 'ACCESS': return d.artefact_id ? `downloaded ${d.artefact_id}` : '';
    case 'DERIVE': return `child ${d.child_evidence_id}`;
    case 'EXAMINE_END': return d.attachments_sha256?.length ? `${d.attachments_sha256.length} report(s) attached` : '';
    case 'SUBMIT_COURT': return [d.court, d.exhibit].filter(Boolean).join(', ');
    default: return d.court_order_ref ? `order ${d.court_order_ref}` : '';
    }
  }
  const tone = (t) => (['TRANSFER_REJECT', 'DISPOSE'].includes(t) ? 'bg-bad-600' : t.startsWith('TRANSFER') ? 'bg-seal-500' : t.startsWith('VERIFY') ? 'bg-ok-600' : 'bg-ink-600');
</script>

{#if !rec}
  <Notice message={error} />
  {#if !error}<p class="py-10 text-center text-sm text-ink-400">Loading from the ledger…</p>{/if}
{:else}
  <a href="#/" class="text-sm text-ink-600 hover:underline">← all evidence</a>
  <div class="mt-2 flex flex-wrap items-start justify-between gap-3">
    <div>
      <h1 class="text-xl font-semibold">{rec.title}</h1>
      <p class="font-mono text-sm text-ink-700" data-testid="evidence-id">{rec.evidence_id}</p>
      <p class="mt-1 text-sm text-ink-600">{CLASS_LABEL[rec.evidence_class]} · FIR {rec.case.fir_number}, {rec.case.police_station}{rec.parent_evidence_id ? ` · derived from ${rec.parent_evidence_id}` : ''}</p>
    </div>
    <div class="text-right"><StatusChip status={rec.status} />
      <p class="mt-2 text-sm" data-testid="custodian">Custodian: <b>{rec.custodian.cn}</b> ({ORG_SHORT[rec.custodian.msp]}, {rec.custodian.role})</p>
      {#if rec.pending_transfer}<p class="text-sm text-seal-600" data-testid="pending">Awaiting <b>{rec.pending_transfer.to_user}</b> ({ORG_SHORT[rec.pending_transfer.to_msp]}) to accept</p>{/if}
    </div>
  </div>

  <div class="mt-4 space-y-2"><Notice message={error} /><Notice kind="ok" message={ok} /></div>

  <div class="mt-4 grid gap-5 lg:grid-cols-3">
    <div class="space-y-5 lg:col-span-2">
      <!-- actions -->
      <section class="card p-5" data-testid="actions">
        <h2 class="section-title mb-3">Actions</h2>
        <div class="flex flex-wrap gap-2">
          {#if isReceiver}
            <button class="btn-accent" onclick={() => open('accept')} data-action="accept">Accept custody</button>
            <button class="btn-danger" onclick={() => open('reject')} data-action="reject">Reject</button>
          {/if}
          {#if isCustodian && rec.pending_transfer}<button class="btn-ghost" onclick={() => open('cancel')} data-action="cancel">Cancel transfer</button>{/if}
          {#if canAct && rec.status === 'IN_CUSTODY'}<button class="btn-primary" onclick={() => open('transfer')} data-action="transfer">Transfer custody</button>{/if}
          {#if canAct}
            <button class="btn-ghost" onclick={() => open('seal')} data-action="seal">Seal / reseal</button>
            <button class="btn-ghost" onclick={() => open('identity-run')} data-action="identity-run">Run identity check</button>
            <button class="btn-ghost" onclick={() => open('identity')} data-action="identity">Record manual check</button>
            {#if user.role === 'examiner' && rec.status === 'IN_CUSTODY'}<button class="btn-ghost" onclick={() => open('exam-start')} data-action="exam-start">Start examination</button>{/if}
            {#if user.role === 'examiner' && rec.status === 'UNDER_EXAMINATION'}<button class="btn-ghost" onclick={() => open('exam-end')} data-action="exam-end">Complete examination</button>{/if}
            {#if rec.status === 'IN_CUSTODY'}<button class="btn-ghost" onclick={() => open('court')} data-action="court">Record court submission</button>
              <button class="btn-ghost" onclick={() => open('dispose')} data-action="dispose">Return / archive / dispose</button>{/if}
          {/if}
          <label class="btn-ghost cursor-pointer" data-action="verify">Verify a file against the ledger<input type="file" class="hidden" onchange={doVerify} data-testid="verify-input" /></label>
        </div>
        {#if !isCustodian && !isReceiver}<p class="mt-3 text-xs text-ink-400">Custody actions are available only to the current custodian. Any user may verify files.</p>{/if}

        {#if panel}
          <form class="mt-4 space-y-3 rounded-md bg-ink-50 p-4" onsubmit={(e) => { e.preventDefault(); ({ transfer: doTransfer, accept: doAccept, reject: doReject, cancel: doCancel,
            seal: () => doEvent('RESEAL', { seal_ids: seals() }), identity: doIdentity, 'identity-run': doIdentityRun, 'exam-start': () => doEvent('EXAMINE_START', {}), 'exam-end': doExamEnd,
            court: () => doEvent('SUBMIT_COURT', { court: 'CJM Gandhinagar', exhibit: a.exhibit || undefined }),
            dispose: () => doEvent(a.result, { court_order_ref: a.court_order }) })[panel](); }} data-testid="action-form">
            {#if panel === 'transfer'}
              <div><label class="label" for="to">Transfer to</label>
                <select id="to" class="input" bind:value={a.to_user} required>
                  <option value="" disabled>Choose the receiving person</option>
                  {#each users.filter((u) => u.username !== user.username) as u}<option value={u.username}>{u.name}, {u.role_label} ({u.org_name})</option>{/each}
                </select></div>
            {/if}
            {#if panel === 'accept' || panel === 'reject'}
              <div><label class="label" for="seals">Seal number(s) read on the package</label><input id="seals" class="input" bind:value={a.seals} /></div>
              <label class="flex items-center gap-2 text-sm"><input type="checkbox" bind:checked={a.intact} /> Seal intact</label>
              <p class="text-xs text-ink-600">Recorded seal: {rec.seal_ids?.join(', ') || 'none'}. A mismatch or broken seal is recorded permanently.</p>
            {/if}
            {#if panel === 'seal'}<div><label class="label" for="ns">New seal number(s)</label><input id="ns" class="input" bind:value={a.seals} required /></div>{/if}
            {#if panel === 'identity'}
              <div class="grid gap-3 sm:grid-cols-4">
                <div class="sm:col-span-2"><label class="label" for="m">Method</label><select id="m" class="input" bind:value={a.method}>
                  {#each ['phash-dct-64', 'mesh-icp-rms', 'seal-id-exact', 'serial-exact', 'measurement-tolerance', 'visual-examination'] as m}<option>{m}</option>{/each}</select></div>
                <div><label class="label" for="r">Result</label><select id="r" class="input" bind:value={a.result}>{#each ['MATCH', 'NO_MATCH', 'INCONCLUSIVE'] as r}<option>{r}</option>{/each}</select></div>
                <div><label class="label" for="sc">Score / threshold</label><div class="flex gap-1"><input id="sc" class="input" bind:value={a.score} placeholder="4" /><input class="input" bind:value={a.threshold} placeholder="10" aria-label="threshold" /></div></div>
              </div>
              <div><label class="label" for="qf">New captures used for the check (hashed in your browser)</label><input id="qf" type="file" multiple onchange={(e) => (a.attach = e.target.files)} /></div>
            {/if}
            {#if panel === 'identity-run'}
              <div><label class="label" for="iq">New captures of the item (page re-scans in page order, photos, or a 3D scan)</label>
                <input id="iq" type="file" multiple required onchange={(e) => (a.attach = e.target.files)} /></div>
              <p class="text-xs text-ink-600">They are compared with the reference fingerprints in the manifest (pHash for images, 3D deviation for scans). The new captures are stored encrypted and the result is recorded on the ledger.</p>
            {/if}
            {#if panel === 'exam-end'}<div><label class="label" for="rf">Examination report(s) (hashed in your browser; only the hash is recorded)</label><input id="rf" type="file" multiple onchange={(e) => (a.attach = e.target.files)} /></div>{/if}
            {#if panel === 'court'}<div><label class="label" for="ex">Exhibit / article number</label><input id="ex" class="input" bind:value={a.exhibit} placeholder="Article 4" /></div>{/if}
            {#if panel === 'dispose'}
              <div class="grid gap-3 sm:grid-cols-2">
                <div><label class="label" for="dk">Action</label><select id="dk" class="input" bind:value={a.result}><option>RETURN</option><option>ARCHIVE</option><option>DISPOSE</option></select></div>
                <div><label class="label" for="co">Court order reference</label><input id="co" class="input" bind:value={a.court_order} required /></div>
              </div>
            {/if}
            <div><label class="label" for="why">Reason (recorded on the ledger)</label><input id="why" class="input" bind:value={a.reason} required minlength="3" /></div>
            <div class="flex gap-2"><button class="btn-primary" type="submit" disabled={busy} data-testid="action-submit">{busy ? 'Submitting to the ledger…' : 'Sign and submit'}</button>
              <button class="btn-ghost" type="button" onclick={() => (panel = '')}>Close</button></div>
          </form>
        {/if}

        {#if idResult}
          <div class="mt-4 rounded-md border p-4 {idResult.result === 'MATCH' ? 'border-ok-600/40 bg-ok-50' : 'border-bad-600/40 bg-bad-50'}" data-testid="identity-result" data-result={idResult.result}>
            <p class="text-lg font-semibold {idResult.result === 'MATCH' ? 'text-ok-700' : 'text-bad-700'}">Identity check: {idResult.result.replace('_', ' ')}</p>
            {#each idResult.notes as n}<p class="text-sm text-bad-700">{n}</p>{/each}
            <table class="mt-2 w-full text-left text-xs"><thead class="text-ink-400"><tr><th>New capture</th><th>Reference</th><th>Method</th><th>Score</th><th></th></tr></thead>
              <tbody>{#each idResult.pairs as p}<tr class="border-t border-ink-100"><td class="py-1">{p.query}</td><td>{p.ref_artefact_id || '—'}{p.page ? ` (page ${p.page})` : ''}</td><td>{p.method}</td>
                <td class="font-mono">{p.distance ?? ''}{p.rms_mm !== undefined ? `rms ${p.rms_mm} / max ${p.max_mm} mm` : ''}{p.distance !== undefined && p.distance !== null ? ` ≤ ${p.threshold}?` : ''}</td>
                <td class="font-semibold {p.pass ? 'text-ok-700' : 'text-bad-700'}">{p.pass ? 'pass' : 'FAIL'}</td></tr>{/each}</tbody></table>
            <p class="mt-1 text-xs text-ink-600">Thresholds are illustrative until calibrated on real captures (D-020). Recorded as a VERIFY_IDENTITY event.</p>
          </div>
        {/if}
        {#if verifyResult}
          <div class="mt-4 rounded-md border p-4 {verifyResult.result === 'MATCH' ? 'border-ok-600/40 bg-ok-50' : 'border-bad-600/40 bg-bad-50'}" data-testid="verify-result" data-result={verifyResult.result}>
            <p class="text-lg font-semibold {verifyResult.result === 'MATCH' ? 'text-ok-700' : 'text-bad-700'}">{verifyResult.result === 'MATCH' ? '✓ MATCH' : verifyResult.result === 'NO_MATCH' ? '✗ NO MATCH' : '? INCONCLUSIVE'}</p>
            <p class="text-sm">{verifyResult.file.name}: <Hash value={verifyResult.file.sha256} label="sha-256" /></p>
            {#if verifyResult.matched_artefact}<p class="text-sm">Identical to artefact <b>{verifyResult.matched_artefact.artefact_id}</b> ({verifyResult.matched_artefact.role}, {verifyResult.matched_artefact.file_name}).</p>
            {:else if verifyResult.result === 'NO_MATCH'}<p class="text-sm">This file is not any of the {rec.artefact_count} files fingerprinted for this item. It has been altered or is a different file.</p>{/if}
            <p class="mt-1 text-xs text-ink-600">Manifest matches ledger: {verifyResult.checks.manifest_sha256_matches_ledger ? 'yes' : 'NO'} · Merkle root matches ledger: {verifyResult.checks.merkle_root_matches_ledger ? 'yes' : 'NO'} · recorded as a VERIFY_INTEGRITY event</p>
          </div>
        {/if}
      </section>

      <!-- timeline -->
      <section class="card p-5">
        <h2 class="section-title mb-4">Chain of custody ({history.length} events on the ledger)</h2>
        <ol class="relative ml-2 border-l border-ink-100" data-testid="timeline">
          {#each history as ev}
            <li class="mb-5 ml-5" data-event={ev.type}>
              <span class="absolute -left-[7px] mt-1.5 h-3 w-3 rounded-full ring-4 ring-white {tone(ev.type)}"></span>
              <div class="flex flex-wrap items-baseline justify-between gap-2">
                <span class="font-medium">{EVENT_LABEL[ev.type] || ev.type}</span>
                <span class="text-xs text-ink-400">{human(ev.timestamp)}</span>
              </div>
              <div class="text-sm text-ink-700">{ev.actor.cn} <span class="text-ink-400">({ORG_SHORT[ev.actor.msp] || ev.actor.msp}, {ev.actor.role})</span></div>
              <div class="text-sm text-ink-600">{ev.reason}</div>
              {#if summary(ev)}<div class="text-xs text-ink-600">{summary(ev)}</div>{/if}
              <div class="text-[11px] text-ink-400">tx <span class="font-mono">{ev.tx_id.slice(0, 16)}…</span></div>
            </li>
          {/each}
        </ol>
      </section>
    </div>

    <!-- fingerprints + artefacts -->
    <div class="space-y-5">
      <section class="card space-y-2 p-5 text-sm">
        <h2 class="section-title">On-chain fingerprints</h2>
        <div><div class="text-xs text-ink-400">Manifest SHA-256</div><Hash value={rec.manifest_sha256} short={24} /></div>
        <div><div class="text-xs text-ink-400">Merkle root ({rec.artefact_count} artefacts)</div><Hash value={rec.merkle_root} short={24} /></div>
        {#if checks}
          <p class="text-xs {checks.manifest_sha256_matches_ledger && checks.merkle_root_matches_ledger ? 'text-ok-700' : 'text-bad-700'}" data-testid="manifest-checks">
            {checks.manifest_sha256_matches_ledger && checks.merkle_root_matches_ledger ? '✓ Off-chain manifest matches the ledger' : '✗ Off-chain manifest does NOT match the ledger'}</p>
        {/if}
        <p class="text-xs text-ink-400">Registered {human(rec.registered_at)} by {rec.registered_by.cn}. Seal: {rec.seal_ids?.join(', ') || 'none'}</p>
        <div class="flex flex-wrap gap-2 pt-2" data-testid="court-outputs">
          <button class="btn-ghost !px-2.5 !py-1.5 text-xs" onclick={() => openDoc('report')} data-doc="report">Custody report</button>
          <button class="btn-ghost !px-2.5 !py-1.5 text-xs" onclick={() => openDoc('bsa63', 'A')} data-doc="bsa-a">BSA §63 Part A</button>
          <button class="btn-ghost !px-2.5 !py-1.5 text-xs" onclick={() => openDoc('bsa63', 'B')} data-doc="bsa-b">BSA §63 Part B</button>
          <button class="btn-ghost !px-2.5 !py-1.5 text-xs" onclick={() => openDoc('bundle')} data-doc="bundle">Verification bundle</button>
        </div>
        {#if rec.children?.length}<p class="text-xs">Derived items: {#each rec.children as c}<a class="font-mono text-seal-600 hover:underline" href="#/evidence/{encodeURIComponent(c)}">{c}</a> {/each}</p>{/if}
      </section>
      {#if manifest}
        <section class="card p-5 text-sm">
          <h2 class="section-title mb-3">Files (encrypted off-chain)</h2>
          <ul class="space-y-3" data-testid="artefacts">
            {#each manifest.artefacts as art}
              <li class="border-b border-ink-100 pb-2 last:border-0">
                <div class="flex items-center justify-between"><b>{art.artefact_id}</b><span class="text-xs text-ink-400">{art.role}</span></div>
                <div class="truncate text-ink-700">{art.file_name}</div>
                <Hash value={art.sha256} label="sha-256" />
                <div class="mt-1 flex gap-3 text-xs"><button class="text-seal-600 hover:underline" onclick={() => download(art.artefact_id)}>download</button>
                  <button class="text-seal-600 hover:underline" onclick={() => showProof(art.artefact_id)}>inclusion proof</button></div>
              </li>
            {/each}
          </ul>
        </section>
        <section class="card p-5 text-sm">
          <h2 class="section-title mb-2">Collection</h2>
          <p>{manifest.collection.collected_by.name}, {manifest.collection.collected_by.designation}</p>
          <p class="text-ink-600">{human(manifest.collection.collected_at)} · {manifest.collection.location.description}</p>
          <p class="text-ink-600">{manifest.collection.legal_basis}</p>
          {#if manifest.collection.witnesses?.length}<p class="text-ink-600">Witnesses: {manifest.collection.witnesses.map((w) => w.name).join(', ')}</p>{/if}
        </section>
      {/if}
      {#if proof}
        <section class="card p-5 text-xs" data-testid="proof">
          <h2 class="section-title mb-2">Inclusion proof: {proof.artefact_id}</h2>
          <p>Leaf {proof.leaf_index + 1} of {proof.tree_size} · {proof.audit_path.length} sibling hashes · <b class={proof.matches_ledger ? 'text-ok-700' : 'text-bad-700'}>{proof.matches_ledger ? 'verifies against the ledger root' : 'does NOT verify'}</b></p>
          {#each proof.audit_path as h, i}<div><span class="text-ink-400">[{i}]</span> <Hash value={h} short={32} /></div>{/each}
          <button class="mt-2 text-seal-600 hover:underline" onclick={() => (proof = null)}>close</button>
        </section>
      {/if}
    </div>
  </div>
{/if}
