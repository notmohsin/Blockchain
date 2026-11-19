<script>
  import { STATUS_STYLE } from '../lib/labels.js';
  let { status } = $props();
</script>

<span class="inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold ring-1 ring-inset {STATUS_STYLE[status] || 'bg-ink-100 text-ink-700 ring-ink-200'}">
  {(status || '').replace('_', ' ').toLowerCase()}
</span>
