/**
 * Test utilities for Gmail modules — matches the Worker-projected
 * shape returned by /api/scan/page.
 */

/**
 * Build one projected thread as the Worker would return it.
 */
export function makeProjected(threadId, sender, subject, labels = ['INBOX'], messageCount = 1) {
  return {
    id: threadId,
    from: sender,
    subject,
    labelIds: labels,
    messageCount,
  };
}

export function makeProjectedNoMessages(threadId) {
  return {
    id: threadId,
    from: '',
    subject: '',
    labelIds: ['INBOX'],
    messageCount: 0,
  };
}

export function makeProjectedNoFrom(threadId, subject) {
  return {
    id: threadId,
    from: '',
    subject,
    labelIds: ['INBOX'],
    messageCount: 1,
  };
}

/**
 * Realistic inbox fixture, projected shape.
 */
export function sampleInbox() {
  const threads = [
    // Regular collectible threads
    makeProjected('thread_001', 'Newsletter <newsletter@spam.com>', 'Buy now! 50% off', ['INBOX']),
    makeProjected('thread_002', 'Promo <promo@spam.com>', 'Limited time offer', ['INBOX']),
    makeProjected('thread_003', 'Updates <updates@social.com>', 'New friend request', ['INBOX']),

    // Excluded threads (starred, important, labeled)
    makeProjected('thread_004', 'Boss <boss@important.com>', 'Q4 Review', ['INBOX', 'IMPORTANT']),
    makeProjected('thread_005', 'Friend <friend@starred.com>', 'Party invite', ['INBOX', 'STARRED']),
    makeProjected('thread_006', 'Bank <bank@labeled.com>', 'Statement', ['INBOX', 'Label_12345']),

    // Multi-message thread
    makeProjected('thread_007', 'Support <support@multi.com>', 'Ticket #1234', ['INBOX'], 3),

    // Plain email format (no angle brackets)
    makeProjected('thread_008', 'plain@edge.com', 'Plain sender format', ['INBOX']),

    // Archived thread (no INBOX label)
    makeProjected('thread_011', 'Old <old@archived.com>', 'Old newsletter', []),

    // Edge cases
    makeProjectedNoMessages('thread_009'),
    makeProjectedNoFrom('thread_010', 'No sender thread'),
  ];

  return {
    threadsTotal: threads.length,
    threads,
  };
}

/**
 * Wire vi.fn() mocks from a vi.mock()'d api module to fake implementations.
 *
 * The api module now hits the Worker (getInboxInfo, fetchScanPage, trashBatch).
 * fetchScanPage returns the whole projected page in one call.
 *
 * @returns {object} { trashedThreads: Set }
 */
export function setupApiMocks(api, inboxData, { failThreads = new Set() } = {}) {
  const allThreads = inboxData.threads || [];
  const trashedThreads = new Set();

  if (api.getInboxInfo) {
    api.getInboxInfo.mockImplementation(async () => ({
      threadsTotal: inboxData.threadsTotal || 0,
    }));
  }

  if (api.fetchScanPage) {
    api.fetchScanPage.mockImplementation(async ({ pageToken = null, config = {} }) => {
      const includeArchived = !!config.includeArchived;
      const threads = includeArchived
        ? allThreads
        : allThreads.filter((t) => (t.labelIds || []).includes('INBOX'));
      // Match Worker's SCAN_PAGE_SIZE cap for realism (49).
      const pageSize = 49;
      const startIdx = pageToken ? parseInt(pageToken, 10) : 0;
      const endIdx = Math.min(startIdx + pageSize, threads.length);
      const pageThreads = threads.slice(startIdx, endIdx);
      return {
        threads: pageThreads,
        nextPageToken: endIdx < threads.length ? String(endIdx) : null,
      };
    });
  }

  if (api.trashBatch) {
    api.trashBatch.mockImplementation(async (threadIds) => {
      const results = threadIds.map((id) => {
        if (failThreads.has(id)) {
          return { id, success: false, error: '404 Thread not found' };
        }
        trashedThreads.add(id);
        return { id, success: true };
      });
      return { results };
    });
  }

  if (api.listLabels) {
    api.listLabels.mockImplementation(async () => ({ labels: [] }));
  }

  return { trashedThreads };
}
