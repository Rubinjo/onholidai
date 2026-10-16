"use client";
import { useSyncExternalStore } from "react";
const subscribe = () => () => {};
// Server-rendered POST controls must not look actionable before their client
// handlers exist. The server snapshot remains stable through hydration.
export function useHydrated() {
  return useSyncExternalStore(subscribe, () => true, () => false);
}
