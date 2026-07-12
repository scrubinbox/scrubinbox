<script>
  import { onMount, onDestroy } from 'svelte';
  import { showMain } from '../stores/uiStore.js';
  import { isPaid, entitlementLoaded } from '../stores/authStore.js';
  import { getMe } from '../api.js';
  import { getErrorMessage } from '../errors.js';

  // Post-checkout landing. Stripe redirects the user here with
  // ?session_id={CHECKOUT_SESSION_ID}. The webhook usually lands
  // the entitlement row within a few seconds — we poll /api/me until
  // paid:true, then let the user continue.
  const POLL_INTERVAL_MS = 2000;
  const POLL_TIMEOUT_MS = 60000;

  let elapsed = 0;
  let error = '';
  let pollHandle = null;
  let startedAt = 0;

  function stopPolling() {
    if (pollHandle) {
      clearTimeout(pollHandle);
      pollHandle = null;
    }
  }

  async function poll() {
    try {
      const me = await getMe();
      $isPaid = !!me.paid;
      $entitlementLoaded = true;
      if (me.paid) {
        stopPolling();
        return;
      }
    } catch (err) {
      // Transient network / auth blips shouldn't kill the polling loop —
      // keep trying until timeout.
      error = getErrorMessage(err);
    }
    elapsed = Date.now() - startedAt;
    if (elapsed >= POLL_TIMEOUT_MS) {
      stopPolling();
      return;
    }
    pollHandle = setTimeout(poll, POLL_INTERVAL_MS);
  }

  onMount(() => {
    startedAt = Date.now();
    poll();
  });

  onDestroy(stopPolling);

  $: timedOut = elapsed >= POLL_TIMEOUT_MS && !$isPaid;
</script>

<div class="bg-white rounded-xl shadow-sm border border-sage-200 p-6 sm:p-10">
  <div class="max-w-md mx-auto text-center">
    {#if $isPaid}
      <div class="inline-flex items-center justify-center w-14 h-14 rounded-full bg-emerald-100 mb-4">
        <svg class="w-6 h-6 text-emerald-600" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7"/></svg>
      </div>
      <h1 class="text-xl font-bold text-sage-800 mb-1">Purchase confirmed</h1>
      <p class="text-sm text-sage-500 mb-6">
        Thanks for supporting ScrubInbox. Cleanup actions are unlocked.
      </p>
      <button
        on:click={showMain}
        class="w-full bg-sage-600 hover:bg-sage-700 text-white font-semibold py-2.5 px-6 rounded-lg transition-colors text-sm"
      >
        Continue to app
      </button>
    {:else if timedOut}
      <div class="inline-flex items-center justify-center w-14 h-14 rounded-full bg-amber-100 mb-4">
        <svg class="w-6 h-6 text-amber-600" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 8v4m0 4h.01M12 2a10 10 0 100 20 10 10 0 000-20z"/></svg>
      </div>
      <h1 class="text-xl font-bold text-sage-800 mb-1">Still processing</h1>
      <p class="text-sm text-sage-500 mb-6">
        Your payment succeeded, but the entitlement hasn't landed yet. Refresh in
        a minute — or reach out at
        <a href="mailto:support@scrubinbox.com" class="underline">support@scrubinbox.com</a>
        if it still hasn't shown up.
      </p>
      <button
        on:click={showMain}
        class="w-full border border-sage-300 text-sage-700 hover:bg-sage-50 font-semibold py-2.5 px-6 rounded-lg transition-colors text-sm"
      >
        Back to app
      </button>
    {:else}
      <div class="inline-flex items-center justify-center w-14 h-14 rounded-full bg-sage-100 mb-4">
        <svg class="w-6 h-6 text-sage-500 animate-spin" fill="none" viewBox="0 0 24 24">
          <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"/>
          <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z"/>
        </svg>
      </div>
      <h1 class="text-xl font-bold text-sage-800 mb-1">Confirming your purchase…</h1>
      <p class="text-sm text-sage-500 mb-2">
        Talking to Stripe. This usually takes a few seconds.
      </p>
      <p class="text-[11px] text-sage-400">
        {Math.floor(elapsed / 1000)}s elapsed
      </p>
    {/if}

    {#if error}
      <p class="text-xs text-red-500 mt-3 bg-red-50 border border-red-100 rounded-lg px-3 py-2">
        {error}
      </p>
    {/if}
  </div>
</div>
