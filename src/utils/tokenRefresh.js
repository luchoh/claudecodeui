/**
 * SEC-011: Token refresh utility with race condition handling
 * Ensures only one refresh happens at a time when multiple 401s occur
 */

// Track if a refresh is in progress
let isRefreshing = false;

// Queue of callbacks waiting for refresh to complete
let refreshSubscribers = [];

/**
 * Subscribe to the refresh completion event
 * @param {function(string|null, Error|null): void} callback
 */
function subscribeToRefresh(callback) {
  refreshSubscribers.push(callback);
}

/**
 * Notify all subscribers when refresh completes
 * @param {string|null} token - New token or null on failure
 * @param {Error|null} error - Error if refresh failed
 */
function onRefreshComplete(token, error = null) {
  refreshSubscribers.forEach(cb => cb(token, error));
  refreshSubscribers = [];
}

/**
 * Refresh the access token using the stored refresh token
 * Handles race conditions by queueing concurrent requests
 * @returns {Promise<string>} New access token
 * @throws {Error} If refresh fails
 */
export async function refreshAccessToken() {
  // If already refreshing, wait for the result
  if (isRefreshing) {
    return new Promise((resolve, reject) => {
      subscribeToRefresh((token, error) => {
        if (error) {
          reject(error);
        } else {
          resolve(token);
        }
      });
    });
  }

  const refreshToken = localStorage.getItem('refresh-token');
  if (!refreshToken) {
    throw new Error('No refresh token available');
  }

  isRefreshing = true;

  try {
    const response = await fetch('/api/auth/refresh', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refreshToken }),
    });

    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      throw new Error(data.error || 'Token refresh failed');
    }

    const data = await response.json();

    // Store new tokens
    localStorage.setItem('auth-token', data.accessToken);
    if (data.refreshToken) {
      localStorage.setItem('refresh-token', data.refreshToken);
    }

    // Notify waiting subscribers
    onRefreshComplete(data.accessToken);

    return data.accessToken;
  } catch (error) {
    // Clear tokens on refresh failure
    localStorage.removeItem('auth-token');
    localStorage.removeItem('refresh-token');

    // Notify waiting subscribers of failure
    onRefreshComplete(null, error);

    throw error;
  } finally {
    isRefreshing = false;
  }
}

/**
 * Check if the current token should be proactively refreshed
 * Returns true if token expires within 2 minutes
 * @returns {boolean}
 */
export function shouldRefreshToken() {
  const token = localStorage.getItem('auth-token');
  if (!token) return false;

  try {
    // Decode JWT payload (middle part)
    const payload = JSON.parse(atob(token.split('.')[1]));

    // Check if token expires within 2 minutes (120 seconds)
    const expiresAt = payload.exp;
    const now = Math.floor(Date.now() / 1000);
    const timeUntilExpiry = expiresAt - now;

    return timeUntilExpiry < 120;
  } catch {
    // If we can't decode the token, don't try to refresh
    return false;
  }
}

/**
 * Check if refresh is currently in progress
 * @returns {boolean}
 */
export function isRefreshInProgress() {
  return isRefreshing;
}
