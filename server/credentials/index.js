/**
 * SEC-011: Credential provider abstraction
 * Allows for pluggable credential storage backends
 */

import { KeychainProvider } from './keychain.js';
// Future providers can be imported here:
// import { AWSProvider } from './aws.js';
// import { VaultProvider } from './vault.js';

const providers = {
  keychain: KeychainProvider,
  // aws: AWSProvider,
  // vault: VaultProvider,
  // env: EnvProvider (for backwards compatibility)
};

const providerName = process.env.CREDENTIAL_PROVIDER || 'keychain';

let credentialProvider;

try {
  const ProviderClass = providers[providerName];
  if (!ProviderClass) {
    console.warn(`[WARN] Unknown credential provider: ${providerName}, falling back to keychain`);
    credentialProvider = new KeychainProvider();
  } else {
    credentialProvider = new ProviderClass();
  }
} catch (error) {
  console.error(`[ERROR] Failed to initialize credential provider: ${error.message}`);
  // Fallback to a no-op provider
  credentialProvider = {
    async get() { return null; },
    async set() { throw new Error('Credential provider not available'); },
    async delete() { return false; }
  };
}

export { credentialProvider };

// Export provider classes for direct use if needed
export { KeychainProvider };
