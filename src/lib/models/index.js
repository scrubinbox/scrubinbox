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
 * Wraps a raw Gmail threads.list API response.
 * Constructed in collector.js from raw JSON returned by api.listThreads().
 */
export class ThreadsList {
  constructor(raw) {
    this._raw = raw;
  }

  get threadIds() {
    return (this._raw.threads || []).map(t => t.id);
  }

  get nextPageToken() {
    return this._raw.nextPageToken || null;
  }
}

/**
 * Wraps a raw Gmail threads.get API response.
 * Constructed in collector.js from raw JSON returned by api.getThread().
 *
 * Replaces ThreadMetadata — this is now the single model for thread data.
 * Encapsulates all header parsing, email extraction, and label merging.
 */
export class Thread {
  constructor(threadId, raw) {
    this.threadId = threadId;
    this._raw = raw;
  }

  /** @returns {boolean} True if the thread has no messages */
  isEmpty() {
    const messages = this._raw.messages || [];
    return messages.length === 0;
  }

  /** @returns {string} Raw From header value, e.g. "John <john@example.com>" */
  getSender() {
    return this._getHeader('From') || '(Unknown Sender)';
  }

  /** @returns {string} Subject header value */
  getSubject() {
    return this._getHeader('Subject') || '(No Subject)';
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
    return (this._raw.messages || []).length;
  }

  /**
   * @returns {string[]} Merged and deduped label IDs from thread level and first message level
   */
  getLabelIds() {
    const threadLabelIds = this._raw.labelIds || [];
    const messages = this._raw.messages || [];
    const firstMessageLabelIds = messages.length > 0 ? (messages[0].labelIds || []) : [];
    return [...new Set([...threadLabelIds, ...firstMessageLabelIds])];
  }

  // === Private Helpers ===

  _getHeader(name) {
    const messages = this._raw.messages || [];
    if (messages.length === 0) return null;
    const headers = messages[0].payload?.headers || [];
    const header = headers.find(h => h.name === name);
    return header ? header.value : null;
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
   * Thread instances become {threadId, _raw} so fromJSON can rebuild them —
   * class methods obviously don't survive JSON.
   */
  toJSON() {
    const threadsById = {};
    for (const [id, thread] of Object.entries(this.threadsById)) {
      threadsById[id] = { threadId: thread.threadId, raw: thread._raw };
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
      threadsById[id] = new Thread(obj.threadId, obj.raw);
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
