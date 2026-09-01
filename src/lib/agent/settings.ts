"use client";

import { useCallback, useSyncExternalStore } from "react";

/* Bring-your-own-key AI settings: provider, model, and API key.
 *
 * All three live only in this browser (localStorage) and the key is sent only
 * to the provider's own API from the user's browser — it never reaches a Pixora
 * server. Trade-off: localStorage is readable by any script on this origin, so
 * an XSS bug would leak the key. That is acceptable for a user-supplied key
 * scoped to the user's own quota, and it is why the UI states plainly where the
 * key is kept and offers a delete button. */

const STORAGE_KEYS = {
  key: "pixora.gemini.apiKey",
  model: "pixora.ai.model",
  provider: "pixora.ai.provider",
} as const;

/** Broadcast within the tab; the `storage` event only fires in *other* tabs. */
const CHANGE_EVENT = "pixora:ai-settings-change";

export type ProviderId = "gemini";

export interface ModelOption {
  id: string;
  label: string;
  /** One line the user can actually choose on: capability vs. cost. */
  hint: string;
}

export interface ProviderInfo {
  id: ProviderId;
  label: string;
  /** Where the user goes to mint a key. */
  keyUrl: string;
  models: ModelOption[];
  defaultModel: string;
}

/* Only Gemini for now. The registry shape (rather than hardcoded ids) is what
 * lets a second provider be added without touching the transport or the UI. */
export const PROVIDERS: Record<ProviderId, ProviderInfo> = {
  gemini: {
    id: "gemini",
    label: "Google Gemini",
    keyUrl: "https://aistudio.google.com/apikey",
    // Default is the most capable model, not the cheapest: the agent drives 21
    // tools from screenshots, and a weaker model produces worse designs *and*
    // often burns more rounds getting there. The user pays either way.
    defaultModel: "gemini-3.7-flash",
    models: [
      {
        id: "gemini-3.7-flash",
        label: "Gemini 3.7 Flash",
        hint: "Most capable — best design results",
      },
      {
        id: "gemini-3.5-flash",
        label: "Gemini 3.5 Flash",
        hint: "Balanced speed and quality",
      },
      {
        id: "gemini-3.5-flash-lite",
        label: "Gemini 3.5 Flash Lite",
        hint: "Fastest and cheapest",
      },
    ],
  },
};

export const DEFAULT_PROVIDER: ProviderId = "gemini";

function read(name: keyof typeof STORAGE_KEYS): string {
  if (typeof window === "undefined") return "";
  try {
    return window.localStorage.getItem(STORAGE_KEYS[name])?.trim() ?? "";
  } catch {
    return ""; // storage blocked (private mode / disabled cookies)
  }
}

function write(name: keyof typeof STORAGE_KEYS, value: string): void {
  if (typeof window === "undefined") return;
  const trimmed = value.trim();
  try {
    if (trimmed) window.localStorage.setItem(STORAGE_KEYS[name], trimmed);
    else window.localStorage.removeItem(STORAGE_KEYS[name]);
  } catch {
    // ignore: subscribers still get the change event for this session
  }
  window.dispatchEvent(new Event(CHANGE_EVENT));
}

export function readApiKey(): string {
  return read("key");
}

export function writeApiKey(key: string): void {
  write("key", key);
}

export function readProvider(): ProviderId {
  const stored = read("provider");
  return stored in PROVIDERS ? (stored as ProviderId) : DEFAULT_PROVIDER;
}

export function writeProvider(id: ProviderId): void {
  write("provider", id);
}

/** The selected model, always one the current provider actually offers. A model
 *  persisted by an older build (or a since-removed option) falls back to the
 *  default rather than being sent to the API, where it would 404. */
export function readModel(): string {
  const provider = PROVIDERS[readProvider()];
  const stored = read("model");
  return provider.models.some((m) => m.id === stored)
    ? stored
    : provider.defaultModel;
}

export function writeModel(model: string): void {
  write("model", model);
}

/** Shape check only — the real test is a call to the provider (see verifyApiKey).
 *  Google issues several key formats (`AIza…`, `AQ.…`), so this stays loose and
 *  only rejects input that cannot be a key at all. */
export function looksLikeApiKey(key: string): boolean {
  const value = key.trim();
  return value.length >= 20 && !/\s/.test(value);
}

/** Mask for display: enough to recognise the key, never the whole thing. */
export function maskKey(key: string): string {
  const value = key.trim();
  if (value.length <= 8) return "•".repeat(value.length);
  return `${value.slice(0, 4)}…${value.slice(-4)}`;
}

/* ---------- reactive hook ---------- */

function subscribe(onChange: () => void): () => void {
  window.addEventListener(CHANGE_EVENT, onChange);
  window.addEventListener("storage", onChange);
  return () => {
    window.removeEventListener(CHANGE_EVENT, onChange);
    window.removeEventListener("storage", onChange);
  };
}

const serverKey = () => "";
const serverLoaded = () => false;
const clientLoaded = () => true;

/** Reactive view of the stored settings, kept in sync across tabs and
 *  components. Backed by useSyncExternalStore because localStorage is exactly
 *  that — an external store, read on demand rather than mirrored into state. */
export function useAiSettings() {
  // The server render sees no key, so the first paint matches the HTML; React
  // swaps in the real value on hydration. `loaded` distinguishes "not read yet"
  // from "read, and there is no key" so the UI doesn't flash a prompt.
  const apiKey = useSyncExternalStore(subscribe, readApiKey, serverKey);
  const provider = useSyncExternalStore(subscribe, readProvider, () => DEFAULT_PROVIDER);
  const model = useSyncExternalStore(subscribe, readModel, () =>
    PROVIDERS[DEFAULT_PROVIDER].defaultModel,
  );
  const loaded = useSyncExternalStore(subscribe, clientLoaded, serverLoaded);

  const saveApiKey = useCallback((next: string) => writeApiKey(next), []);
  const clearApiKey = useCallback(() => writeApiKey(""), []);
  const saveModel = useCallback((next: string) => writeModel(next), []);
  const saveProvider = useCallback((next: ProviderId) => writeProvider(next), []);

  return {
    apiKey,
    hasKey: apiKey.length > 0,
    provider,
    providerInfo: PROVIDERS[provider],
    model,
    loaded,
    saveApiKey,
    clearApiKey,
    saveModel,
    saveProvider,
  };
}
