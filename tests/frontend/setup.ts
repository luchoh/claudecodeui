/**
 * Frontend test setup for Vitest with jsdom
 * Configures DOM testing utilities and mocks browser APIs
 * Safely skips when running in node environment (server tests)
 */

import { vi } from 'vitest';

// Only run DOM setup when in a browser-like environment (jsdom/happy-dom)
if (typeof window !== 'undefined') {
  // Import jest-dom matchers
  await import('@testing-library/jest-dom');

  // Mock matchMedia
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    value: vi.fn().mockImplementation(query => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  });

  // Mock IntersectionObserver
  if (!window.IntersectionObserver) {
    class MockIntersectionObserver {
      observe = vi.fn();
      unobserve = vi.fn();
      disconnect = vi.fn();
    }
    Object.defineProperty(window, 'IntersectionObserver', {
      writable: true,
      value: MockIntersectionObserver
    });
  }

  // Mock ResizeObserver
  if (!window.ResizeObserver) {
    class MockResizeObserver {
      observe = vi.fn();
      unobserve = vi.fn();
      disconnect = vi.fn();
    }
    Object.defineProperty(window, 'ResizeObserver', {
      writable: true,
      value: MockResizeObserver
    });
  }
}
