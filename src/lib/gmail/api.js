/**
 * Gmail API wrapper using gapi.client.gmail
 *
 * All functions use the access token managed internally by gapi.client
 * (set automatically by GIS after authentication).
 */

import { refreshGoogleAccessToken } from './auth.js';

/**
 * Wraps an API call with automatic token refresh on 401 errors.
 * Refresh goes through Supabase, which uses the stored Google refresh token
 * to mint a new provider_token without showing a consent dialog.
 */
async function withTokenRefresh(apiCall) {
  try {
    const response = await apiCall();
    return response.result;
  } catch (err) {
    if (err.status === 401) {
      await refreshGoogleAccessToken();
      const response = await apiCall();
      return response.result;
    }
    throw err;
  }
}

/**
 * Get the authenticated user's Gmail profile (email address).
 */
export function getProfile() {
  return withTokenRefresh(() =>
    gapi.client.gmail.users.getProfile({
      userId: 'me',
    })
  );
}

/**
 * Get info for a specific label (includes threadsTotal).
 */
export function getLabelInfo(labelId) {
  return withTokenRefresh(() =>
    gapi.client.gmail.users.labels.get({
      userId: 'me',
      id: labelId,
    })
  );
}

/**
 * Get inbox label info (includes threadsTotal for progress reporting).
 */
export function getInboxInfo() {
  return getLabelInfo('INBOX');
}

/**
 * List all user labels.
 */
export function listLabels() {
  return withTokenRefresh(() =>
    gapi.client.gmail.users.labels.list({
      userId: 'me',
    })
  );
}

/**
 * List threads with pagination support.
 */
export function listThreads({ maxResults = 100, pageToken = null, q = 'in:inbox' } = {}) {
  const params = { userId: 'me', maxResults, q };
  if (pageToken) params.pageToken = pageToken;

  return withTokenRefresh(() =>
    gapi.client.gmail.users.threads.list(params)
  );
}

/**
 * Get a single thread with metadata.
 */
export function getThread(threadId, { format = 'metadata', metadataHeaders = ['From', 'Subject'] } = {}) {
  return withTokenRefresh(() =>
    gapi.client.gmail.users.threads.get({
      userId: 'me',
      id: threadId,
      format,
      metadataHeaders,
    })
  );
}

/**
 * Move a thread to trash.
 */
export function trashThread(threadId) {
  return withTokenRefresh(() =>
    gapi.client.gmail.users.threads.trash({
      userId: 'me',
      id: threadId,
    })
  );
}

/**
 * Permanently delete a thread. Cannot be undone.
 */
export function deleteThread(threadId) {
  return withTokenRefresh(() =>
    gapi.client.gmail.users.threads.delete({
      userId: 'me',
      id: threadId,
    })
  );
}
