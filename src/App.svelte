<script>
  import Header from './lib/components/Header.svelte';
  import AuthSection from './lib/components/AuthSection.svelte';
  import FilterOptions from './lib/components/FilterOptions.svelte';
  import ScanControls from './lib/components/ScanControls.svelte';
  import ProgressSection from './lib/components/ProgressSection.svelte';
  import DomainSection from './lib/components/DomainSection.svelte';
  import ResultsSection from './lib/components/ResultsSection.svelte';
  import PurchaseView from './lib/components/PurchaseView.svelte';
  import { view } from './lib/stores/uiStore.js';
</script>

<div class="min-h-screen bg-sage-50 flex flex-col">
  <Header />
  <div class="container mx-auto px-4 py-6 max-w-4xl flex-1">
    {#if $view === 'purchase'}
      <PurchaseView />
    {:else}
      <div class="space-y-4">
        <AuthSection />
        <FilterOptions />
        <ScanControls />
        <ProgressSection />
        <DomainSection />
        <ResultsSection />
      </div>
    {/if}
  </div>
  <footer class="border-t border-sage-200 py-4 px-4">
    <div class="container mx-auto max-w-4xl flex flex-col sm:flex-row justify-between items-center gap-2 text-xs text-sage-400">
      <span>&copy; 2026 ScrubInbox</span>
      <div class="flex flex-wrap justify-center gap-4">
        <a href="https://scrubinbox.com/privacy.html" class="hover:text-sage-600 transition-colors">Privacy Policy</a>
        <a href="https://github.com/scrubinbox/scrubinbox/issues/new?labels=bug&template=bug_report.md" class="hover:text-sage-600 transition-colors">Report a Bug</a>
        <a href="https://github.com/scrubinbox/scrubinbox/issues/new?labels=enhancement&template=feature_request.md" class="hover:text-sage-600 transition-colors">Feature Request</a>
      </div>
    </div>
  </footer>
</div>
