/**
 * Domain model classes
 *
 * Plain JS classes that define the shape of data flowing through the app.
 * No framework dependencies — these are used by gmail/ modules, stores, and components.
 */

// === Config Classes ===

/**
 * Configuration for DomainCollector.
 */
export class CollectorConfig {
  constructor({
    excludedDomains = new Set(),
    useLabelExclusion = true,
    excludedLabelIds = null,
    excludeStarred = true,
    excludeImportant = false,
    includeArchived = false,
  } = {}) {
    this.excludedDomains = excludedDomains;
    this.useLabelExclusion = useLabelExclusion;
    this.excludedLabelIds = excludedLabelIds;
    this.excludeStarred = excludeStarred;
    this.excludeImportant = excludeImportant;
    this.includeArchived = includeArchived;
  }
}

/**
 * Configuration for DomainCleaner.
 */
export class CleanerConfig {
  constructor({ permanentDelete = false, limit = null } = {}) {
    this.permanentDelete = permanentDelete;
    this.limit = limit;
  }
}

// === API Response Wrappers ===

/**
 * Wraps a projected thread from the Worker's /api/scan/page endpoint.
 *
 * Shape: {id, from, subject, labelIds, messageCount}. All header parsing,
 * label merging, and message-count extraction happens server-side; the
 * client just consumes the flat projection.
 */
export class Thread {
  constructor(threadId, projected) {
    this.threadId = threadId;
    this._from = projected.from ?? '';
    this._subject = projected.subject ?? '';
    this._labelIds = projected.labelIds ?? [];
    this._messageCount = projected.messageCount ?? 0;
  }

  /** @returns {boolean} True if the thread has no messages */
  isEmpty() {
    return this._messageCount === 0;
  }

  /** @returns {string} Raw From header value, e.g. "John <john@example.com>" */
  getSender() {
    return this._from || '(Unknown Sender)';
  }

  /** @returns {string} Subject header value */
  getSubject() {
    return this._subject || '(No Subject)';
  }

  /** @returns {string} Parsed and lowercased email address from From header */
  getSenderEmail() {
    return Thread.extractEmailAddress(this.getSender());
  }

  /** @returns {string} Domain extracted from sender email */
  getDomain() {
    return Thread.extractDomain(this.getSenderEmail());
  }

  /** @returns {number} Number of messages in the thread */
  getMessageCount() {
    return this._messageCount;
  }

  /** @returns {string[]} Merged and deduped label IDs (already flattened server-side) */
  getLabelIds() {
    return this._labelIds;
  }

  /** Serialised form for persistScan.js round-tripping through sessionStorage. */
  toProjected() {
    return {
      from: this._from,
      subject: this._subject,
      labelIds: this._labelIds,
      messageCount: this._messageCount,
    };
  }

  // === Static Utilities ===

  /**
   * Extract email address from a From header value.
   * "John Doe <john@example.com>" → "john@example.com"
   * "john@example.com" → "john@example.com"
   */
  static extractEmailAddress(sender) {
    const match = sender.match(/<([^>]+)>/);
    if (match) return match[1].toLowerCase();
    return sender.trim().toLowerCase();
  }

  /**
   * Extract domain from an email address.
   * "john@example.com" → "example.com"
   */
  static extractDomain(email) {
    if (email.includes('@')) {
      return email.split('@')[1].toLowerCase();
    }
    return '';
  }
}

// === Cleanup Pipeline Models ===

/**
 * A thread prepared for the cleanup pipeline.
 * Uses snake_case to match what DomainCleaner destructures.
 */
export class CleanupThread {
  constructor({ thread_id, domain, subject, sender, message_count }) {
    this.thread_id = thread_id;
    this.domain = domain;
    this.subject = subject;
    this.sender = sender;
    this.message_count = message_count;
  }

  /**
   * Create a CleanupThread from a Thread instance.
   */
  static fromThread(thread) {
    return new CleanupThread({
      thread_id: thread.threadId,
      domain: thread.getDomain(),
      subject: thread.getSubject(),
      sender: thread.getSenderEmail(),
      message_count: thread.getMessageCount(),
    });
  }
}

/**
 * Per-domain result from collection: the domain name, thread count, and thread list.
 */
export class DomainResult {
  constructor({ domain, count, threads }) {
    this.domain = domain;
    this.count = count;
    /** @type {CleanupThread[]} */
    this.threads = threads;
  }
}

/**
 * Stats returned by DomainCleaner after a cleanup run.
 */
export class CleanupStats {
  constructor({ threads_processed, threads_deleted, threads_failed_to_delete }) {
    this.threads_processed = threads_processed;
    this.threads_deleted = threads_deleted;
    this.threads_failed_to_delete = threads_failed_to_delete;
  }
}

/**
 * Wraps the full output of a DomainCollector.collect() run.
 *
 * Holds domain results plus the internal thread maps, so that ActionButtons
 * (or any consumer) can derive cleanup threads without reaching into the
 * collector instance.
 */
export class CollectionResult {
  /**
   * @param {Object<string, DomainResult>} domainResults  - domain -> DomainResult
   * @param {Object<string, Thread>} threadsById           - threadId -> Thread
   * @param {Object<string, string[]>} threadsByDomain     - domain -> [threadId, ...]
   */
  constructor(domainResults, threadsById, threadsByDomain) {
    this.domainResults = domainResults;
    this.threadsById = threadsById;
    this.threadsByDomain = threadsByDomain;
  }

  /**
   * Returns a plain object sorted by thread count descending, suitable for
   * the domains store: { domain: { count, threads } }
   */
  getSortedDomainMap() {
    const entries = Object.entries(this.domainResults)
      .sort(([, a], [, b]) => b.count - a.count)
      .map(([domain, info]) => [domain, { count: info.count, threads: info.threads }]);

    return Object.fromEntries(entries);
  }

  /**
   * Build an array of CleanupThread objects for the given set of thread IDs.
   *
   * @param {Set<string>} selectedThreadIds
   * @returns {CleanupThread[]}
   */
  getCleanupThreads(selectedThreadIds) {
    const threads = [];
    for (const threadId of selectedThreadIds) {
      const thread = this.threadsById[threadId];
      if (thread) {
        threads.push(CleanupThread.fromThread(thread));
      }
    }
    return threads;
  }

  /**
   * Serialise the result to a plain object suitable for JSON.stringify.
   * Thread instances become {threadId, projected} so fromJSON can rebuild
   * them — class methods obviously don't survive JSON.
   */
  toJSON() {
    const threadsById = {};
    for (const [id, thread] of Object.entries(this.threadsById)) {
      threadsById[id] = { threadId: thread.threadId, projected: thread.toProjected() };
    }
    return {
      domainResults: this.domainResults,
      threadsById,
      threadsByDomain: this.threadsByDomain,
    };
  }

  /**
   * Reconstruct a CollectionResult from data produced by toJSON().
   */
  static fromJSON(data) {
    const threadsById = {};
    for (const [id, obj] of Object.entries(data.threadsById)) {
      threadsById[id] = new Thread(obj.threadId, obj.projected);
    }
    const domainResults = {};
    for (const [domain, obj] of Object.entries(data.domainResults)) {
      domainResults[domain] = new DomainResult({
        domain: obj.domain,
        count: obj.count,
        threads: obj.threads.map((t) => new CleanupThread(t)),
      });
    }
    return new CollectionResult(domainResults, threadsById, data.threadsByDomain);
  }
}
