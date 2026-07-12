/**
 * Application-wide constants
 */

// Subject line truncation limit for display in the cleaner UI
export const SUBJECT_TRUNCATE_CLEANER = 50;

// How often the UI polls the worker's progress object (ms)
export const PROGRESS_POLL_INTERVAL_MS = 100;

// Gmail API page size for listing threads
export const THREAD_PAGE_SIZE = 100;


// Number of concurrent Gmail API calls (per-user quota ~250 units/sec)
export const API_CONCURRENCY = 5;
