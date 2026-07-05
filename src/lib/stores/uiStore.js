import { writable } from 'svelte/store';
import { progressVisible, errorMessage } from './progressStore.js';
import { resultsVisible, resultsData } from './resultsStore.js';

export const domainsVisible = writable(false);

// 'main' | 'purchase' | 'welcome'
//   purchase — paywall screen shown when a non-paying user tries a gated action
//   welcome  — post-Stripe-checkout landing (URL: /welcome?session_id=…)
export const view = writable('main');

export function showPurchase() {
  view.set('purchase');
  if (window.location.pathname !== '/') {
    history.pushState({}, '', '/');
  }
}

export function showMain() {
  view.set('main');
  if (window.location.pathname !== '/') {
    history.pushState({}, '', '/');
  }
}

export function showWelcome() {
  view.set('welcome');
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
