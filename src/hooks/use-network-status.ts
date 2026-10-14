'use client';

/**
 * Browser connectivity + tab visibility via `useSyncExternalStore`
 * (Rules 103–104) — no `setState` inside an effect.
 */
import { useSyncExternalStore } from 'react';

function subscribeOnline(callback: () => void): () => void {
  window.addEventListener('online', callback);
  window.addEventListener('offline', callback);
  return () => {
    window.removeEventListener('online', callback);
    window.removeEventListener('offline', callback);
  };
}

function getOnlineSnapshot(): boolean {
  return typeof navigator === 'undefined' ? true : navigator.onLine;
}

function subscribeVisibility(callback: () => void): () => void {
  document.addEventListener('visibilitychange', callback);
  return () => document.removeEventListener('visibilitychange', callback);
}

function getVisibleSnapshot(): boolean {
  return typeof document === 'undefined' ? true : document.visibilityState === 'visible';
}

const getServerSnapshot = (): boolean => true;

export function useNetworkStatus(): { isOnline: boolean; isTabVisible: boolean } {
  const isOnline = useSyncExternalStore(subscribeOnline, getOnlineSnapshot, getServerSnapshot);
  const isTabVisible = useSyncExternalStore(subscribeVisibility, getVisibleSnapshot, getServerSnapshot);
  return { isOnline, isTabVisible };
}
