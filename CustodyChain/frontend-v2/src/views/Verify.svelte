<script>
  import { api } from '../lib/api.js';
  import { sha256File } from '../lib/hash.js';
  import Hash from '../components/Hash.svelte';
  import Notice from '../components/Notice.svelte';
  let { initialId = '' } = $props();
  // svelte-ignore state_referenced_locally
  let id = $state(initialId); // initial value only: the field is then edited by the user
  let file = $state(null);
  let localHash = $state('');
  let result = $state(null);
  let error = $state('');
  let busy = $state(false);

  async function pick(e) { file = e.target.files[0]; result = null; localHash = file ? await sha256File(file) : ''; }
  async function submit(e) {
    e.preventDefault(); busy = true; error = ''; result = null;
    try { const fd = new FormData(); fd.append('file', file, file.name); result = await api.verify(id.trim(), fd); }
    catch (err) { error = err.message; } finally { busy = false; }
  }
</script>

<div class="mx-auto max-w-2xl">
  <h1 class="text-xl font-semibold">Verify a file against the ledger</h1>
  <p class="mb-5 text-sm text-ink-600">For a court, defence expert or any agency: check whether a file produced today is bit-for-bit identical to one fingerprinted at collection. The file is hashed (SHA-256 + SHA3-256) and compared with the item's manifest, whose fingerprint is anchored on the BFT ledger. The check itself is recorded.</p>
  <form class="card space-y-4 p-5" onsubmit={submit}>
    <div><label class="label" for="vid">Evidence ID</label><input id="vid" class="input font-mono" bind:value={id} required placeholder="GJ-GNR-CYBPS-2026-000123-E004" /></div>
    <div><label class="label" for="vf">File</label><input id="vf" type="file" onchange={pick} required />
      {#if localHash}<p class="mt-1 text-xs">Computed in your browser: <Hash value={localHash} short={0} /></p>{/if}</div>
    <Notice message={error} />
    <button class="btn-primary" disabled={busy || !file} type="submit">{busy ? 'Checking…' : 'Verify'}</button>
  </form>
  {#if result}
    <div class="card mt-5 p-5 {result.result === 'MATCH' ? 'border-ok-600/40' : 'border-bad-600/40'}" data-testid="verify-page-result" data-result={result.result}>
      <p class="text-2xl font-semibold {result.result === 'MATCH' ? 'text-ok-700' : 'text-bad-700'}">{result.result === 'MATCH' ? '✓ MATCH' : result.result === 'NO_MATCH' ? '✗ NO MATCH' : '? INCONCLUSIVE'}</p>
      {#if result.matched_artefact}<p class="mt-1 text-sm">Identical to artefact <b>{result.matched_artefact.artefact_id}</b> ({result.matched_artefact.role}) <i>{result.matched_artefact.file_name}</i>, captured {result.matched_artefact.captured_at}.</p>
      {:else}<p class="mt-1 text-sm">Not identical to any file fingerprinted for {id}. Even a one-bit change produces a different SHA-256.</p>{/if}
      <dl class="mt-3 grid gap-1 text-xs sm:grid-cols-[11rem_1fr]">
        <dt class="text-ink-400">File SHA-256</dt><dd><Hash value={result.file.sha256} short={0} /></dd>
        <dt class="text-ink-400">Ledger manifest SHA-256</dt><dd><Hash value={result.ledger.manifest_sha256} short={0} /></dd>
        <dt class="text-ink-400">Ledger Merkle root</dt><dd><Hash value={result.ledger.merkle_root} short={0} /></dd>
        <dt class="text-ink-400">Manifest ↔ ledger</dt><dd>{result.checks.manifest_sha256_matches_ledger && result.checks.merkle_root_matches_ledger ? 'consistent' : 'INCONSISTENT'}</dd>
      </dl>
      <a class="mt-3 inline-block text-sm text-seal-600 hover:underline" href="#/evidence/{encodeURIComponent(id)}">Open the custody record →</a>
    </div>
  {/if}
</div>
