<script>
  let { value = '', short = 16, label = '' } = $props();
  let copied = $state(false);
  async function copy() {
    try { await navigator.clipboard.writeText(value); copied = true; setTimeout(() => (copied = false), 1200); } catch { /* clipboard unavailable */ }
  }
</script>

<span class="inline-flex items-center gap-1.5" title={value}>
  {#if label}<span class="text-[11px] uppercase tracking-wide text-ink-400">{label}</span>{/if}
  <code class="hash" data-hash={value}>{short && value.length > short ? `${value.slice(0, short)}…` : value}</code>
  {#if value}
    <button type="button" class="text-[11px] text-ink-400 hover:text-ink-700" onclick={copy} aria-label="Copy hash">{copied ? 'copied' : 'copy'}</button>
  {/if}
</span>
