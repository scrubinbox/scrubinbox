/**
 * Domain Collector - Handles domain collection from Gmail inbox
 */

import { getInboxInfo, getProfile, getLabelInfo, listThreads, getThread } from './api.js';
import { ThreadsList, Thread, CleanupThread, DomainResult, CollectionResult } from '../models/index.js';
import {
  THREAD_PAGE_SIZE,
  API_CONCURRENCY,
} from '../constants.js';
import { getErrorMessage } from '../errors.js';
import { asyncPool } from '../asyncPool.js';

export class DomainCollector {
  constructor(config, progressCallback = null) {
    this.config = config;
    this.progressCallback = progressCallback;

    // Results - exposed for cleanup to access
    this.threadsById = {};      // threadId -> Thread
    this.threadsByDomain = {};  // domain -> [threadId, ...]
    this.interrupted = false;

    // Pollable progress state — UI reads this via setInterval
    this.progress = {
      scanned: 0,
      scanTotal: 0,
      collected: 0,
      uniqueDomains: 0,
      status: 'idle', // 'idle' | 'running' | 'completed' | 'error'
      errorMessage: null,
    };
  }

  // === Main Entry Point ===

  async collect() {
    const scanTotal = await this._getTotalThreadCount();

    await this._reportProgress('collection_started', {
      message: 'Starting domain collection...',
    });

    // Clear any previous state
    this.threadsById = {};
    this.threadsByDomain = {};

    // Initialize pollable progress
    this.progress.status = 'running';
    this.progress.scanTotal = scanTotal;
    this.progress.scanned = 0;
    this.progress.collected = 0;
    this.progress.uniqueDomains = 0;
    this.progress.errorMessage = null;

    const domainCounts = {}; // domain -> count
    let pageToken = null;
    let collected = 0;
    let scanned = 0;

    while (!this.interrupted) {
      try {
        const page = await this._fetchThreadPage(pageToken);

        if (page.threadIds.length === 0) {
          break;
        }

        // Fetch + process threads concurrently. Doing the sync bookkeeping
        // (increment scanned, filter, store, count domains) INSIDE the pool
        // callback means each network I/O naturally spaces the progress
        // writes over the duration of the fetch. A prior version awaited
        // the whole pool then ran a synchronous for-loop — that burst
        // finished before the 100ms progress poller could fire, so users
        // saw "Scanned 0 threads" until the results view appeared.
        await asyncPool(page.threadIds, API_CONCURRENCY, async (id) => {
          if (this.interrupted) return;

          const thread = await this._getThread(id);

          scanned += 1;
          this.progress.scanned = scanned;

          if (thread === null) return;
          if (!this._shouldInclude(thread)) return;

          this._storeThread(thread);

          const domain = thread.getDomain();
          domainCounts[domain] = (domainCounts[domain] || 0) + 1;

          collected += 1;
          this.progress.collected = collected;
          this.progress.uniqueDomains = Object.keys(domainCounts).length;
        });

        pageToken = page.nextPageToken;
        if (!pageToken) break;
      } catch (error) {
        this.progress.status = 'error';
        this.progress.errorMessage = getErrorMessage(error);
        await this._reportProgress('error', {
          message: `Error fetching threads: ${getErrorMessage(error)}`,
        });
        break;
      }
    }

    // Build results
    const result = this._buildResults(domainCounts);

    this.progress.status = 'completed';

    await this._reportProgress('collection_completed', {
      collected,
      unique_domains: Object.keys(result.domainResults).length,
      message: `Collection complete: ${collected.toLocaleString()} threads collected, ${Object.keys(result.domainResults).length.toLocaleString()} unique domains`,
    });

    return result;
  }

  // === Thread Fetching ===

  async _getTotalThreadCount() {
    try {
      if (this.config.includeArchived) {
        const [profile, trashInfo, spamInfo] = await Promise.all([
          getProfile(),
          getLabelInfo('TRASH'),
          getLabelInfo('SPAM'),
        ]);
        const total = profile.threadsTotal || 0;
        const trash = trashInfo.threadsTotal || 0;
        const spam = spamInfo.threadsTotal || 0;
        return Math.max(total - trash - spam, 0);
      }
      const inboxInfo = await getInboxInfo();
      return inboxInfo.threadsTotal || 0;
    } catch (e) {
      console.warn('Could not get thread count:', e);
      return 0;
    }
  }

  _buildQuery() {
    return this.config.includeArchived ? '-in:trash -in:spam' : 'in:inbox';
  }

  // it seems gmail api query isn't reliable so we 
  // have to resort to "client-side" filtering for now
  async _fetchThreadPage(pageToken) {
    const raw = await listThreads({
      maxResults: THREAD_PAGE_SIZE,
      pageToken,
      q: this._buildQuery(),
    });

    return new ThreadsList(raw);
  }

  async _getThread(threadId) {
    const raw = await getThread(threadId, {
      format: 'metadata',
      metadataHeaders: ['From', 'Subject'],
    });

    const thread = new Thread(threadId, raw);
    if (thread.isEmpty() || !thread.getDomain()) return null;

    return thread;
  }

  // === Filtering ===

  _isExcludedByLabel(labelIds) {
    if (this.config.excludeStarred && labelIds.includes('STARRED')) {
      return true;
    }
    if (this.config.excludeImportant && labelIds.includes('IMPORTANT')) {
      return true;
    }

    // Skip label exclusion if disabled
    if (!this.config.useLabelExclusion) {
      return false;
    }

    // Check for custom user labels
    const customLabels = labelIds.filter((l) => l.startsWith('Label_'));
    if (customLabels.length === 0) return false;

    // If specific labels provided, only exclude those
    if (this.config.excludedLabelIds !== null) {
      return customLabels.some((l) => this.config.excludedLabelIds.has(l));
    }

    // Otherwise exclude any custom-labeled thread (default behavior)
    return true;
  }

  _isExcludedByDomain(domain) {
    return this.config.excludedDomains.has(domain);
  }

  _shouldInclude(thread) {
    if (this._isExcludedByLabel(thread.getLabelIds())) return false;
    if (this._isExcludedByDomain(thread.getDomain())) return false;
    return true;
  }

  // === Storage ===

  _storeThread(thread) {
    const domain = thread.getDomain();
    this.threadsById[thread.threadId] = thread;
    if (!this.threadsByDomain[domain]) {
      this.threadsByDomain[domain] = [];
    }
    this.threadsByDomain[domain].push(thread.threadId);
  }

  // === Results ===

  _buildResults(domainCounts) {
    const domainResults = {};

    for (const [domain, count] of Object.entries(domainCounts)) {
      const threadIds = this.threadsByDomain[domain] || [];
      const threads = threadIds
        .map((id) => this.threadsById[id])
        .filter(Boolean)
        .map((thread) => CleanupThread.fromThread(thread));

      domainResults[domain] = new DomainResult({ domain, count, threads });
    }

    return new CollectionResult(domainResults, this.threadsById, this.threadsByDomain);
  }

  // === Progress ===

  async _reportProgress(event, data) {
    if (this.progressCallback) {
      await this.progressCallback(event, data);
    }
  }

}
