<script>
  import { onMount, onDestroy } from 'svelte';
  import { isAuthenticated, userEmail, isPaid, entitlementLoaded } from '../stores/authStore.js';
  import { supabase } from '../supabase/client.js';
  import { getMe } from '../supabase/api.js';
  import { initGoogleLibraries, attachSessionToGapi, signIn, signOut } from '../gmail/auth.js';
  import { getErrorMessage } from '../errors.js';

  let authReady = false;
  let authBtnDisabled = false;
  let authBtnText = 'Sign in with Google';
  let authError = '';
  let subscription = null;

  async function refreshEntitlement() {
    try {
      const me = await getMe();
      $isPaid = !!me.paid;
    } catch (err) {
      $isPaid = false;
      authError = `Couldn't load entitlement: ${getErrorMessage(err)}`;
    } finally {
      $entitlementLoaded = true;
    }
  }

  async function syncFromSession(session) {
    if (!session) {
      $isAuthenticated = false;
      $userEmail = '';
      $isPaid = false;
      $entitlementLoaded = false;
      return;
    }
    const attached = await attachSessionToGapi();
    $isAuthenticated = attached;
    $userEmail = session.user?.email ?? '';
    if (attached) {
      await refreshEntitlement();
    }
  }

  onMount(async () => {
    try {
      await initGoogleLibraries();
      authReady = true;

      // Pick up an existing session (e.g. user revisits or just completed the
      // OAuth redirect — detectSessionInUrl already exchanged the ?code=).
      const { data } = await supabase.auth.getSession();
      await syncFromSession(data.session);

      // React to subsequent auth events (sign-out from another tab, token
      // refresh that rotates provider_token, etc.).
      const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
        syncFromSession(session);
      });
      subscription = sub.subscription;
    } catch (error) {
      authError = `Failed to load Google libraries: ${getErrorMessage(error)}`;
    }
  });

  onDestroy(() => {
    subscription?.unsubscribe();
  });

  async function handleSignIn() {
    if (authBtnDisabled) return;
    authBtnDisabled = true;
    authBtnText = 'Redirecting…';
    authError = '';
    try {
      await signIn();
      // The page navigates away; nothing to do post-call.
    } catch (error) {
      authError = `Authentication failed: ${getErrorMessage(error)}`;
      authBtnDisabled = false;
      authBtnText = 'Sign in with Google';
    }
  }

  async function handleSignOut() {
    try {
      await signOut();
      // onAuthStateChange clears the stores.
    } catch (error) {
      authError = `Sign out error: ${getErrorMessage(error)}`;
    }
  }
</script>

<div class="bg-white rounded-xl shadow-sm p-6 border border-sage-200">
  {#if $isAuthenticated}
    <div class="flex items-center justify-between">
      <div class="flex items-center gap-3">
        <div class="w-9 h-9 rounded-full bg-sage-100 flex items-center justify-center">
          <svg class="w-4 h-4 text-sage-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7"/></svg>
        </div>
        <div>
          <div class="text-sm font-semibold text-sage-700">Connected to Gmail</div>
          {#if $userEmail}
            <div class="text-xs text-sage-400">{$userEmail}</div>
          {/if}
        </div>
      </div>
      <button
        on:click={handleSignOut}
        class="px-3 py-1.5 text-xs font-medium text-sage-500 hover:text-sage-700 border border-sage-200 hover:border-sage-300 rounded-lg transition-colors"
      >
        Sign Out
      </button>
    </div>
  {:else}
    <div class="text-center">
      <div class="mb-4">
        <div class="inline-flex items-center justify-center w-12 h-12 rounded-full bg-sage-100 mb-3">
          <svg class="w-5 h-5 text-sage-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z"/></svg>
        </div>
        <h2 class="text-lg font-bold text-sage-800 mb-1">Connect your Gmail</h2>
        <p class="text-sm text-sage-400 max-w-sm mx-auto">
          Sign in to scan your inbox. Your email content stays in your browser and is never sent to any server.
        </p>
      </div>

      <button
        on:click={handleSignIn}
        disabled={!authReady || authBtnDisabled}
        class="w-full max-w-xs mx-auto bg-sage-600 hover:bg-sage-700 text-white font-semibold py-2.5 px-6 rounded-lg disabled:bg-sage-200 disabled:cursor-not-allowed transition-colors text-sm"
      >
        {#if !authReady}
          Loading...
        {:else}
          {authBtnText}
        {/if}
      </button>

      <div class="mt-4 flex items-center justify-center gap-4 text-sm sm:text-xs text-sage-300">
        <span class="flex items-center gap-1.5">
          <svg class="w-4 h-4 sm:w-3 sm:h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z"/></svg>
          Private &amp; secure
        </span>
        <span class="flex items-center gap-1.5">
          <svg class="w-4 h-4 sm:w-3 sm:h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10 20l4-16m4 4l4 4-4 4M6 16l-4-4 4-4"/></svg>
          Open source
        </span>
      </div>
    </div>
  {/if}

  {#if authError}
    <div class="mt-3 text-xs text-red-500 bg-red-50 border border-red-100 rounded-lg px-3 py-2">
      {authError}
    </div>
  {/if}
</div>
