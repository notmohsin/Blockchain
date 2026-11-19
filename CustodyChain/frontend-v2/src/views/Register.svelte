<script>
  import { api } from '../lib/api.js';
  import { CLASSES, LEGAL_BASES, CAPTURE_DEVICES, buildClassAttributes } from '../lib/classes.js';
  import { sha256File } from '../lib/hash.js';
  import { istLocalInput, fromLocalInput, istString } from '../lib/time.js';
  import Hash from '../components/Hash.svelte';
  import Notice from '../components/Notice.svelte';
  let { user } = $props();

  let cls = $state('');
  let units = $state([]);
  // common manifest fields
  let f = $state({
    title: '', description: '', fir: '', ps: '', district: 'Gandhinagar', state: 'Gujarat', sections: '',
    collected_at: istLocalInput(), loc_desc: '', loc_addr: '', lat: '', lon: '', legal_basis: LEGAL_BASES[0],
    w1_name: '', w1_addr: '', w2_name: '', w2_addr: '', condition: '',
    container: 'tamper-evident evidence bag', seals: '', label_id: '',
    dev_type: 'Mobile', dev_model: '', dev_serial: '', dev_imei: '', reason: '',
  });
  let attrs = $state({});
  let files = $state({});          // slot -> [{ file, sha256, captured_at }]
  let hashing = $state(false);
  let busy = $state(false);
  let error = $state('');
  let details = $state([]);
  let result = $state(null);

  $effect(() => { api.meta().then((m) => { units = m.units; if (!f.ps) f.ps = m.units[0]; }).catch(() => {}); });

  function choose(c) {
    cls = c; files = {}; result = null; error = '';
    const a = {};
    for (const fd of CLASSES[c].fields) a[fd.key] = fd.default !== undefined ? fd.default : (fd.type === 'bool' ? false : '');
    attrs = a;
    if (c === 'PHYSICAL_DOCUMENT' || c === 'PHYSICAL_ITEM') f.dev_type = c === 'PHYSICAL_DOCUMENT' ? 'Flatbed Scanner' : 'Camera';
  }

  async function pick(slot, ev) {
    const list = [...ev.target.files];
    hashing = true;
    try {
      files[slot] = await Promise.all(list.map(async (file) => ({
        file, sha256: await sha256File(file), captured_at: istString(new Date(file.lastModified || Date.now())),
      })));
    } finally { hashing = false; }
  }

  const counts = $derived(Object.fromEntries(Object.entries(files).map(([k, v]) => [k, v.length])));
  const totalFiles = $derived(Object.values(files).reduce((n, v) => n + v.length, 0));

  function draft() {
    const def = CLASSES[cls];
    const artefacts = [];
    const form = new FormData();
    const hashes = {};
    let n = 0;
    const device = { device_type: f.dev_type, make_model: f.dev_model || 'not recorded' };
    if (f.dev_serial) device.serial_number = f.dev_serial;
    if (f.dev_imei) device.imei_uin_uid_mac_cloud_id = f.dev_imei;
    for (const slot of def.files) {
      for (const it of files[slot.slot] || []) {
        n += 1;
        const field = `file${n}`;
        form.append(field, it.file, it.file.name);
        hashes[field] = it.sha256;
        const media = it.file.type || slot.mediaType || 'application/octet-stream';
        artefacts.push({ file_field: field, role: slot.role, media_type: media, captured_at: it.captured_at, capture_device: device });
      }
    }
    const witnesses = [[f.w1_name, f.w1_addr], [f.w2_name, f.w2_addr]].filter(([nm]) => nm.trim())
      .map(([nm, ad]) => ({ name: nm.trim(), role: 'Independent Witness', address: ad.trim() }));
    const location = { description: f.loc_desc.trim() || 'not recorded' };
    if (f.loc_addr.trim()) location.address = f.loc_addr.trim();
    if (f.lat.trim() && f.lon.trim()) { location.latitude = f.lat.trim(); location.longitude = f.lon.trim(); location.position_source = 'MANUAL'; }
    const packaging = { container: f.container.trim() || 'none' };
    const seals = f.seals.split(',').map((s) => s.trim()).filter(Boolean);
    if (seals.length) packaging.seal_ids = seals;
    if (f.label_id.trim()) packaging.label_id = f.label_id.trim();
    const m = {
      evidence_class: cls, title: f.title.trim(),
      case: { fir_number: f.fir.trim(), police_station: f.ps, district: f.district.trim(), state: f.state.trim(),
        sections_invoked: f.sections.split(',').map((s) => s.trim()).filter(Boolean) },
      collection: { collected_at: fromLocalInput(f.collected_at), location, legal_basis: f.legal_basis, witnesses },
      packaging, class_attributes: buildClassAttributes(cls, attrs, counts), artefacts,
    };
    if (f.description.trim()) m.description = f.description.trim();
    if (f.condition.trim()) m.collection.condition_on_collection = f.condition.trim();
    form.append('draft', JSON.stringify(m));
    form.append('client_hashes', JSON.stringify(hashes));
    form.append('reason', f.reason.trim() || `Seized under ${f.legal_basis}`);
    form.append('location', f.loc_addr.trim() || f.loc_desc.trim());
    return form;
  }

  async function submit(e) {
    e.preventDefault(); error = ''; details = [];
    for (const slot of CLASSES[cls].files) {
      if (slot.required && !(files[slot.slot] || []).length) { error = `Add at least one file: ${slot.label}`; return; }
    }
    busy = true;
    try { result = await api.register(draft()); window.scrollTo(0, 0); } catch (err) { error = err.message; details = err.details || []; } finally { busy = false; }
  }
</script>

{#if result}
  <div class="card p-6" data-testid="register-result">
    <p class="section-title text-ok-700">Registered on the ledger</p>
    <h1 class="mt-1 text-xl font-semibold">{result.record.title}</h1>
    <p class="font-mono text-sm text-ink-700" data-testid="new-evidence-id">{result.record.evidence_id}</p>
    <dl class="mt-4 grid gap-2 text-sm sm:grid-cols-[12rem_1fr]">
      <dt class="text-ink-600">Manifest SHA-256 (on-chain)</dt><dd><Hash value={result.record.manifest_sha256} short={0} /></dd>
      <dt class="text-ink-600">Merkle root (on-chain)</dt><dd><Hash value={result.record.merkle_root} short={0} /></dd>
      <dt class="text-ink-600">Artefacts</dt><dd>{result.record.artefact_count} file(s), stored encrypted off-chain</dd>
      <dt class="text-ink-600">Custodian</dt><dd>{result.record.custodian.cn} ({result.record.custodian.msp})</dd>
    </dl>
    <div class="mt-5 flex gap-2">
      <a class="btn-primary" href="#/evidence/{encodeURIComponent(result.record.evidence_id)}">Open evidence record</a>
      <button class="btn-ghost" onclick={() => { result = null; cls = ''; }}>Register another item</button>
    </div>
  </div>
{:else if !cls}
  <h1 class="mb-1 text-xl font-semibold">Register evidence</h1>
  <p class="mb-5 text-sm text-ink-600">Choose what was seized. Files are fingerprinted in your browser before upload; the ledger stores only the fingerprints.</p>
  <div class="grid gap-4 sm:grid-cols-2">
    {#each Object.entries(CLASSES) as [k, c]}
      <button class="card p-5 text-left hover:border-seal-400" onclick={() => choose(k)} data-class={k}>
        <div class="font-semibold">{c.label}</div>
        <p class="mt-1 text-sm text-ink-600">{c.blurb}</p>
      </button>
    {/each}
  </div>
{:else}
  <form class="space-y-6" onsubmit={submit} data-testid="register-form">
    <div class="flex items-center justify-between">
      <div>
        <button type="button" class="text-sm text-ink-600 hover:underline" onclick={() => (cls = '')}>← evidence type</button>
        <h1 class="text-xl font-semibold">Register: {CLASSES[cls].label}</h1>
      </div>
    </div>

    <section class="card grid gap-4 p-5 sm:grid-cols-4">
      <h2 class="section-title sm:col-span-4">Case</h2>
      <div><label class="label" for="fir">FIR number</label><input id="fir" class="input" bind:value={f.fir} placeholder="123/2026" required pattern={'[0-9]{1,6}/[0-9]{4}'} /></div>
      <div class="sm:col-span-2"><label class="label" for="ps">Police station</label><select id="ps" class="input" bind:value={f.ps}>{#each units as u}<option>{u}</option>{/each}</select></div>
      <div><label class="label" for="sec">Sections (comma-separated)</label><input id="sec" class="input" bind:value={f.sections} placeholder="BNS s.318(4)" /></div>
      <div><label class="label" for="dist">District</label><input id="dist" class="input" bind:value={f.district} required /></div>
      <div><label class="label" for="st">State</label><input id="st" class="input" bind:value={f.state} required /></div>
    </section>

    <section class="card grid gap-4 p-5 sm:grid-cols-4">
      <h2 class="section-title sm:col-span-4">Item and collection</h2>
      <div class="sm:col-span-4"><label class="label" for="title">Short title</label><input id="title" class="input" bind:value={f.title} required minlength="3" placeholder="Spiral notebook 'ACCOUNTS 2026' from desk drawer" /></div>
      <div class="sm:col-span-4"><label class="label" for="desc">Description</label><textarea id="desc" class="input" rows="2" bind:value={f.description}></textarea></div>
      <div><label class="label" for="when">Collected at (IST)</label><input id="when" type="datetime-local" class="input" bind:value={f.collected_at} required /></div>
      <div class="sm:col-span-3"><label class="label" for="lb">Legal basis</label><select id="lb" class="input" bind:value={f.legal_basis}>{#each LEGAL_BASES as b}<option>{b}</option>{/each}</select></div>
      <div class="sm:col-span-2"><label class="label" for="ld">Place of collection</label><input id="ld" class="input" bind:value={f.loc_desc} required placeholder="Office premises, room 2, desk drawer" /></div>
      <div class="sm:col-span-2"><label class="label" for="la">Address</label><input id="la" class="input" bind:value={f.loc_addr} /></div>
      <div><label class="label" for="lat">Latitude</label><input id="lat" class="input" bind:value={f.lat} pattern={'-?[0-9]+(\\.[0-9]+)?'} /></div>
      <div><label class="label" for="lon">Longitude</label><input id="lon" class="input" bind:value={f.lon} pattern={'-?[0-9]+(\\.[0-9]+)?'} /></div>
      <div class="sm:col-span-2"><label class="label" for="cond">Condition on collection</label><input id="cond" class="input" bind:value={f.condition} /></div>
      <div><label class="label" for="w1">Witness 1</label><input id="w1" class="input" bind:value={f.w1_name} placeholder="Name" /></div>
      <div><label class="label" for="w1a">Witness 1 address</label><input id="w1a" class="input" bind:value={f.w1_addr} /></div>
      <div><label class="label" for="w2">Witness 2</label><input id="w2" class="input" bind:value={f.w2_name} placeholder="Name" /></div>
      <div><label class="label" for="w2a">Witness 2 address</label><input id="w2a" class="input" bind:value={f.w2_addr} /></div>
      <p class="text-xs text-ink-400 sm:col-span-4">Collected by: <b>{user.name}</b>, {user.designation}. Taken from your certificate, not editable.</p>
    </section>

    <section class="card grid gap-4 p-5 sm:grid-cols-4">
      <h2 class="section-title sm:col-span-4">Packaging and seal</h2>
      <div class="sm:col-span-2"><label class="label" for="cont">Container</label><input id="cont" class="input" bind:value={f.container} /></div>
      <div><label class="label" for="seal">Seal number(s)</label><input id="seal" class="input" bind:value={f.seals} placeholder="TEB-GJ-0007741" /></div>
      <div><label class="label" for="lbl">Label / QR ID</label><input id="lbl" class="input" bind:value={f.label_id} /></div>
    </section>

    <section class="card grid gap-4 p-5 sm:grid-cols-4">
      <h2 class="section-title sm:col-span-4">{CLASSES[cls].label}: details</h2>
      {#each CLASSES[cls].fields as fd}
        {#if fd.type === 'bool'}
          <label class="flex items-center gap-2 text-sm sm:col-span-2"><input type="checkbox" bind:checked={attrs[fd.key]} /> {fd.label}</label>
        {:else if fd.type === 'select'}
          <div class="sm:col-span-2"><label class="label" for={fd.key}>{fd.label}</label>
            <select id={fd.key} class="input" bind:value={attrs[fd.key]} required={fd.required}>{#each fd.options as o}<option>{o}</option>{/each}</select></div>
        {:else}
          <div class="sm:col-span-2"><label class="label" for={fd.key}>{fd.label}{fd.required ? ' *' : ''}</label>
            <input id={fd.key} class="input" bind:value={attrs[fd.key]} required={fd.required} placeholder={fd.placeholder || ''}
              inputmode={fd.type === 'int' || fd.type === 'decimal' ? 'decimal' : undefined}
              pattern={fd.type === 'int' ? '[0-9]+' : fd.type === 'decimal' ? '-?[0-9]+(\\.[0-9]+)?' : undefined} /></div>
        {/if}
      {/each}
    </section>

    <section class="card space-y-4 p-5">
      <h2 class="section-title">Files and capture device</h2>
      <div class="grid gap-4 sm:grid-cols-4">
        <div><label class="label" for="dt">Device type</label><select id="dt" class="input" bind:value={f.dev_type}>{#each CAPTURE_DEVICES as d}<option>{d}</option>{/each}</select></div>
        <div><label class="label" for="dm">Make &amp; model</label><input id="dm" class="input" bind:value={f.dev_model} required /></div>
        <div><label class="label" for="ds">Serial number</label><input id="ds" class="input" bind:value={f.dev_serial} /></div>
        <div><label class="label" for="di">IMEI / ID</label><input id="di" class="input" bind:value={f.dev_imei} /></div>
      </div>
      {#each CLASSES[cls].files as slot}
        <div class="rounded-md border border-dashed border-ink-200 p-4">
          <label class="label" for={`slot-${slot.slot}`}>{slot.label}{slot.required ? ' *' : ''}</label>
          <input id={`slot-${slot.slot}`} data-slot={slot.slot} type="file" accept={slot.accept} multiple={slot.multiple} onchange={(e) => pick(slot.slot, e)} class="text-sm" />
          {#if (files[slot.slot] || []).length}
            <ul class="mt-3 space-y-1 text-sm">
              {#each files[slot.slot] as it, i}
                <li class="flex flex-wrap items-center gap-x-3"><span class="w-6 text-ink-400">{i + 1}.</span><span class="min-w-48">{it.file.name}</span>
                  <span class="text-xs text-ink-400">{(it.file.size / 1024).toFixed(1)} KB</span><Hash value={it.sha256} label="sha-256" /></li>
              {/each}
            </ul>
          {/if}
        </div>
      {/each}
      {#if hashing}<p class="text-sm text-ink-600">Computing SHA-256 in your browser…</p>{/if}
    </section>

    <section class="card space-y-3 p-5">
      <label class="label" for="reason">Reason recorded on the ledger</label>
      <input id="reason" class="input" bind:value={f.reason} placeholder={`Seized under ${f.legal_basis}`} />
      <Notice message={error} {details} />
      <div class="flex items-center gap-3">
        <button class="btn-accent" type="submit" disabled={busy || hashing} data-testid="register-submit">{busy ? 'Encrypting, storing and anchoring…' : `Register ${totalFiles} file(s) on the ledger`}</button>
        <span class="text-xs text-ink-400">The gateway re-hashes every file and refuses any that changed in transit.</span>
      </div>
    </section>
  </form>
{/if}
