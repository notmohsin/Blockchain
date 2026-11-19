<script>
  import { session, setSession, api } from './lib/api.js';
  import Login from './views/Login.svelte';
  import Dashboard from './views/Dashboard.svelte';
  import Register from './views/Register.svelte';
  import Evidence from './views/Evidence.svelte';
  import Verify from './views/Verify.svelte';

  let route = $state(location.hash || '#/');
  let user = $state(session()?.user || null);
  $effect(() => {
    const on = () => (route = location.hash || '#/');
    window.addEventListener('hashchange', on);
    return () => window.removeEventListener('hashchange', on);
  });
  const parts = $derived(route.replace(/^#\/?/, '').split('/'));
  // Signed-out users always see the login form; a signed-in user visiting #/login lands on the dashboard.
  const view = $derived(!user ? 'login' : !parts[0] || parts[0] === 'login' ? 'dashboard' : parts[0]);

  function onLogin(s) { setSession(s); user = s.user; location.hash = '#/'; }
  async function logout() { try { await api.logout(); } catch { /* ignore */ } setSession(null); user = null; location.hash = '#/login'; }
</script>

<div class="min-h-screen">
  {#if user}
    <header class="border-b border-ink-800 bg-ink-900 text-white">
      <div class="mx-auto flex max-w-6xl items-center gap-6 px-4 py-3">
        <a href="#/" class="flex items-center gap-2 font-semibold tracking-tight">
          <span class="grid h-7 w-7 place-items-center rounded bg-seal-500 text-sm font-bold">CC</span>
          CustodyChain
        </a>
        <nav class="flex gap-1 text-sm">
          <a href="#/" class="rounded px-3 py-1.5 hover:bg-ink-800 {view === 'dashboard' ? 'bg-ink-800' : ''}">Evidence</a>
          {#if user.role === 'io'}<a href="#/register" class="rounded px-3 py-1.5 hover:bg-ink-800 {view === 'register' ? 'bg-ink-800' : ''}">Register evidence</a>{/if}
          <a href="#/verify" class="rounded px-3 py-1.5 hover:bg-ink-800 {view === 'verify' ? 'bg-ink-800' : ''}">Verify a file</a>
        </nav>
        <div class="ml-auto flex items-center gap-3 text-sm">
          <div class="text-right leading-tight">
            <div class="font-medium" data-testid="whoami">{user.name}</div>
            <div class="text-xs text-ink-200">{user.role_label} · {user.org_name}</div>
          </div>
          <button class="rounded border border-ink-600 px-2.5 py-1 text-xs hover:bg-ink-800" onclick={logout}>Sign out</button>
        </div>
      </div>
    </header>
  {/if}

  <main class="mx-auto max-w-6xl px-4 py-6">
    {#if view === 'login'}
      <Login {onLogin} />
    {:else if view === 'register'}
      <Register {user} />
    {:else if view === 'evidence' && parts[1]}
      {#key parts[1]}<Evidence id={decodeURIComponent(parts[1])} {user} />{/key}
    {:else if view === 'verify'}
      <Verify initialId={parts[1] ? decodeURIComponent(parts[1]) : ''} />
    {:else}
      <Dashboard {user} />
    {/if}
  </main>
  <footer class="mx-auto max-w-6xl px-4 pb-8 text-xs text-ink-400">
    Prototype. Every action is signed with your own certificate on a 4-agency BFT ledger. Evidence files are stored encrypted off-chain; only their fingerprints are on the ledger.
  </footer>
</div>
