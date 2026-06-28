<script>
  import { showMain } from '../stores/uiStore.js';
  import { isPaid } from '../stores/authStore.js';

  // Phase 5 will wire this to LemonSqueezy hosted checkout with the
  // signed-in user's id passed in custom_data so the webhook can link
  // the order back to the user.
  const PURCHASE_AVAILABLE = false;
</script>

<div class="bg-white rounded-xl shadow-sm border border-sage-200 p-6 sm:p-10">
  <button
    on:click={showMain}
    class="text-xs font-medium text-sage-500 hover:text-sage-700 mb-6 inline-flex items-center gap-1"
  >
    <svg class="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 19l-7-7 7-7"/></svg>
    Back
  </button>

  <div class="max-w-md mx-auto text-center">
    <div class="inline-flex items-center justify-center w-12 h-12 rounded-full bg-sage-100 mb-4">
      <svg class="w-5 h-5 text-sage-600" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7"/></svg>
    </div>

    <h1 class="text-xl font-bold text-sage-800 mb-1">ScrubInbox Lifetime</h1>
    <p class="text-sm text-sage-500 mb-6">Early-adopter pricing — one-time purchase, lifetime access.</p>

    <div class="rounded-xl border border-sage-200 p-6 mb-6 bg-sage-50">
      <div class="text-3xl font-bold text-sage-800">$4.99</div>
      <div class="text-xs text-sage-400 mt-1">one-time · lifetime · no renewal</div>
    </div>

    <ul class="text-left text-sm text-sage-600 space-y-2 mb-6">
      <li class="flex items-start gap-2">
        <svg class="w-4 h-4 mt-0.5 text-sage-500 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7"/></svg>
        Unlimited scans + trash / permanent delete
      </li>
      <li class="flex items-start gap-2">
        <svg class="w-4 h-4 mt-0.5 text-sage-500 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7"/></svg>
        Email content stays in your browser — never sent to our servers
      </li>
      <li class="flex items-start gap-2">
        <svg class="w-4 h-4 mt-0.5 text-sage-500 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7"/></svg>
        14-day no-questions-asked refund
      </li>
    </ul>

    <button
      disabled={!PURCHASE_AVAILABLE}
      class="w-full bg-sage-600 hover:bg-sage-700 text-white font-semibold py-2.5 px-6 rounded-lg disabled:bg-sage-200 disabled:cursor-not-allowed transition-colors text-sm"
    >
      {PURCHASE_AVAILABLE ? 'Purchase' : 'Checkout coming soon (Phase 5)'}
    </button>

    {#if !PURCHASE_AVAILABLE}
      <p class="text-[11px] text-sage-400 mt-4">
        Local dev: insert a row into <code class="bg-sage-100 px-1 rounded">entitlements</code>
        via SQL to unlock paid actions (see <code class="bg-sage-100 px-1 rounded">apps/api/README.md</code>).
      </p>
    {/if}

    {#if $isPaid}
      <p class="text-xs text-emerald-600 mt-4">
        You're already paid — refresh and try again.
      </p>
    {/if}
  </div>
</div>
