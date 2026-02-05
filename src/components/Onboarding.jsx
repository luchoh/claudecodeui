import React, { useState, useEffect, useRef } from 'react';
import { ChevronRight, ChevronLeft, Check, LogIn, Loader2 } from 'lucide-react';
import ClaudeLogo from './ClaudeLogo';
import CursorLogo from './CursorLogo';
import CodexLogo from './CodexLogo';
import LoginModal from './LoginModal';
import { authenticatedFetch } from '../utils/api';
import { useAuth } from '../contexts/AuthContext';
import { IS_PLATFORM } from '../constants/config';

// SEC-007: Git configuration step removed per security hardening requirements

const Onboarding = ({ onComplete }) => {
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState('');

  const [activeLoginProvider, setActiveLoginProvider] = useState(null);
  const [selectedProject] = useState({ name: 'default', fullPath: IS_PLATFORM ? '/workspace' : '' });

  const [claudeAuthStatus, setClaudeAuthStatus] = useState({
    authenticated: false,
    email: null,
    loading: true,
    error: null
  });

  const [cursorAuthStatus, setCursorAuthStatus] = useState({
    authenticated: false,
    email: null,
    loading: true,
    error: null
  });

  const [codexAuthStatus, setCodexAuthStatus] = useState({
    authenticated: false,
    email: null,
    loading: true,
    error: null
  });

  const { user } = useAuth();

  const prevActiveLoginProviderRef = useRef(undefined);

  useEffect(() => {
    const prevProvider = prevActiveLoginProviderRef.current;
    prevActiveLoginProviderRef.current = activeLoginProvider;

    const isInitialMount = prevProvider === undefined;
    const isModalClosing = prevProvider !== null && activeLoginProvider === null;

    if (isInitialMount || isModalClosing) {
      checkClaudeAuthStatus();
      checkCursorAuthStatus();
      checkCodexAuthStatus();
    }
  }, [activeLoginProvider]);

  const checkClaudeAuthStatus = async () => {
    try {
      const response = await authenticatedFetch('/api/cli/claude/status');
      if (response.ok) {
        const data = await response.json();
        setClaudeAuthStatus({
          authenticated: data.authenticated,
          email: data.email,
          loading: false,
          error: data.error || null
        });
      } else {
        setClaudeAuthStatus({
          authenticated: false,
          email: null,
          loading: false,
          error: 'Failed to check authentication status'
        });
      }
    } catch (error) {
      console.error('Error checking Claude auth status:', error);
      setClaudeAuthStatus({
        authenticated: false,
        email: null,
        loading: false,
        error: error.message
      });
    }
  };

  const checkCursorAuthStatus = async () => {
    try {
      const response = await authenticatedFetch('/api/cli/cursor/status');
      if (response.ok) {
        const data = await response.json();
        setCursorAuthStatus({
          authenticated: data.authenticated,
          email: data.email,
          loading: false,
          error: data.error || null
        });
      } else {
        setCursorAuthStatus({
          authenticated: false,
          email: null,
          loading: false,
          error: 'Failed to check authentication status'
        });
      }
    } catch (error) {
      console.error('Error checking Cursor auth status:', error);
      setCursorAuthStatus({
        authenticated: false,
        email: null,
        loading: false,
        error: error.message
      });
    }
  };

  const checkCodexAuthStatus = async () => {
    try {
      const response = await authenticatedFetch('/api/cli/codex/status');
      if (response.ok) {
        const data = await response.json();
        setCodexAuthStatus({
          authenticated: data.authenticated,
          email: data.email,
          loading: false,
          error: data.error || null
        });
      } else {
        setCodexAuthStatus({
          authenticated: false,
          email: null,
          loading: false,
          error: 'Failed to check authentication status'
        });
      }
    } catch (error) {
      console.error('Error checking Codex auth status:', error);
      setCodexAuthStatus({
        authenticated: false,
        email: null,
        loading: false,
        error: error.message
      });
    }
  };

  const handleClaudeLogin = () => setActiveLoginProvider('claude');
  const handleCursorLogin = () => setActiveLoginProvider('cursor');
  const handleCodexLogin = () => setActiveLoginProvider('codex');

  const handleLoginComplete = (exitCode) => {
    if (exitCode === 0) {
      if (activeLoginProvider === 'claude') {
        checkClaudeAuthStatus();
      } else if (activeLoginProvider === 'cursor') {
        checkCursorAuthStatus();
      } else if (activeLoginProvider === 'codex') {
        checkCodexAuthStatus();
      }
    }
  };

  const handleFinish = async () => {
    setIsSubmitting(true);
    setError('');

    try {
      const response = await authenticatedFetch('/api/user/complete-onboarding', {
        method: 'POST'
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || 'Failed to complete onboarding');
      }

      if (onComplete) {
        onComplete();
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <>
      <div className="min-h-screen bg-background flex items-center justify-center p-4">
        <div className="w-full max-w-2xl">
          {/* Header */}
          <div className="mb-8 text-center">
            <div className="w-16 h-16 bg-blue-100 dark:bg-blue-900/30 rounded-full flex items-center justify-center mx-auto mb-4">
              <LogIn className="w-8 h-8 text-blue-600 dark:text-blue-400" />
            </div>
            <h1 className="text-2xl font-bold text-foreground mb-2">Connect Your AI Agents</h1>
            <p className="text-muted-foreground">
              Login to one or more AI coding assistants to get started. All are optional.
            </p>
          </div>

          {/* Main Card */}
          <div className="bg-card rounded-lg shadow-lg border border-border p-8">
            {/* Agent Cards */}
            <div className="space-y-3">
              {/* Claude */}
              <div className={`border rounded-lg p-4 transition-colors ${
                claudeAuthStatus.authenticated
                  ? 'bg-blue-50 dark:bg-blue-900/20 border-blue-200 dark:border-blue-800'
                  : 'border-border bg-card'
              }`}>
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 bg-blue-100 dark:bg-blue-900/30 rounded-full flex items-center justify-center">
                      <ClaudeLogo size={20} />
                    </div>
                    <div>
                      <div className="font-medium text-foreground flex items-center gap-2">
                        Claude Code
                        {claudeAuthStatus.authenticated && <Check className="w-4 h-4 text-green-500" />}
                      </div>
                      <div className="text-xs text-muted-foreground">
                        {claudeAuthStatus.loading ? 'Checking...' :
                         claudeAuthStatus.authenticated ? claudeAuthStatus.email || 'Connected' : 'Not connected'}
                      </div>
                    </div>
                  </div>
                  {!claudeAuthStatus.authenticated && !claudeAuthStatus.loading && (
                    <button
                      onClick={handleClaudeLogin}
                      className="bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium py-2 px-4 rounded-lg transition-colors"
                    >
                      Login
                    </button>
                  )}
                </div>
              </div>

              {/* Cursor */}
              <div className={`border rounded-lg p-4 transition-colors ${
                cursorAuthStatus.authenticated
                  ? 'bg-purple-50 dark:bg-purple-900/20 border-purple-200 dark:border-purple-800'
                  : 'border-border bg-card'
              }`}>
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 bg-purple-100 dark:bg-purple-900/30 rounded-full flex items-center justify-center">
                      <CursorLogo size={20} />
                    </div>
                    <div>
                      <div className="font-medium text-foreground flex items-center gap-2">
                        Cursor
                        {cursorAuthStatus.authenticated && <Check className="w-4 h-4 text-green-500" />}
                      </div>
                      <div className="text-xs text-muted-foreground">
                        {cursorAuthStatus.loading ? 'Checking...' :
                         cursorAuthStatus.authenticated ? cursorAuthStatus.email || 'Connected' : 'Not connected'}
                      </div>
                    </div>
                  </div>
                  {!cursorAuthStatus.authenticated && !cursorAuthStatus.loading && (
                    <button
                      onClick={handleCursorLogin}
                      className="bg-purple-600 hover:bg-purple-700 text-white text-sm font-medium py-2 px-4 rounded-lg transition-colors"
                    >
                      Login
                    </button>
                  )}
                </div>
              </div>

              {/* Codex */}
              <div className={`border rounded-lg p-4 transition-colors ${
                codexAuthStatus.authenticated
                  ? 'bg-gray-100 dark:bg-gray-800/50 border-gray-300 dark:border-gray-600'
                  : 'border-border bg-card'
              }`}>
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 bg-gray-100 dark:bg-gray-800 rounded-full flex items-center justify-center">
                      <CodexLogo className="w-5 h-5" />
                    </div>
                    <div>
                      <div className="font-medium text-foreground flex items-center gap-2">
                        OpenAI Codex
                        {codexAuthStatus.authenticated && <Check className="w-4 h-4 text-green-500" />}
                      </div>
                      <div className="text-xs text-muted-foreground">
                        {codexAuthStatus.loading ? 'Checking...' :
                         codexAuthStatus.authenticated ? codexAuthStatus.email || 'Connected' : 'Not connected'}
                      </div>
                    </div>
                  </div>
                  {!codexAuthStatus.authenticated && !codexAuthStatus.loading && (
                    <button
                      onClick={handleCodexLogin}
                      className="bg-gray-800 hover:bg-gray-900 dark:bg-gray-700 dark:hover:bg-gray-600 text-white text-sm font-medium py-2 px-4 rounded-lg transition-colors"
                    >
                      Login
                    </button>
                  )}
                </div>
              </div>
            </div>

            <div className="text-center text-sm text-muted-foreground pt-4">
              <p>You can configure these later in Settings.</p>
            </div>

            {/* Error Message */}
            {error && (
              <div className="mt-6 p-4 bg-red-100 dark:bg-red-900/20 border border-red-300 dark:border-red-800 rounded-lg">
                <p className="text-sm text-red-700 dark:text-red-400">{error}</p>
              </div>
            )}

            {/* Complete Button */}
            <div className="flex justify-center mt-8 pt-6 border-t border-border">
              <button
                onClick={handleFinish}
                disabled={isSubmitting}
                className="flex items-center gap-2 px-8 py-3 bg-green-600 hover:bg-green-700 disabled:bg-green-400 disabled:cursor-not-allowed text-white font-medium rounded-lg transition-colors duration-200"
              >
                {isSubmitting ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    Completing...
                  </>
                ) : (
                  <>
                    <Check className="w-4 h-4" />
                    Complete Setup
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      </div>

      {activeLoginProvider && (
        <LoginModal
          isOpen={!!activeLoginProvider}
          onClose={() => setActiveLoginProvider(null)}
          provider={activeLoginProvider}
          project={selectedProject}
          onComplete={handleLoginComplete}
        />
      )}
    </>
  );
};

export default Onboarding;
