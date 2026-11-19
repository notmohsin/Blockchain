<script>
  let { kind = 'error', message = '', details = [] } = $props();
</script>

{#if message}
  <div role="alert" class="rounded-md border px-4 py-3 text-sm {kind === 'error' ? 'border-bad-600/30 bg-bad-50 text-bad-700' : 'border-ok-600/30 bg-ok-50 text-ok-700'}">
    <p class="font-medium">{message}</p>
    {#if details && details.length}
      <ul class="mt-1 list-disc pl-5 text-xs">{#each details as d}<li>{d}</li>{/each}</ul>
    {/if}
  </div>
{/if}
