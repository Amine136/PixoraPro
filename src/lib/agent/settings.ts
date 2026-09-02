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
  model: "pixora.ai.model",
  provider: "pixora.ai.provider",
} as const;

/** API keys are stored per provider. */
const keyStorageKey = (provider: ProviderId) => `pixora.ai.apiKey.${provider}`;
/** The original single-provider build stored the Gemini key here. */
const LEGACY_GEMINI_KEY = "pixora.gemini.apiKey";

/** Broadcast within the tab; the `storage` event only fires in *other* tabs. */
const CHANGE_EVENT = "pixora:ai-settings-change";

export type ProviderId = "gemini" | "openai" | "deepseek";

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
  /** Placeholder shown in the key input (e.g. "AIza…" vs "sk-…"). */
  keyPlaceholder: string;
  models: ModelOption[];
  defaultModel: string;
}

export const PROVIDERS: Record<ProviderId, ProviderInfo> = {
  gemini: {
    id: "gemini",
    label: "Google Gemini",
    keyUrl: "https://aistudio.google.com/apikey",
    keyPlaceholder: "AIza…",
    // Default is the most capable model, not the cheapest: the agent drives 21
    // tools from screenshots, and a weaker model produces worse designs *and*
    // often burns more rounds getting there. The user pays either way.
    defaultModel: "gemini-3.8-flash",
    models: [
      {
        id: "gemini-3.8-flash",
        label: "Gemini 3.8 Flash",
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
  openai: {
    id: "openai",
    label: "OpenAI",
    keyUrl: "https://platform.openai.com/api-keys",
    keyPlaceholder: "sk-…",
    defaultModel: "gpt-5.5",
    models: [
      {
        id: "gpt-5.5",
        label: "GPT 5.5",
        hint: "Most capable — best design results",
      },
      {
        id: "gpt-5.6-luna",
        label: "GPT 5.6 Luna",
        hint: "Fastest and cheapest",
      },
      {
        id: "gpt-5.6-terra",
        label: "GPT 5.6 Terra",
        hint: "Balanced speed and quality",
      },
      {
        id: "gpt-5.6-sol",
        label: "GPT 5.6 Sol",
        hint: "State of the art — most expensive",
      },
    ],
  },
  deepseek: {
    id: "deepseek",
    label: "DeepSeek",
    keyUrl: "https://platform.deepseek.com/api_keys",
    keyPlaceholder: "sk-…",
    defaultModel: "deepseek-v4-flash-vision-exp",
    models: [
      {
        id: "deepseek-v4-flash-vision-exp",
        label: "DeepSeek V4 Flash Vision",
        hint: "Vision model — best design results",
      },
    ],
  },
};

export const DEFAULT_PROVIDER: ProviderId = "gemini";

function readRaw(name: string): string {
  if (typeof window === "undefined") return "";
  try {
    return window.localStorage.getItem(name)?.trim() ?? "";
  } catch {
    return ""; // storage blocked (private mode / disabled cookies)
  }
}

function writeRaw(name: string, value: string): void {
  if (typeof window === "undefined") return;
  const trimmed = value.trim();
  try {
    if (trimmed) window.localStorage.setItem(name, trimmed);
    else window.localStorage.removeItem(name);
  } catch {
    // ignore: subscribers still get the change event for this session
  }
  window.dispatchEvent(new Event(CHANGE_EVENT));
}

export function readApiKey(provider: ProviderId = readProvider()): string {
  const current = readRaw(keyStorageKey(provider));
  if (current) return current;
  // Migrate a key saved by the single-provider build.
  if (provider === "gemini") return readRaw(LEGACY_GEMINI_KEY);
  return "";
}

export function writeApiKey(
  key: string,
  provider: ProviderId = readProvider(),
): void {
  writeRaw(keyStorageKey(provider), key);
  // Drop the legacy slot once the user writes a key under the current build.
  if (provider === "gemini" && typeof window !== "undefined") {
    try {
      window.localStorage.removeItem(LEGACY_GEMINI_KEY);
    } catch {
      // ignore
    }
  }
}

export function readProvider(): ProviderId {
  const stored = readRaw(STORAGE_KEYS.provider);
  return stored in PROVIDERS ? (stored as ProviderId) : DEFAULT_PROVIDER;
}

export function writeProvider(id: ProviderId): void {
  writeRaw(STORAGE_KEYS.provider, id);
}

/** The selected model, always one the current provider actually offers. A model
 *  persisted by an older build (or a since-removed option) falls back to the
 *  default rather than being sent to the API, where it would 404. */
export function readModel(): string {
  const provider = PROVIDERS[readProvider()];
  const stored = readRaw(STORAGE_KEYS.model);
  return provider.models.some((m) => m.id === stored)
    ? stored
    : provider.defaultModel;
}

export function writeModel(model: string): void {
  writeRaw(STORAGE_KEYS.model, model);
}

/** Shape check only — the real test is a call to the provider (see verifyApiKey).
 *  Google issues several key formats (`AIza…`, `AQ.…`) and OpenAI uses `sk-…`,
 *  so this stays loose and only rejects input that cannot be a key at all. */
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
