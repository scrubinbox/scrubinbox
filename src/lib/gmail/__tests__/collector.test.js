/**
 * Tests for DomainCollector class
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { DomainCollector } from '../collector.js';
import { CollectorConfig, Thread } from '../../models/index.js';
import { sampleInbox, setupApiMocks } from './testUtils.js';

// Top-level mock with vi.fn() stubs — hoisted safely
vi.mock('../api.js', () => ({
  getInboxInfo: vi.fn(),
  fetchScanPage: vi.fn(),
  trashBatch: vi.fn(),
  listLabels: vi.fn(),
}));

import * as api from '../api.js';

// === Static Method Tests ===

describe('extractEmailAddress', () => {
  it('extracts email from Name <email> format', () => {
    const result = Thread.extractEmailAddress('John Doe <john@example.com>');
    expect(result).toBe('john@example.com');
  });

  it('handles plain email', () => {
    const result = Thread.extractEmailAddress('john@example.com');
    expect(result).toBe('john@example.com');
  });

  it('normalizes to lowercase', () => {
    const result = Thread.extractEmailAddress('John@EXAMPLE.COM');
    expect(result).toBe('john@example.com');
  });

  it('handles whitespace around email', () => {
    const result = Thread.extractEmailAddress('  john@example.com  ');
    expect(result).toBe('john@example.com');
  });

  it('handles complex display names', () => {
    const result = Thread.extractEmailAddress('"Doe, John" <john@example.com>');
    expect(result).toBe('john@example.com');
  });
});

describe('extractDomain', () => {
  it('extracts domain from simple email', () => {
    const result = Thread.extractDomain('john@example.com');
    expect(result).toBe('example.com');
  });

  it('extracts domain including subdomain', () => {
    const result = Thread.extractDomain('john@mail.example.com');
    expect(result).toBe('mail.example.com');
  });

  it('normalizes domain to lowercase', () => {
    const result = Thread.extractDomain('john@EXAMPLE.COM');
    expect(result).toBe('example.com');
  });

  it('returns empty string if no @ symbol', () => {
    const result = Thread.extractDomain('invalid');
    expect(result).toBe('');
  });

  it('handles empty string', () => {
    const result = Thread.extractDomain('');
    expect(result).toBe('');
  });
});

// === Label Exclusion Logic Tests ===

describe('isExcludedByLabel', () => {
  function makeCollector(configOverrides = {}) {
    return new DomainCollector(new CollectorConfig(configOverrides));
  }

  it('STARRED excluded by default', () => {
    const collector = makeCollector();
    expect(collector._isExcludedByLabel(['INBOX', 'STARRED'])).toBe(true);
  });

  it('STARRED not excluded when excludeStarred is false', () => {
    const collector = makeCollector({ excludeStarred: false });
    expect(collector._isExcludedByLabel(['INBOX', 'STARRED'])).toBe(false);
  });

  it('IMPORTANT not excluded by default', () => {
    const collector = makeCollector();
    expect(collector._isExcludedByLabel(['INBOX', 'IMPORTANT'])).toBe(false);
  });

  it('IMPORTANT excluded when excludeImportant is true', () => {
    const collector = makeCollector({ excludeImportant: true });
    expect(collector._isExcludedByLabel(['INBOX', 'IMPORTANT'])).toBe(true);
  });

  it('custom labels exclude by default', () => {
    const collector = makeCollector();
    expect(collector._isExcludedByLabel(['INBOX', 'Label_12345'])).toBe(true);
  });

  it('custom labels do not exclude when label exclusion disabled', () => {
    const collector = makeCollector({ useLabelExclusion: false });
    expect(collector._isExcludedByLabel(['INBOX', 'Label_12345'])).toBe(false);
  });

  it('specific excludedLabelIds only exclude matching labels', () => {
    const collector = makeCollector({ excludedLabelIds: new Set(['Label_12345']) });

    // Matching label should exclude
    expect(collector._isExcludedByLabel(['INBOX', 'Label_12345'])).toBe(true);

    // Non-matching custom label should not exclude
    expect(collector._isExcludedByLabel(['INBOX', 'Label_99999'])).toBe(false);
  });

  it('regular INBOX label does not exclude', () => {
    const collector = makeCollector();
    expect(collector._isExcludedByLabel(['INBOX'])).toBe(false);
  });

  it('empty labels do not exclude', () => {
    const collector = makeCollector();
    expect(collector._isExcludedByLabel([])).toBe(false);
  });
});

// === Domain Exclusion Logic Tests ===

describe('isExcludedByDomain', () => {
  function makeCollector(excludedDomains = new Set()) {
    return new DomainCollector(new CollectorConfig({ excludedDomains }));
  }

  it('domain in exclusion list is excluded', () => {
    const collector = makeCollector(new Set(['spam.com', 'junk.com']));
    expect(collector._isExcludedByDomain('spam.com')).toBe(true);
  });

  it('domain not in exclusion list is not excluded', () => {
    const collector = makeCollector(new Set(['spam.com', 'junk.com']));
    expect(collector._isExcludedByDomain('social.com')).toBe(false);
  });

  it('empty exclusion list excludes nothing', () => {
    const collector = makeCollector();
    expect(collector._isExcludedByDomain('spam.com')).toBe(false);
  });
});

// === Should Include Tests ===

describe('shouldInclude', () => {
  function makeCollector(configOverrides = {}) {
    const config = new CollectorConfig(configOverrides);
    return new DomainCollector(config);
  }

  function makeThread(sender, labelIds = ['INBOX']) {
    return new Thread('test', {
      from: sender,
      subject: '',
      labelIds,
      messageCount: 1,
    });
  }

  it('regular thread is included', () => {
    const collector = makeCollector();
    const thread = makeThread('test@spam.com');
    expect(collector._shouldInclude(thread)).toBe(true);
  });

  it('important thread is included (auto-applied by Gmail)', () => {
    const collector = makeCollector();
    const thread = makeThread('test@important.com', ['INBOX', 'IMPORTANT']);
    expect(collector._shouldInclude(thread)).toBe(true);
  });

  it('starred thread is excluded', () => {
    const collector = makeCollector();
    const thread = makeThread('test@starred.com', ['INBOX', 'STARRED']);
    expect(collector._shouldInclude(thread)).toBe(false);
  });

  it('excluded domain thread is excluded', () => {
    const collector = makeCollector({ excludedDomains: new Set(['spam.com']) });
    const thread = makeThread('test@spam.com');
    expect(collector._shouldInclude(thread)).toBe(false);
  });
});

// === Collection Tests (Async) ===

describe('collect', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setupApiMocks(api, sampleInbox());
  });

  function defaultConfig(overrides = {}) {
    return new CollectorConfig(overrides);
  }

  it('basic collection groups threads by domain', async () => {
    const collector = new DomainCollector(defaultConfig());
    const result = await collector.collect();
    const dr = result.domainResults;

    // Should have collected domains (excluding starred/important/labeled ones)
    expect(Object.keys(dr).length).toBeGreaterThan(0);

    // spam.com should have 2 threads (thread_001, thread_002)
    expect(dr['spam.com']).toBeDefined();
    expect(dr['spam.com'].count).toBe(2);

    // social.com should have 1 thread
    expect(dr['social.com']).toBeDefined();
    expect(dr['social.com'].count).toBe(1);
  });

  it('skips excluded threads', async () => {
    const collector = new DomainCollector(defaultConfig());
    const result = await collector.collect();
    const dr = result.domainResults;

    // important.com has IMPORTANT label but should still be collected
    // (IMPORTANT is auto-applied by Gmail, not a user action)
    expect(dr['important.com']).toBeDefined();

    // starred.com is STARRED labeled - should not be in results
    expect(dr['starred.com']).toBeUndefined();

    // labeled.com has custom label - should not be in results
    expect(dr['labeled.com']).toBeUndefined();
  });

  it('skips excluded domains', async () => {
    const collector = new DomainCollector(defaultConfig({ excludedDomains: new Set(['spam.com']) }));
    const result = await collector.collect();
    const dr = result.domainResults;

    // spam.com should not be in results
    expect(dr['spam.com']).toBeUndefined();

    // Other domains should still be present
    expect(dr['social.com']).toBeDefined();
  });

  it('empty inbox returns empty result', async () => {
    setupApiMocks(api, { threadsTotal: 0, threads: [] });

    const collector = new DomainCollector(defaultConfig());
    const result = await collector.collect();

    expect(Object.keys(result.domainResults).length).toBe(0);
  });

  it('stores thread metadata', async () => {
    const collector = new DomainCollector(defaultConfig());
    const result = await collector.collect();

    // Should have stored threads in the CollectionResult
    expect(Object.keys(result.threadsById).length).toBeGreaterThan(0);
    expect(Object.keys(result.threadsByDomain).length).toBeGreaterThan(0);

    // Check that spam.com threads are stored
    expect(result.threadsByDomain['spam.com']).toBeDefined();
    expect(result.threadsByDomain['spam.com'].length).toBe(2);
  });

  it('multi-message thread reports correct message count', async () => {
    const collector = new DomainCollector(defaultConfig());
    const result = await collector.collect();
    const dr = result.domainResults;

    // multi.com thread has 3 messages
    expect(dr['multi.com']).toBeDefined();
    expect(dr['multi.com'].threads.length).toBe(1);
    expect(dr['multi.com'].threads[0].message_count).toBe(3);
  });

  it('handles plain email format (no angle brackets)', async () => {
    const collector = new DomainCollector(defaultConfig());
    const result = await collector.collect();

    // edge.com uses plain email format
    expect(result.domainResults['edge.com']).toBeDefined();
  });

  it('calls progress callback with lifecycle events (not per-thread)', async () => {
    const progressEvents = [];
    const callback = async (event, data) => progressEvents.push([event, data]);

    const collector = new DomainCollector(defaultConfig(), callback);
    await collector.collect();

    const eventTypes = progressEvents.map(e => e[0]);
    expect(eventTypes).toContain('collection_started');
    expect(eventTypes).toContain('collection_completed');
    // thread_processed is no longer emitted — replaced by pollable progress
    expect(eventTypes).not.toContain('thread_processed');
  });

  it('updates progress object during collection', async () => {
    const collector = new DomainCollector(defaultConfig());

    // Before collection
    expect(collector.progress.status).toBe('idle');
    expect(collector.progress.collected).toBe(0);
    expect(collector.progress.scanned).toBe(0);

    await collector.collect();

    // After collection
    expect(collector.progress.status).toBe('completed');
    expect(collector.progress.collected).toBeGreaterThan(0);
    expect(collector.progress.uniqueDomains).toBeGreaterThan(0);
    // scanned >= collected (includes filtered threads)
    expect(collector.progress.scanned).toBeGreaterThanOrEqual(collector.progress.collected);
  });

  it('default scan does not include archived threads', async () => {
    const collector = new DomainCollector(defaultConfig());
    const result = await collector.collect();
    const dr = result.domainResults;

    // archived.com thread has no INBOX label — should not appear
    expect(dr['archived.com']).toBeUndefined();
  });

  it('includeArchived collects archived threads', async () => {
    const collector = new DomainCollector(defaultConfig({ includeArchived: true }));
    const result = await collector.collect();
    const dr = result.domainResults;

    // archived.com thread should now be included
    expect(dr['archived.com']).toBeDefined();
    expect(dr['archived.com'].count).toBe(1);
  });

  it('includeArchived still collects inbox threads', async () => {
    const collector = new DomainCollector(defaultConfig({ includeArchived: true }));
    const result = await collector.collect();
    const dr = result.domainResults;

    // Regular inbox threads should still be present
    expect(dr['spam.com']).toBeDefined();
    expect(dr['social.com']).toBeDefined();
  });

  it('with label exclusion disabled, custom-labeled threads are collected', async () => {
    const collector = new DomainCollector(defaultConfig({ useLabelExclusion: false }));
    const result = await collector.collect();
    const dr = result.domainResults;

    // labeled.com should now be in results (custom label no longer excluded)
    expect(dr['labeled.com']).toBeDefined();

    // STARRED should still be excluded, but IMPORTANT is collected
    expect(dr['important.com']).toBeDefined();
    expect(dr['starred.com']).toBeUndefined();
  });
});
