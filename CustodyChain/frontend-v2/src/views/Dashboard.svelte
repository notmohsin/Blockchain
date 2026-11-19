<script>
  import { api } from '../lib/api.js';
  import StatusChip from '../components/StatusChip.svelte';
  import Notice from '../components/Notice.svelte';
  import { CLASS_LABEL, ORG_SHORT } from '../lib/labels.js';
  import { human } from '../lib/time.js';
  let { user } = $props();

  let tab = $state('mine');
  let items = $state([]);
  let inbox = $state([]);
  let error = $state('');
  let loading = $state(true);
  let units = $state([]);
  let fir = $state('');
  let ps = $state('');

  async function load() {
    loading = true; error = '';
    try {
      inbox = await api.inbox();
      if (tab === 'inbox') items = inbox;
      else if (tab === 'case') items = fir && ps ? await api.list('case', { fir, ps }) : [];
      else items = await api.list(tab === 'mine' ? 'mine' : 'org');
    } catch (e) { error = e.message; } finally { loading = false; }
  }
  $effect(() => { tab; load(); });
  $effect(() => { api.meta().then((m) => { units = m.units; ps = ps || m.units[0]; }).catch(() => {}); });
  const tabs = [['mine', 'In my custody'], ['inbox', 'Incoming transfers'], ['org', 'My agency'], ['case', 'Search by case']];
</script>

<div class="mb-5 flex flex-wrap items-end justify-between gap-3">
  <div>
    <h1 class="text-xl font-semibold">Evidence</h1>
    <p class="text-sm text-ink-600">{user.name}, {user.role_label}, {user.org_name}</p>
  </div>
  {#if user.role === 'io'}<a href="#/register" class="btn-accent">+ Register evidence</a>{/if}
</div>

<div class="mb-4 flex flex-wrap gap-1 border-b border-ink-100">
  {#each tabs as [k, l]}
    <button class="-mb-px border-b-2 px-4 py-2 text-sm font-medium {tab === k ? 'border-seal-500 text-ink-900' : 'border-transparent text-ink-600 hover:text-ink-900'}" onclick={() => (tab = k)} data-tab={k}>
      {l}{#if k === 'inbox' && inbox.length}<span class="ml-1.5 rounded-full bg-seal-500 px-1.5 text-xs text-white" data-testid="inbox-count">{inbox.length}</span>{/if}
    </button>
  {/each}
</div>

{#if tab === 'case'}
  <form class="mb-4 flex flex-wrap items-end gap-3" onsubmit={(e) => { e.preventDefault(); load(); }}>
    <div><label class="label" for="fir">FIR number</label><input id="fir" class="input w-40" bind:value={fir} placeholder="123/2026" /></div>
    <div class="min-w-72"><label class="label" for="ps">Police station</label>
      <select id="ps" class="input" bind:value={ps}>{#each units as u}<option>{u}</option>{/each}</select></div>
    <button class="btn-primary" type="submit">Search</button>
  </form>
{/if}

<Notice message={error} />
{#if loading}
  <p class="py-8 text-center text-sm text-ink-400">Loading from the ledger…</p>
{:else if items.length === 0}
  <p class="card py-10 text-center text-sm text-ink-400">{tab === 'inbox' ? 'No transfers are waiting for you.' : 'No evidence here.'}</p>
{:else}
  <div class="card divide-y divide-ink-100" data-testid="evidence-list">
    {#each items as e (e.evidence_id)}
      <a href="#/evidence/{encodeURIComponent(e.evidence_id)}" class="flex flex-wrap items-center gap-x-4 gap-y-1 px-4 py-3 hover:bg-ink-50" data-evidence-id={e.evidence_id}>
        <div class="min-w-0 flex-1">
          <div class="truncate font-medium">{e.title}</div>
          <div class="font-mono text-xs text-ink-600">{e.evidence_id}</div>
        </div>
        <div class="text-xs text-ink-600">{CLASS_LABEL[e.evidence_class]}</div>
        <div class="text-xs text-ink-600">FIR {e.case.fir_number}</div>
        <div class="w-48 text-xs text-ink-600">
          {#if e.pending_transfer}
            → <b>{e.pending_transfer.to_user}</b> ({ORG_SHORT[e.pending_transfer.to_msp]})
          {:else}
            {e.custodian.cn} ({ORG_SHORT[e.custodian.msp]})<br /><span class="text-ink-400">since {human(e.custodian.since)}</span>
          {/if}
        </div>
        <StatusChip status={e.status} />
      </a>
    {/each}
  </div>
{/if}
