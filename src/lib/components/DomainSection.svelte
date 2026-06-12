<script>
  import { domains, collectionResult } from '../stores/collectionStore.js';
  import { isCleaning, hasSelection, selectedThreadIds, selectedCount } from '../stores/cleanupStore.js';
  import { errorMessage } from '../stores/progressStore.js';
  import { domainsVisible, showProgress } from '../stores/uiStore.js';
  import { CleanerConfig } from '../models/index.js';
  import { DomainCleaner } from '../gmail/cleaner.js';
  import { createProgressHandler } from '../gmail/progressHandler.js';
  import { startProgressPolling, stopProgressPolling } from '../gmail/progressPoller.js';
  import { getErrorMessage } from '../errors.js';
  import DomainItem from './DomainItem.svelte';

  let searchQuery = '';
  let filteredDomains = [];
  let permanentDelete = false;

  function updateFilteredDomains() {
    if (!searchQuery.trim()) {
      filteredDomains = Object.entries($domains);
    } else {
      const query = searchQuery.toLowerCase();

      filteredDomains = Object.entries($domains).filter(([domain, info]) => {
        if (domain.toLowerCase().includes(query)) {
          return true;
        }

        const threads = info.threads || [];
        return threads.some(thread =>
          thread.subject.toLowerCase().includes(query)
        );
      });
    }
  }

  $: {
    $domains;
    searchQuery;
    updateFilteredDomains();
  }

  function selectAll() {
    selectedThreadIds.update(set => {
      const newSet = new Set(set);
      filteredDomains.forEach(([, info]) => {
        (info.threads || []).forEach(thread => newSet.add(thread.thread_id));
      });
      return newSet;
    });
  }

  function deselectAll() {
    selectedThreadIds.update(set => {
      const newSet = new Set(set);
      filteredDomains.forEach(([, info]) => {
        (info.threads || []).forEach(thread => newSet.delete(thread.thread_id));
      });
      return newSet;
    });
  }

  async function executeCleanup() {
    if ($isCleaning) return;

    const action = permanentDelete ? 'permanently delete' : 'trash';
    const warning = permanentDelete
      ? 'This CANNOT be undone. Threads will be permanently deleted.'
      : 'Threads will be moved to trash and can be recovered within 30 days.';
    if (!confirm(`Are you sure you want to ${action} the selected threads?\n\n${warning}`)) {
      return;
    }

    $isCleaning = true;
    showProgress();

    const threads = $collectionResult.getCleanupThreads($selectedThreadIds);

    const config = new CleanerConfig({ permanentDelete });
    const progressHandler = createProgressHandler();
    const cleaner = new DomainCleaner(config, progressHandler);
    startProgressPolling(cleaner, 'cleanup');

    try {
      await cleaner.cleanup(threads);
    } catch (error) {
      errorMessage.set(`Cleanup failed: ${getErrorMessage(error)}`);
    } finally {
      stopProgressPolling();
      $isCleaning = false;
    }
  }

  $: cleanupDisabled = !$hasSelection || $isCleaning;

  $: searchResultsText = searchQuery.trim()
    ? `${filteredDomains.length} of ${Object.keys($domains).length} sender domains`
    : `${Object.keys($domains).length} sender domains found`;
</script>

{#if $domainsVisible}
  <div class="bg-white rounded-xl shadow-sm border border-sage-200 overflow-hidden">
    <!-- Header -->
    <div class="px-5 pt-5 pb-4">
      <h3 class="text-sm font-semibold text-sage-700 mb-0.5">Review Sender Domains</h3>
      <p class="text-xs text-sage-400">Select sender domains to clean up. Starred, important, and excluded labeled emails are skipped.</p>
    </div>

    <!-- Controls -->
    <div class="px-5 pb-4 flex flex-col sm:flex-row gap-3 items-start sm:items-center justify-between">
      <div class="w-full sm:w-auto sm:flex-1 sm:max-w-sm">
        <div class="relative">
          <svg class="w-4 h-4 text-sage-300 absolute left-3 top-1/2 -translate-y-1/2" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"/></svg>
          <input
            bind:value={searchQuery}
            type="text"
            placeholder="Search sender domains and subjects..."
            class="w-full pl-9 pr-3 py-2 border border-sage-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-sage-300 focus:border-transparent text-sm text-sage-700 placeholder-sage-300"
          >
        </div>
        <div class="text-xs text-sage-300 mt-1">{searchResultsText}</div>
      </div>

      <div class="flex gap-2 flex-shrink-0">
        <button
          on:click={selectAll}
          class="text-xs font-medium text-sage-500 hover:text-sage-700 py-2 px-3 rounded-md hover:bg-sage-50 transition-colors"
        >
          Select All
        </button>
        <button
          on:click={deselectAll}
          class="text-xs font-medium text-sage-500 hover:text-sage-700 py-2 px-3 rounded-md hover:bg-sage-50 transition-colors"
        >
          Deselect All
        </button>
      </div>
    </div>

    <!-- Table Header -->
    <div class="bg-sage-50 border-y border-sage-100 px-3 sm:px-5 py-2.5">
      <div class="flex items-center gap-2 sm:gap-3">
        <div class="w-5 flex-shrink-0"></div>
        <div class="flex-1 text-[11px] sm:text-xs font-semibold text-sage-400 uppercase tracking-wider">Sender Domain</div>
        <div class="w-14 sm:w-16 flex-shrink-0 text-[11px] sm:text-xs font-semibold text-sage-400 uppercase tracking-wider text-right">Threads</div>
        <div class="w-7 flex-shrink-0"></div>
      </div>
    </div>

    <!-- Domain List -->
    <div class="max-h-[60vh] overflow-y-auto">
      {#if filteredDomains.length === 0}
        <div class="p-8 text-center text-sage-300 text-sm">
          {#if searchQuery.trim()}
            No sender domains match your search.
          {:else}
            No sender domains found.
          {/if}
        </div>
      {:else}
        {#each filteredDomains as [domain, info], index (domain)}
          <div class:border-t={index > 0} class="border-sage-100">
            <DomainItem {domain} {info} />
          </div>
        {/each}
      {/if}
    </div>

    <!-- Action Footer -->
    {#if $selectedCount > 0}
      <div class="px-3 sm:px-5 py-3 bg-sage-50 border-t border-sage-100">
        <div class="flex flex-col sm:flex-row sm:items-center gap-3">
          <div class="text-xs font-semibold text-sage-600">
            {$selectedCount} {$selectedCount === 1 ? 'thread' : 'threads'} selected
          </div>

          <div class="flex items-center gap-3 sm:ml-auto">
            <label class="flex items-center gap-1.5 text-xs font-medium cursor-pointer select-none"
              class:text-red-500={permanentDelete}
              class:text-sage-400={!permanentDelete}
            >
              <input
                type="checkbox"
                bind:checked={permanentDelete}
                class="rounded border-sage-300 text-red-500 focus:ring-red-300"
              />
              Permanent delete
            </label>

            <button
              on:click={executeCleanup}
              disabled={cleanupDisabled}
              class="bg-red-50 hover:bg-red-100 text-red-600 hover:text-red-700 font-medium py-2 px-4 rounded-lg disabled:bg-sage-50 disabled:text-sage-300 disabled:cursor-not-allowed transition-colors text-sm border border-red-200 disabled:border-sage-100"
            >
              {permanentDelete ? 'Permanently Delete' : 'Move to Trash'}
            </button>
          </div>
        </div>
      </div>
    {/if}
  </div>
{/if}
