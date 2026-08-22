/**
 * Tests for DomainCleaner class
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { DomainCleaner } from '../cleaner.js';
import { CleanerConfig } from '../../models/index.js';
import { sampleInbox, setupApiMocks } from './testUtils.js';

// Top-level mock with vi.fn() stubs — hoisted safely
vi.mock('../api.js', () => ({
  getInboxInfo: vi.fn(),
  fetchScanPage: vi.fn(),
  trashBatch: vi.fn(),
  listLabels: vi.fn(),
}));

import * as api from '../api.js';

// === Sample Thread Data ===

function makeCleanupThread(threadId, domain, subject, sender, messageCount = 1) {
  return {
    thread_id: threadId,
    domain,
    subject,
    sender,
    message_count: messageCount,
  };
}

function sampleThreads() {
  return [
    makeCleanupThread('thread_001', 'spam.com', 'Buy now!', 'promo@spam.com', 2),
    makeCleanupThread('thread_002', 'spam.com', 'Limited offer', 'deals@spam.com', 1),
    makeCleanupThread('thread_003', 'junk.com', 'You won!', 'winner@junk.com', 3),
  ];
}

// Track mocks at module level so we can check trashedThreads in assertions
let currentMocks;

// === Cleanup Tests ===

describe('cleanup', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    currentMocks = setupApiMocks(api, sampleInbox());
  });

  it('trashes threads by default', async () => {
    const cleaner = new DomainCleaner(new CleanerConfig());
    const result = await cleaner.cleanup(sampleThreads());

    expect(result.threads_processed).toBe(3);
    expect(result.threads_deleted).toBe(3);
    expect(result.threads_failed_to_delete).toBe(0);

    expect(currentMocks.trashedThreads.size).toBe(3);
    expect(currentMocks.trashedThreads.has('thread_001')).toBe(true);
    expect(currentMocks.trashedThreads.has('thread_002')).toBe(true);
    expect(currentMocks.trashedThreads.has('thread_003')).toBe(true);
  });

  it('empty thread list returns zero stats', async () => {
    const cleaner = new DomainCleaner(new CleanerConfig());
    const result = await cleaner.cleanup([]);

    expect(result.threads_processed).toBe(0);
    expect(result.threads_deleted).toBe(0);
    expect(result.threads_failed_to_delete).toBe(0);
  });

  it('handles per-thread failures from server', async () => {
    currentMocks = setupApiMocks(api, sampleInbox(), { failThreads: new Set(['thread_001']) });

    const cleaner = new DomainCleaner(new CleanerConfig());
    const result = await cleaner.cleanup(sampleThreads());

    expect(result.threads_processed).toBe(3);
    expect(result.threads_deleted).toBe(2);
    expect(result.threads_failed_to_delete).toBe(1);
  });

  it('handles batch-level API rejection (e.g. 403 not_paid) as all-failed', async () => {
    api.trashBatch.mockImplementation(async () => {
      const err = new Error('API /trash 403: not_paid');
      err.status = 403;
      err.code = 'not_paid';
      throw err;
    });

    const cleaner = new DomainCleaner(new CleanerConfig());
    const result = await cleaner.cleanup(sampleThreads());

    expect(result.threads_processed).toBe(3);
    expect(result.threads_deleted).toBe(0);
    expect(result.threads_failed_to_delete).toBe(3);
  });

  it('calls progress callback with lifecycle events', async () => {
    const progressEvents = [];
    const callback = async (event, data) => progressEvents.push([event, data]);

    const cleaner = new DomainCleaner(new CleanerConfig(), callback);
    await cleaner.cleanup(sampleThreads());

    const eventTypes = progressEvents.map(e => e[0]);
    expect(eventTypes).toContain('cleanup_started');
    expect(eventTypes).toContain('cleanup_completed');
  });

  it('updates progress object during cleanup', async () => {
    const cleaner = new DomainCleaner(new CleanerConfig());

    expect(cleaner.progress.status).toBe('idle');
    expect(cleaner.progress.processed).toBe(0);

    await cleaner.cleanup(sampleThreads());

    expect(cleaner.progress.status).toBe('completed');
    expect(cleaner.progress.processed).toBe(3);
    expect(cleaner.progress.deleted).toBe(3);
  });

  it('permanent delete is forwarded to /api/trash', async () => {
    const cleaner = new DomainCleaner(new CleanerConfig({ permanentDelete: true }));
    await cleaner.cleanup(sampleThreads());

    // Every call to trashBatch received permanent=true
    for (const call of api.trashBatch.mock.calls) {
      expect(call[1]).toBe(true);
    }
  });

  it('batches large thread lists into <=49-thread requests', async () => {
    const big = Array.from({ length: 120 }, (_, i) =>
      makeCleanupThread(`t${i}`, 'spam.com', 'x', 'a@spam.com'),
    );

    const cleaner = new DomainCleaner(new CleanerConfig());
    await cleaner.cleanup(big);

    // 120 threads / 49 per batch = 3 calls (49, 49, 22)
    expect(api.trashBatch).toHaveBeenCalledTimes(3);
    for (const call of api.trashBatch.mock.calls) {
      expect(call[0].length).toBeLessThanOrEqual(49);
    }
  });
});

// === Build Stats Tests ===

describe('buildStats', () => {
  it('includes all fields', () => {
    const result = DomainCleaner.buildStats(10, 8, 2);

    expect(result.threads_processed).toBe(10);
    expect(result.threads_deleted).toBe(8);
    expect(result.threads_failed_to_delete).toBe(2);
  });

  it('handles all zeros', () => {
    const result = DomainCleaner.buildStats(0, 0, 0);

    expect(result.threads_processed).toBe(0);
    expect(result.threads_deleted).toBe(0);
    expect(result.threads_failed_to_delete).toBe(0);
  });
});

// === Interrupt Handling Tests ===

describe('interrupt handling', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setupApiMocks(api, sampleInbox());
  });

  it('stops when interrupted flag is set', async () => {
    const big = Array.from({ length: 120 }, (_, i) =>
      makeCleanupThread(`t${i}`, 'spam.com', 'x', 'a@spam.com'),
    );

    const cleaner = new DomainCleaner(new CleanerConfig());
    cleaner.progressCallback = async (event) => {
      if (event === 'cleanup_started') {
        cleaner.interrupted = true;
      }
    };

    const result = await cleaner.cleanup(big);

    // With 120 threads across 3 batches, interruption before batch 2 leaves
    // at least the second and third batches un-processed.
    expect(result.threads_processed).toBeLessThan(big.length);
  });
});
