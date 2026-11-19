<script>
  import { onMount } from "svelte";

  const API_BASE = "http://localhost:3000";

  let id = "";
  let who = "";
  let what = "";
  let when = "";
  let where = "";
  let why = "";
  let how = "";

  let transferId = "";
  let newOwner = "";

  let assets = [];
  let currentView = "vault"; // 'vault' | 'create' | 'transfer'
  let searchQuery = "";
  let loading = false;
  let statusMessage = null; // { type: 'success' | 'error', text: '' }

  // History modal state
  let selectedAssetHistory = null;
  let selectedAssetId = "";
  let historyLoading = false;

  // File hashing helper
  let hashingFile = false;
  let computedHash = "";
  let fileName = "";

  onMount(async () => {
    await fetchAssets();
  });

  function showNotification(text, type = "success") {
    statusMessage = { text, type };
    setTimeout(() => {
      if (statusMessage && statusMessage.text === text) {
        statusMessage = null;
      }
    }, 5000);
  }

  async function fetchAssets() {
    loading = true;
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 6000);
      const res = await fetch(`${API_BASE}/assets`, { signal: controller.signal });
      clearTimeout(timeoutId);
      if (!res.ok) throw new Error("Could not fetch assets from ledger");
      assets = await res.json();
    } catch (err) {
      console.error("Ledger fetch error:", err);
      showNotification("Failed to fetch assets from Fabric Gateway: " + err.message, "error");
    } finally {
      loading = false;
    }
  }

  async function createAsset() {
    loading = true;
    try {
      const payload = {
        id: id.trim(),
        who: who.trim(),
        what: what.trim(),
        when: when.trim() || new Date().toISOString(),
        where: where.trim(),
        why: why.trim(),
        how: how.trim(),
      };

      const res = await fetch(`${API_BASE}/asset`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to commit asset");

      showNotification(`Evidence ${payload.id} successfully anchored to blockchain!`, "success");
      // Reset form
      id = "";
      who = "";
      what = "";
      when = "";
      where = "";
      why = "";
      how = "";
      computedHash = "";
      fileName = "";

      currentView = "vault";
      await fetchAssets();
    } catch (err) {
      console.error(err);
      showNotification(err.message, "error");
    } finally {
      loading = false;
    }
  }

  async function transferAsset() {
    if (!transferId || !newOwner) {
      showNotification("Please specify both Evidence ID and the New Custodian.", "error");
      return;
    }
    loading = true;
    try {
      const res = await fetch(`${API_BASE}/transferAsset`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: transferId.trim(), newOwner: newOwner.trim() }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Transfer failed");

      showNotification(`Custody of ${transferId} transferred to ${newOwner}!`, "success");
      transferId = "";
      newOwner = "";
      currentView = "vault";
      await fetchAssets();
    } catch (err) {
      console.error(err);
      showNotification(err.message, "error");
    } finally {
      loading = false;
    }
  }

  async function inspectHistory(assetId) {
    selectedAssetId = assetId;
    selectedAssetHistory = null;
    historyLoading = true;
    try {
      const res = await fetch(`${API_BASE}/asset/${encodeURIComponent(assetId)}/history`);
      if (!res.ok) throw new Error("Failed to load history from ledger");
      selectedAssetHistory = await res.json();
    } catch (err) {
      console.error(err);
      showNotification(`Failed to load history: ${err.message}`, "error");
    } finally {
      historyLoading = false;
    }
  }

  function closeHistory() {
    selectedAssetHistory = null;
    selectedAssetId = "";
  }

  // Client-side SHA-256 evidence hashing helper
  async function handleFileUpload(e) {
    const file = e.target.files[0];
    if (!file) return;
    hashingFile = true;
    fileName = file.name;
    try {
      const arrayBuffer = await file.arrayBuffer();
      const hashBuffer = await crypto.subtle.digest("SHA-256", arrayBuffer);
      const hashArray = Array.from(new Uint8Array(hashBuffer));
      const hashHex = hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
      computedHash = hashHex;
      what = `File: ${file.name} (SHA-256: ${hashHex}, ${file.size} bytes)`;
    } catch (err) {
      showNotification("Hashing failed: " + err.message, "error");
    } finally {
      hashingFile = false;
    }
  }

  function autofillSample() {
    const randomSuffix = Math.floor(1000 + Math.random() * 9000);
    id = `CASE-2026-EVID-${randomSuffix}`;
    who = "Insp. R. Sharma (Cyber Cell)";
    what = `Extracted Disk Image (SHA-256: e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855)`;
    when = new Date().toISOString();
    where = "State Forensic Science Laboratory (SFSL)";
    why = "Court Seizure under Sec 63 BNSS (Digital Evidence Authentication)";
    how = "Tamper-evident anti-static bag with physical seal #SFSL-984";
  }

  $: filteredAssets = assets.filter((item) => {
    if (!searchQuery) return true;
    const q = searchQuery.toLowerCase();
    return (
      (item.ID && item.ID.toLowerCase().includes(q)) ||
      (item.Who && item.Who.toLowerCase().includes(q)) ||
      (item.What && item.What.toLowerCase().includes(q)) ||
      (item.Where && item.Where.toLowerCase().includes(q))
    );
  });

  $: uniqueCustodians = new Set(assets.map((a) => a.Who)).size;
</script>

<div class="min-h-screen bg-slate-950 text-slate-100 flex flex-col font-sans">
  <!-- Top Navigation Bar -->
  <header class="border-b border-slate-800 bg-slate-900/80 backdrop-blur sticky top-0 z-30 px-6 py-4">
    <div class="max-w-7xl mx-auto flex flex-wrap items-center justify-between gap-4">
      <div class="flex items-center gap-3">
        <div class="w-10 h-10 rounded-xl bg-gradient-to-tr from-cyan-500 to-blue-600 flex items-center justify-center text-xl shadow-lg shadow-cyan-500/20">
          ⛓️
        </div>
        <div>
          <h1 class="text-xl font-bold tracking-tight text-white flex items-center gap-2">
            CustodyChain
            <span class="text-xs px-2 py-0.5 rounded-full bg-cyan-950 text-cyan-400 border border-cyan-800 font-mono font-medium">v1.0-fabric</span>
          </h1>
          <p class="text-xs text-slate-400">Digital Forensic Chain of Custody Ledger · Hyperledger Fabric</p>
        </div>
      </div>

      <!-- Network Status Pill -->
      <div class="flex items-center gap-4 text-xs">
        <div class="flex items-center gap-2 px-3 py-1.5 rounded-full bg-emerald-950/70 border border-emerald-800 text-emerald-300">
          <span class="w-2 h-2 rounded-full bg-emerald-400 animate-pulse"></span>
          <span>Raft Consensus · Org1 + Org2</span>
        </div>
        <button
          on:click={fetchAssets}
          class="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 transition"
          title="Refresh Ledger"
        >
          <svg class="w-3.5 h-3.5 {loading ? 'animate-spin' : ''}" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
          </svg>
          Sync
        </button>
      </div>
    </div>
  </header>

  <!-- Notification Banner -->
  {#if statusMessage}
    <div
      class="max-w-7xl mx-auto w-full px-6 pt-4 transition-all"
    >
      <div class="px-4 py-3 rounded-xl flex items-center justify-between text-sm shadow-lg {statusMessage.type === 'error' ? 'bg-rose-950/80 border border-rose-800 text-rose-200' : 'bg-emerald-950/80 border border-emerald-800 text-emerald-200'}">
        <div class="flex items-center gap-2">
          <span>{statusMessage.type === 'error' ? '⚠️' : '✅'}</span>
          <span>{statusMessage.text}</span>
        </div>
        <button on:click={() => (statusMessage = null)} class="text-xs opacity-70 hover:opacity-100">✕</button>
      </div>
    </div>
  {/if}

  <!-- Main Content Area -->
  <main class="max-w-7xl mx-auto w-full px-6 py-6 flex-1 flex flex-col gap-6">
    <!-- Metrics Row -->
    <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
      <div class="p-4 rounded-xl bg-slate-900/60 border border-slate-800 flex flex-col gap-1 shadow-sm">
        <span class="text-xs uppercase tracking-wider text-slate-400 font-medium">Evidence Registered</span>
        <div class="flex items-baseline gap-2">
          <span class="text-3xl font-extrabold text-white">{assets.length}</span>
          <span class="text-xs text-slate-400">items anchored</span>
        </div>
      </div>

      <div class="p-4 rounded-xl bg-slate-900/60 border border-slate-800 flex flex-col gap-1 shadow-sm">
        <span class="text-xs uppercase tracking-wider text-slate-400 font-medium">Active Custodians</span>
        <div class="flex items-baseline gap-2">
          <span class="text-3xl font-extrabold text-cyan-400">{uniqueCustodians}</span>
          <span class="text-xs text-slate-400">verified officers/labs</span>
        </div>
      </div>

      <div class="p-4 rounded-xl bg-slate-900/60 border border-slate-800 flex flex-col gap-1 shadow-sm">
        <span class="text-xs uppercase tracking-wider text-slate-400 font-medium">Blockchain Channel</span>
        <div class="flex items-baseline gap-2">
          <span class="text-lg font-bold font-mono text-emerald-400">mychannel</span>
        </div>
        <span class="text-xs text-slate-500">Fabric Multi-Org Ledger</span>
      </div>

      <div class="p-4 rounded-xl bg-slate-900/60 border border-slate-800 flex flex-col gap-1 shadow-sm">
        <span class="text-xs uppercase tracking-wider text-slate-400 font-medium">Endorsement Policy</span>
        <div class="flex items-baseline gap-2">
          <span class="text-sm font-semibold text-violet-300">MAJORITY (Org1 & Org2)</span>
        </div>
        <span class="text-xs text-slate-500">Deterministic Byzantine Tolerant</span>
      </div>
    </div>

    <!-- View Selector Tabs -->
    <div class="flex items-center gap-2 border-b border-slate-800 pb-2">
      <button
        on:click={() => (currentView = "vault")}
        class="px-4 py-2 rounded-lg text-sm font-medium transition flex items-center gap-2 {currentView === 'vault' ? 'bg-cyan-500/10 text-cyan-400 border border-cyan-500/30' : 'text-slate-400 hover:text-white hover:bg-slate-900'}"
      >
        <span>📂</span> Evidence Vault
      </button>

      <button
        on:click={() => (currentView = "create")}
        class="px-4 py-2 rounded-lg text-sm font-medium transition flex items-center gap-2 {currentView === 'create' ? 'bg-cyan-500/10 text-cyan-400 border border-cyan-500/30' : 'text-slate-400 hover:text-white hover:bg-slate-900'}"
      >
        <span>➕</span> Register New Evidence
      </button>

      <button
        on:click={() => (currentView = "transfer")}
        class="px-4 py-2 rounded-lg text-sm font-medium transition flex items-center gap-2 {currentView === 'transfer' ? 'bg-cyan-500/10 text-cyan-400 border border-cyan-500/30' : 'text-slate-400 hover:text-white hover:bg-slate-900'}"
      >
        <span>🔄</span> Transfer Custody
      </button>
    </div>

    <!-- View 1: Evidence Vault Table -->
    {#if currentView === "vault"}
      <div class="flex flex-col gap-4">
        <div class="flex flex-wrap items-center justify-between gap-3">
          <div class="relative flex-1 max-w-md">
            <input
              type="text"
              placeholder="Search by ID, Custodian, Description, Location..."
              bind:value={searchQuery}
              class="w-full bg-slate-900 border border-slate-800 rounded-xl px-4 py-2.5 text-sm text-slate-100 placeholder-slate-500 focus:outline-none focus:border-cyan-500"
            />
          </div>
          <span class="text-xs text-slate-400 font-mono">Showing {filteredAssets.length} of {assets.length} items</span>
        </div>

        {#if loading && assets.length === 0}
          <div class="text-center py-16 text-slate-500">Querying Hyperledger Fabric peer nodes...</div>
        {:else if filteredAssets.length === 0}
          <div class="text-center py-16 border border-dashed border-slate-800 rounded-2xl p-8 flex flex-col items-center gap-3">
            <span class="text-3xl">📦</span>
            <p class="text-slate-400 text-sm">No evidence assets registered yet.</p>
            <button
              on:click={() => { currentView = 'create'; autofillSample(); }}
              class="text-xs px-3 py-1.5 rounded-lg bg-cyan-600 hover:bg-cyan-500 text-white font-medium"
            >
              Autofill Sample Evidence to Test
            </button>
          </div>
        {:else}
          <div class="overflow-x-auto rounded-2xl border border-slate-800 bg-slate-900/50 shadow-lg">
            <table class="w-full text-left text-sm">
              <thead class="bg-slate-900/90 text-xs text-slate-400 uppercase font-mono border-b border-slate-800">
                <tr>
                  <th class="py-3 px-4">Evidence ID</th>
                  <th class="py-3 px-4">Current Custodian (Who)</th>
                  <th class="py-3 px-4">Evidence / Payload (What)</th>
                  <th class="py-3 px-4">Location (Where)</th>
                  <th class="py-3 px-4">Last Handover (When)</th>
                  <th class="py-3 px-4 text-center">Actions</th>
                </tr>
              </thead>
              <tbody class="divide-y divide-slate-800/60">
                {#each filteredAssets as item}
                  <tr class="hover:bg-slate-800/40 transition-colors">
                    <td class="py-3 px-4 font-mono font-bold text-cyan-300 whitespace-nowrap">
                      {item.ID}
                    </td>
                    <td class="py-3 px-4">
                      <span class="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-slate-800 border border-slate-700 text-xs font-medium text-slate-200">
                        👤 {item.Who}
                      </span>
                    </td>
                    <td class="py-3 px-4 max-w-xs truncate" title={item.What}>
                      {item.What}
                    </td>
                    <td class="py-3 px-4 text-xs text-slate-400 whitespace-nowrap">
                      📍 {item.Where}
                    </td>
                    <td class="py-3 px-4 text-xs text-slate-400 font-mono whitespace-nowrap">
                      {item.When ? new Date(item.When).toLocaleString() : 'N/A'}
                    </td>
                    <td class="py-3 px-4 text-center whitespace-nowrap">
                      <button
                        on:click={() => inspectHistory(item.ID)}
                        class="px-2.5 py-1 rounded-lg bg-cyan-950 hover:bg-cyan-900 text-cyan-300 border border-cyan-800 text-xs font-medium transition"
                      >
                        📜 Audit History
                      </button>
                      <button
                        on:click={() => { transferId = item.ID; currentView = 'transfer'; }}
                        class="ml-1 px-2.5 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700 text-xs font-medium transition"
                      >
                        🔄 Transfer
                      </button>
                    </td>
                  </tr>
                {/each}
              </tbody>
            </table>
          </div>
        {/if}
      </div>

    <!-- View 2: Register New Evidence Form -->
    {:else if currentView === "create"}
      <div class="max-w-2xl mx-auto w-full bg-slate-900/60 border border-slate-800 rounded-2xl p-6 shadow-xl flex flex-col gap-6">
        <div class="flex items-center justify-between border-b border-slate-800 pb-4">
          <div>
            <h2 class="text-lg font-bold text-white">Register Digital Forensic Evidence</h2>
            <p class="text-xs text-slate-400">Anchors evidence identity and custody state to the blockchain</p>
          </div>
          <button
            type="button"
            on:click={autofillSample}
            class="text-xs px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-cyan-300 border border-slate-700 transition"
          >
            🪄 Autofill Sample Form
          </button>
        </div>

        <form on:submit|preventDefault={createAsset} class="flex flex-col gap-4">
          <div>
            <label for="input-id" class="block text-xs font-medium text-slate-300 mb-1">Evidence ID / Case Tag *</label>
            <input
              id="input-id"
              type="text"
              placeholder="e.g. CASE-2026-EVID-001"
              bind:value={id}
              required
              class="w-full bg-slate-950 border border-slate-800 rounded-xl px-4 py-2 text-sm text-slate-100 focus:outline-none focus:border-cyan-500 font-mono"
            />
          </div>

          <!-- File Hash Calculator helper -->
          <div class="p-4 rounded-xl bg-slate-950/80 border border-slate-800/80 flex flex-col gap-2">
            <div class="flex items-center justify-between">
              <span class="text-xs font-semibold text-slate-300">🔐 Cryptographic File Hasher (SHA-256)</span>
              {#if hashingFile}
                <span class="text-xs text-cyan-400 animate-pulse">Calculating hash...</span>
              {/if}
            </div>
            <p class="text-xs text-slate-400">
              Select or drop any digital evidence file (disk image, video, audio) to calculate its tamper-proof hash:
            </p>
            <input
              type="file"
              on:change={handleFileUpload}
              class="text-xs text-slate-400 file:mr-3 file:py-1.5 file:px-3 file:rounded-lg file:border-0 file:text-xs file:font-semibold file:bg-cyan-900 file:text-cyan-200 hover:file:bg-cyan-800"
            />
            {#if computedHash}
              <div class="mt-1 text-xs font-mono text-emerald-400 bg-emerald-950/30 p-2 rounded border border-emerald-900 break-all">
                SHA-256: {computedHash}
              </div>
            {/if}
          </div>

          <div>
            <label for="input-what" class="block text-xs font-medium text-slate-300 mb-1">Evidence Description & Hash (What) *</label>
            <textarea
              id="input-what"
              placeholder="Description, file names, SHA-256 checksums..."
              bind:value={what}
              required
              rows="2"
              class="w-full bg-slate-950 border border-slate-800 rounded-xl px-4 py-2 text-sm text-slate-100 focus:outline-none focus:border-cyan-500 font-mono text-xs"
            ></textarea>
          </div>

          <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label for="input-who" class="block text-xs font-medium text-slate-300 mb-1">Seizing Officer / Initial Custodian (Who) *</label>
              <input
                id="input-who"
                type="text"
                placeholder="e.g. Insp. Sharma (Badge #482)"
                bind:value={who}
                required
                class="w-full bg-slate-950 border border-slate-800 rounded-xl px-4 py-2 text-sm text-slate-100 focus:outline-none focus:border-cyan-500"
              />
            </div>

            <div>
              <label for="input-where" class="block text-xs font-medium text-slate-300 mb-1">Seizure Location (Where) *</label>
              <input
                id="input-where"
                type="text"
                placeholder="e.g. Crime Scene Alpha / Cyber Cell"
                bind:value={where}
                required
                class="w-full bg-slate-950 border border-slate-800 rounded-xl px-4 py-2 text-sm text-slate-100 focus:outline-none focus:border-cyan-500"
              />
            </div>
          </div>

          <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label for="input-why" class="block text-xs font-medium text-slate-300 mb-1">Legal Purpose / Authority (Why) *</label>
              <input
                id="input-why"
                type="text"
                placeholder="e.g. Court Warrant #921 / Sec 63 BNSS"
                bind:value={why}
                required
                class="w-full bg-slate-950 border border-slate-800 rounded-xl px-4 py-2 text-sm text-slate-100 focus:outline-none focus:border-cyan-500"
              />
            </div>

            <div>
              <label for="input-how" class="block text-xs font-medium text-slate-300 mb-1">Packaging & Security (How) *</label>
              <input
                id="input-how"
                type="text"
                placeholder="e.g. Faraday pouch seal #8819"
                bind:value={how}
                required
                class="w-full bg-slate-950 border border-slate-800 rounded-xl px-4 py-2 text-sm text-slate-100 focus:outline-none focus:border-cyan-500"
              />
            </div>
          </div>

          <div class="flex items-center justify-end gap-3 pt-4 border-t border-slate-800">
            <button
              type="button"
              on:click={() => (currentView = "vault")}
              class="px-4 py-2 rounded-xl text-sm font-medium text-slate-400 hover:text-white transition"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={loading}
              class="px-6 py-2.5 rounded-xl bg-gradient-to-r from-cyan-600 to-blue-600 hover:from-cyan-500 hover:to-blue-500 text-white font-medium shadow-lg shadow-cyan-600/20 disabled:opacity-50 transition"
            >
              {loading ? "Anchoring to Blockchain..." : "Commit Evidence to Ledger"}
            </button>
          </div>
        </form>
      </div>

    <!-- View 3: Transfer Custody Form -->
    {:else if currentView === "transfer"}
      <div class="max-w-lg mx-auto w-full bg-slate-900/60 border border-slate-800 rounded-2xl p-6 shadow-xl flex flex-col gap-6">
        <div class="border-b border-slate-800 pb-4">
          <h2 class="text-lg font-bold text-white">Transfer Custody of Evidence</h2>
          <p class="text-xs text-slate-400">Records an immutable handoff between authorized investigators</p>
        </div>

        <form on:submit|preventDefault={transferAsset} class="flex flex-col gap-4">
          <div>
            <label for="select-transfer-id" class="block text-xs font-medium text-slate-300 mb-1">Select Evidence ID *</label>
            <input
              id="select-transfer-id"
              type="text"
              placeholder="e.g. EVID-001 or CASE-2026-EVID-..."
              bind:value={transferId}
              required
              class="w-full bg-slate-950 border border-slate-800 rounded-xl px-4 py-2.5 text-sm text-slate-100 focus:outline-none focus:border-cyan-500 font-mono"
            />
          </div>

          <div>
            <label for="input-new-owner" class="block text-xs font-medium text-slate-300 mb-1">New Custodian (Name & Department / Role) *</label>
            <input
              id="input-new-owner"
              type="text"
              placeholder="e.g. Dr. A. Patel (Chief Cyber Forensic Examiner)"
              bind:value={newOwner}
              required
              class="w-full bg-slate-950 border border-slate-800 rounded-xl px-4 py-2.5 text-sm text-slate-100 focus:outline-none focus:border-cyan-500"
            />
          </div>

          <div class="p-3 rounded-xl bg-slate-950 text-xs text-slate-400 flex items-start gap-2 border border-slate-800">
            <span>ℹ️</span>
            <span>
              This will submit a <code>TransferAsset</code> transaction endorsed by both Org1 and Org2 peers. A deterministic timestamp and the transaction ID will be permanently recorded in the block log.
            </span>
          </div>

          <div class="flex items-center justify-end gap-3 pt-4 border-t border-slate-800">
            <button
              type="button"
              on:click={() => (currentView = "vault")}
              class="px-4 py-2 rounded-xl text-sm font-medium text-slate-400 hover:text-white transition"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={loading}
              class="px-6 py-2.5 rounded-xl bg-gradient-to-r from-cyan-600 to-blue-600 hover:from-cyan-500 hover:to-blue-500 text-white font-medium shadow-lg shadow-cyan-600/20 disabled:opacity-50 transition"
            >
              {loading ? "Endorsing Transfer..." : "Execute Handover"}
            </button>
          </div>
        </form>
      </div>
    {/if}
  </main>

  <!-- Chain of Custody History Modal -->
  {#if selectedAssetId}
    <div class="fixed inset-0 bg-black/75 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div class="bg-slate-900 border border-slate-800 rounded-2xl max-w-2xl w-full max-h-[85vh] flex flex-col shadow-2xl overflow-hidden">
        <!-- Modal Header -->
        <div class="px-6 py-4 border-b border-slate-800 flex items-center justify-between bg-slate-900/90">
          <div>
            <h3 class="text-base font-bold text-white flex items-center gap-2">
              📜 Chain of Custody Provenance Log
            </h3>
            <span class="text-xs font-mono text-cyan-400">Asset: {selectedAssetId}</span>
          </div>
          <button
            on:click={closeHistory}
            class="text-slate-400 hover:text-white text-lg font-bold p-1 rounded-lg hover:bg-slate-800"
          >
            ✕
          </button>
        </div>

        <!-- Modal Body (Timeline) -->
        <div class="p-6 overflow-y-auto flex-1 flex flex-col gap-4">
          {#if historyLoading}
            <div class="text-center py-10 text-slate-400 animate-pulse">Traversing blockchain block log...</div>
          {:else if selectedAssetHistory && selectedAssetHistory.length > 0}
            <div class="relative border-l-2 border-cyan-500/40 ml-4 pl-6 flex flex-col gap-6">
              {#each selectedAssetHistory as entry, idx}
                <div class="relative group">
                  <!-- Timeline Node Dot -->
                  <div class="absolute -left-[31px] top-1 w-4 h-4 rounded-full bg-slate-900 border-2 border-cyan-400 shadow-sm shadow-cyan-500"></div>

                  <div class="p-4 rounded-xl bg-slate-950/70 border border-slate-800/80 flex flex-col gap-2">
                    <div class="flex flex-wrap items-center justify-between gap-2">
                      <span class="text-xs px-2 py-0.5 rounded font-mono font-medium {idx === selectedAssetHistory.length - 1 ? 'bg-emerald-950 text-emerald-400 border border-emerald-800' : 'bg-slate-800 text-slate-300'}">
                        {idx === selectedAssetHistory.length - 1 ? '🌟 Genesis Seizure' : `🔄 Transfer #${selectedAssetHistory.length - 1 - idx}`}
                      </span>
                      <span class="text-xs text-slate-400 font-mono">
                        {entry.timestamp ? new Date(entry.timestamp).toLocaleString() : 'N/A'}
                      </span>
                    </div>

                    <div class="text-sm font-semibold text-white flex items-center gap-2">
                      <span>Custodian:</span>
                      <span class="text-cyan-300">{entry.value ? entry.value.Who : 'Unknown'}</span>
                    </div>

                    {#if entry.value}
                      <p class="text-xs text-slate-300 line-clamp-2">
                        {entry.value.What}
                      </p>
                      <div class="flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-400">
                        <span>📍 {entry.value.Where}</span>
                        <span>⚖️ {entry.value.Why}</span>
                      </div>
                    {/if}

                    <div class="mt-2 pt-2 border-t border-slate-800/60 flex items-center justify-between text-[11px] font-mono text-slate-500">
                      <span class="truncate max-w-[260px]" title={entry.txId}>Tx: {entry.txId}</span>
                      <span class="text-emerald-500 font-sans font-semibold">✓ Block Committed</span>
                    </div>
                  </div>
                </div>
              {/each}
            </div>
          {:else}
            <div class="text-center py-8 text-slate-400">No historical transactions found for this asset.</div>
          {/if}
        </div>

        <!-- Modal Footer -->
        <div class="px-6 py-3 border-t border-slate-800 bg-slate-950 flex justify-end">
          <button
            on:click={closeHistory}
            class="px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-medium transition"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  {/if}
</div>
