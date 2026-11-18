'use client';
import { useSyncExternalStore } from 'react';

/** Tiny global store: any engine publishes "Scene N/total" and the top banner shows it. */
export type BatchProgress = { label: string; done: number; total: number } | null;
let state: BatchProgress = null;
const subs = new Set<() => void>();
export function setBatchProgress(p: BatchProgress) {
  if (state && p && state.label === p.label && state.done === p.done && state.total === p.total) return;
  state = p; subs.forEach((f) => f());
}
export function useBatchProgress(): BatchProgress {
  return useSyncExternalStore((f) => { subs.add(f); return () => { subs.delete(f); }; }, () => state, () => null);
}
