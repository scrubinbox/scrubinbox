import { writable } from 'svelte/store';
import { progressVisible, errorMessage } from './progressStore.js';
import { resultsVisible, resultsData } from './resultsStore.js';

export const domainsVisible = writable(false);

// 'main' | 'purchase' — purchase is the paywall screen shown when a
// non-paying user tries to take a gated action (trash/delete).
export const view = writable('main');

export function showPurchase() {
  view.set('purchase');
}

export function showMain() {
  view.set('main');
}

export function showProgress() {
  progressVisible.set(true);
  domainsVisible.set(false);
  resultsVisible.set(false);
  errorMessage.set('');
}

export function hideProgress() {
  progressVisible.set(false);
}

export function showDomains() {
  domainsVisible.set(true);
  progressVisible.set(false);
  resultsVisible.set(false);
}

export function showResults(data) {
  resultsVisible.set(true);
  domainsVisible.set(false);
  progressVisible.set(false);
  resultsData.set(data);
}
