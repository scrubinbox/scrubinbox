/**
 * Domain Cleaner — trashes selected threads via the Worker proxy.
 *
 * The Worker fans out per-thread trash/delete calls concurrently (see
 * /api/trash). We batch here to stay within the Worker's per-request
 * subrequest budget: TRASH_BATCH_SIZE = 45 matches worker/gmail.ts.
 */

import { trashBatch } from './api.js';
import { CleanupStats } from '../models/index.js';

// Kept in sync with TRASH_BATCH_SIZE in worker/gmail.ts. A mismatch would
// either waste subrequest budget (too small) or fail the Zod schema (too
// large) — hardcoding both sides is intentional; the Worker is the source
// of truth and the client stays under it.
const TRASH_BATCH_SIZE = 45;

export class DomainCleaner {
  constructor(config, progressCallback = null) {
    this.config = config;
    this.progressCallback = progressCallback;
    this.interrupted = false;

    // Pollable progress state — UI reads this via setInterval
    this.progress = {
      processed: 0,
      processTotal: 0,
      deleted: 0,
      permanentDelete: false,
      status: 'idle',
    };
  }

  // === Main Entry Point ===

  async cleanup(threads) {
    if (!threads || threads.length === 0) {
      return DomainCleaner.buildStats(0, 0, 0);
    }

    // Initialize pollable progress
    this.progress.processTotal = threads.length;
    this.progress.permanentDelete = this.config.permanentDelete;
    this.progress.status = 'running';
    this.progress.processed = 0;
    this.progress.deleted = 0;

    await this._reportProgress('cleanup_started', {
      process_total: threads.length,
    });

    let totalProcessed = 0;
    let threadsDeleted = 0;
    let threadsFailed = 0;

    for (let i = 0; i < threads.length; i += TRASH_BATCH_SIZE) {
      if (this.interrupted) break;

      const batch = threads.slice(i, i + TRASH_BATCH_SIZE);
      const ids = batch.map((t) => t.thread_id);

      let results;
      try {
        const resp = await trashBatch(ids, this.config.permanentDelete);
        results = resp.results ?? [];
      } catch (error) {
        // Server-side failure (e.g. 403 not_paid, 401, 502) — mark the
        // whole batch as failed and stop; retrying deeper batches when the
        // proxy itself is refusing is guaranteed to fail the same way.
        console.error('trashBatch failed:', error);
        threadsFailed += batch.length;
        totalProcessed += batch.length;
        this.progress.processed = totalProcessed;
        this.progress.deleted = threadsDeleted;
        break;
      }

      for (const r of results) {
        if (r.success) {
          threadsDeleted += 1;
        } else {
          threadsFailed += 1;
          console.error(`Error removing thread ${r.id}:`, r.error);
        }
        totalProcessed += 1;
        this.progress.processed = totalProcessed;
        this.progress.deleted = threadsDeleted;
      }
    }

    this.progress.status = 'completed';

    const result = DomainCleaner.buildStats(totalProcessed, threadsDeleted, threadsFailed);
    await this._reportProgress('cleanup_completed', result);

    return result;
  }

  // === Progress ===

  async _reportProgress(event, data) {
    if (this.progressCallback) {
      await this.progressCallback(event, data);
    }
  }

  // === Results ===

  static buildStats(processed, deleted, failed) {
    return new CleanupStats({
      threads_processed: processed,
      threads_deleted: deleted,
      threads_failed_to_delete: failed,
    });
  }
}
