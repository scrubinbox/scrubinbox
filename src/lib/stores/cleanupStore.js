import { writable, derived } from 'svelte/store';

export const isCleaning = writable(false);
export const selectedThreadIds = writable(new Set());
export const expandedDomains = writable(new Set());

export const hasSelection = derived(selectedThreadIds, $selectedThreadIds => $selectedThreadIds.size > 0);
export const selectedCount = derived(selectedThreadIds, $selectedThreadIds => $selectedThreadIds.size);
