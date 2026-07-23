'use strict';

const AUTH_REQUIRED_TAG = '[KIMI_AUTH_REQUIRED]';

/**
 * Kimi Code 0.28.x can report auth.ready=true while the managed provider is
 * unauthenticated. Prompt submission still fails in that state, so the
 * provider status is the authoritative signal for the managed Kimi model.
 */
function requiresCliLogin(snapshot) {
  if (!snapshot || typeof snapshot !== 'object') return false;
  const provider = snapshot.managed_provider;
  if (!provider || typeof provider !== 'object') return snapshot.ready === false;

  const status = String(provider.status || '').toLowerCase();
  if (!['unauthenticated', 'expired', 'revoked'].includes(status)) return false;

  const defaultModel = String(snapshot.default_model || '').toLowerCase();
  const usesManagedModel = !defaultModel || defaultModel.startsWith('kimi-code/');
  const hasOnlyManagedProvider = Number(snapshot.providers_count || 0) <= 1;
  return usesManagedModel || hasOnlyManagedProvider;
}

function authRequiredError() {
  const error = new Error(
    `${AUTH_REQUIRED_TAG} Your Kimi login has expired or is unavailable. Sign in again and retry.`,
  );
  error.code = 'KIMI_AUTH_REQUIRED';
  return error;
}

function isAuthRequiredError(error) {
  return (
    error?.code === 'KIMI_AUTH_REQUIRED' ||
    String(error?.message || error || '').includes(AUTH_REQUIRED_TAG)
  );
}

module.exports = {
  AUTH_REQUIRED_TAG,
  authRequiredError,
  isAuthRequiredError,
  requiresCliLogin,
};
