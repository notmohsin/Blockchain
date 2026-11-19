<script>
  import { api } from '../lib/api.js';
  import Notice from '../components/Notice.svelte';
  let { onLogin } = $props();
  let username = $state('');
  let password = $state('');
  let error = $state('');
  let busy = $state(false);
  const demo = [
    ['io.sharma', 'Investigating Officer · Police'], ['malkhana.desai', 'Malkhana In-charge · Police'],
    ['examiner.mehta', 'Examiner · FSL'], ['clerk.rao', 'Property Clerk · Court'],
  ];
  async function submit(e) {
    e.preventDefault(); busy = true; error = '';
    try { onLogin(await api.login(username.trim(), password)); } catch (err) { error = err.message; } finally { busy = false; }
  }
</script>

<div class="mx-auto mt-10 grid max-w-4xl gap-8 md:grid-cols-2">
  <div>
    <div class="mb-6 flex items-center gap-3">
      <span class="grid h-10 w-10 place-items-center rounded bg-seal-500 text-lg font-bold text-white">CC</span>
      <div>
        <h1 class="text-2xl font-semibold tracking-tight">CustodyChain</h1>
        <p class="text-sm text-ink-600">Chain of custody for evidence on a multi-agency ledger</p>
      </div>
    </div>
    <form class="card space-y-4 p-6" onsubmit={submit}>
      <div><label class="label" for="u">Username</label><input id="u" class="input" bind:value={username} autocomplete="username" required /></div>
      <div><label class="label" for="p">Password</label><input id="p" type="password" class="input" bind:value={password} autocomplete="current-password" required /></div>
      <Notice message={error} />
      <button class="btn-primary w-full" disabled={busy} type="submit">{busy ? 'Signing in…' : 'Sign in'}</button>
    </form>
  </div>
  <div class="card self-start p-6 text-sm">
    <h2 class="section-title mb-3">Prototype accounts</h2>
    <p class="mb-3 text-ink-600">Each account has its own certificate issued by its agency's CA, with its role inside the certificate. Demo password: <code class="hash">custody-demo</code></p>
    <ul class="divide-y divide-ink-100">
      {#each demo as [u, r]}
        <li class="flex items-center justify-between py-2">
          <span><code class="font-mono text-ink-800">{u}</code><span class="ml-2 text-ink-400">{r}</span></span>
          <button class="text-xs font-medium text-seal-600 hover:underline" type="button" onclick={() => { username = u; password = 'custody-demo'; }}>use</button>
        </li>
      {/each}
    </ul>
  </div>
</div>
