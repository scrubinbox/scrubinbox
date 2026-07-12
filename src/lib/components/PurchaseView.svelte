<script>
  import { showMain } from '../stores/uiStore.js';
  import { isPaid } from '../stores/authStore.js';
  import { createCheckoutSession } from '../api.js';
  import { getErrorMessage } from '../errors.js';

  let redirecting = false;
  let error = '';

  async function handlePurchase() {
    if (redirecting) return;
    redirecting = true;
    error = '';
    try {
      const { url } = await createCheckoutSession();
      window.location.href = url;
    } catch (err) {
      error = `Couldn't start checkout: ${getErrorMessage(err)}`;
      redirecting = false;
    }
  }
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
      on:click={handlePurchase}
      disabled={redirecting || $isPaid}
      class="w-full bg-sage-600 hover:bg-sage-700 text-white font-semibold py-2.5 px-6 rounded-lg disabled:bg-sage-200 disabled:cursor-not-allowed transition-colors text-sm"
    >
      {#if redirecting}
        Redirecting to checkout…
      {:else if $isPaid}
        Already purchased
      {:else}
        Purchase
      {/if}
    </button>

    <p class="text-[11px] text-sage-400 mt-3 leading-relaxed">
      By purchasing, you agree to our
      <a href="https://scrubinbox.com/terms.html" class="underline hover:text-sage-600">Terms of Service</a>,
      <a href="https://scrubinbox.com/refund-policy.html" class="underline hover:text-sage-600">Refund Policy</a>, and
      <a href="https://scrubinbox.com/privacy.html" class="underline hover:text-sage-600">Privacy Policy</a>.
      Payments are processed by Stripe as Merchant of Record.
    </p>

    {#if error}
      <p class="text-xs text-red-500 mt-3 bg-red-50 border border-red-100 rounded-lg px-3 py-2">
        {error}
      </p>
    {/if}

    {#if $isPaid}
      <p class="text-xs text-emerald-600 mt-4">
        You're already paid — refresh and try again.
      </p>
    {/if}
  </div>
</div>
