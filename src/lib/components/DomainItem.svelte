<script>
  import { selectedThreadIds, expandedDomains } from '../stores/cleanupStore.js';

  export let domain;
  export let info;

  let isExpanded = false;
  let threadIds = [];
  let selectedInDomain = 0;
  let isFullySelected = false;
  let isIndeterminate = false;
  let isAnySelected = false;

  $: threadIds = (info.threads || []).map(t => t.thread_id);
  $: isExpanded = $expandedDomains.has(domain);
  $: {
    selectedInDomain = 0;
    for (const id of threadIds) {
      if ($selectedThreadIds.has(id)) selectedInDomain++;
    }
    isFullySelected = threadIds.length > 0 && selectedInDomain === threadIds.length;
    isIndeterminate = selectedInDomain > 0 && selectedInDomain < threadIds.length;
    isAnySelected = selectedInDomain > 0;
  }

  function toggleDomain() {
    selectedThreadIds.update(set => {
      const newSet = new Set(set);
      if (isFullySelected) {
        for (const id of threadIds) newSet.delete(id);
      } else {
        for (const id of threadIds) newSet.add(id);
      }
      return newSet;
    });
  }

  function toggleThread(threadId) {
    selectedThreadIds.update(set => {
      const newSet = new Set(set);
      if (newSet.has(threadId)) {
        newSet.delete(threadId);
      } else {
        newSet.add(threadId);
      }
      return newSet;
    });
  }

  function toggleExpand() {
    expandedDomains.update(set => {
      const newSet = new Set(set);
      if (newSet.has(domain)) {
        newSet.delete(domain);
      } else {
        newSet.add(domain);
      }
      return newSet;
    });
  }
</script>

<div class="transition-colors" class:bg-sage-50={isAnySelected} class:hover:bg-sage-50={!isAnySelected}>
  <div class="px-3 sm:px-5 py-2.5">
    <div class="flex items-center gap-2 sm:gap-3">
      <div class="w-5 flex-shrink-0">
        <input
          type="checkbox"
          class="h-5 w-5 text-sage-600 border-sage-300 rounded cursor-pointer focus:ring-2 focus:ring-sage-300"
          checked={isFullySelected}
          indeterminate={isIndeterminate}
          on:change={toggleDomain}
        >
      </div>

      <div class="flex-1 min-w-0">
        <div class="text-sm font-medium text-sage-800 truncate">{domain}</div>
      </div>

      <div class="w-14 sm:w-16 flex-shrink-0 text-right">
        <span class="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-sage-100 text-sage-600">
          {#if isAnySelected && selectedInDomain < info.count}{selectedInDomain}/{info.count}{:else}{info.count}{/if}
        </span>
      </div>

      <div class="w-7 flex-shrink-0 flex justify-center">
        <button
          on:click={toggleExpand}
          class="text-sage-300 hover:text-sage-500 transition-colors p-2 rounded hover:bg-sage-100"
          class:text-sage-500={isExpanded}
          aria-label="Toggle threads"
        >
          <svg class="w-4 h-4 transform transition-transform duration-200" class:rotate-180={isExpanded} fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7"></path>
          </svg>
        </button>
      </div>
    </div>

    {#if isExpanded}
      <div class="mt-2 ml-4 sm:ml-8 pl-3 border-l-2 border-sage-200 animate-slideDown">
        <div class="text-[11px] sm:text-xs font-semibold text-sage-400 uppercase tracking-wider mb-1.5">
          Threads ({info.threads?.length || 0})
        </div>
        {#if !info.threads || info.threads.length === 0}
          <div class="text-xs text-sage-300 italic">No threads available</div>
        {:else}
          <div class="space-y-1 max-h-60 overflow-y-auto">
            {#each info.threads as thread (thread.thread_id)}
              {@const threadSelected = $selectedThreadIds.has(thread.thread_id)}
              <label
                class="flex items-start gap-2 text-xs rounded-md p-2 border cursor-pointer transition-colors"
                class:bg-white={threadSelected}
                class:border-sage-300={threadSelected}
                class:bg-sage-50={!threadSelected}
                class:border-sage-100={!threadSelected}
              >
                <input
                  type="checkbox"
                  class="mt-0.5 h-4 w-4 text-sage-600 border-sage-300 rounded cursor-pointer focus:ring-2 focus:ring-sage-300 flex-shrink-0"
                  checked={threadSelected}
                  on:change={() => toggleThread(thread.thread_id)}
                />
                <div class="flex-1 min-w-0">
                  <div class="font-medium text-sage-700 break-words" title={thread.subject}>
                    {thread.subject}
                  </div>
                  <div class="text-sage-400 mt-0.5">
                    {thread.sender} ({thread.message_count} {thread.message_count === 1 ? 'msg' : 'msgs'})
                  </div>
                </div>
              </label>
            {/each}
          </div>
        {/if}
      </div>
    {/if}
  </div>
</div>

<style>
  @keyframes slideDown {
    from {
      opacity: 0;
      max-height: 0;
    }
    to {
      opacity: 1;
      max-height: 500px;
    }
  }

  .animate-slideDown {
    animation: slideDown 0.2s ease-out;
  }
</style>
