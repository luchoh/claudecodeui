// hooks/useVersionCheck.js
// SEC-007: Version check disabled per user mandate - no external API calls
import { version } from '../../package.json';

export const useVersionCheck = (owner, repo) => {
  // SEC-007: Version check functionality disabled
  // This hook previously called GitHub API to check for updates
  // Now returns static values indicating no update available
  return {
    updateAvailable: false,
    latestVersion: null,
    currentVersion: version,
    releaseInfo: null
  };
};
