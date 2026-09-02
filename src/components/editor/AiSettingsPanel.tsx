"use client";

import { useState } from "react";
import { Check, ExternalLink, Loader2, Trash2 } from "lucide-react";
import {
  looksLikeApiKey,
  maskKey,
  PROVIDERS,
  useAiSettings,
  type ProviderId,
} from "@/lib/agent/settings";
import { verifyKey } from "@/lib/agent/providers";

interface AiSettingsPanelProps {
  /** Called once a key has been saved, so the parent can collapse the panel. */
  onSaved?: () => void;
}

/* Provider, API key and model — the whole BYOK setup in one place.
 *
 * The key is validated against the provider before being stored, so a typo
 * surfaces here rather than as a failed edit several seconds later. */
export function AiSettingsPanel({ onSaved }: AiSettingsPanelProps) {
  const {
    apiKey,
    hasKey,
    provider,
    providerInfo,
    saveApiKey,
    clearApiKey,
    saveProvider,
  } = useAiSettings();

  // Starts blank even when a key exists: the stored value is shown masked
  // above, and a blank field makes "replace" unambiguous.
  const [draft, setDraft] = useState("");
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    const value = draft.trim();
    if (!value || checking) return;
    if (!looksLikeApiKey(value)) {
      setError("That doesn't look like an API key — check for a partial paste.");
      return;
    }
    setChecking(true);
    setError(null);
    const failure = await verifyKey(provider, value);
    setChecking(false);
    if (failure) {
      setError(failure);
      return;
    }
    saveApiKey(value);
    setDraft("");
    onSaved?.();
  };

  const selectClass =
    "w-full rounded-lg border border-white/[0.08] bg-zinc-950/60 px-2.5 py-2 text-[11px] text-zinc-200 focus:border-indigo-500/60 focus:outline-none disabled:opacity-50";

  return (
    <div className="flex flex-col gap-3">
      {/* Provider */}
      <div className="flex flex-col gap-1.5">
        <label
          htmlFor="ai-provider"
          className="text-[10px] font-semibold uppercase tracking-widest text-zinc-500"
        >
          Provider
        </label>
        <select
          id="ai-provider"
          value={provider}
          onChange={(e) => {
            saveProvider(e.target.value as ProviderId);
            setDraft("");
            setError(null);
          }}
          className={selectClass}
        >
          {Object.values(PROVIDERS).map((p) => (
            <option key={p.id} value={p.id}>
              {p.label}
            </option>
          ))}
        </select>
      </div>

      {/* API key */}
      <div className="flex flex-col gap-1.5">
        <label
          htmlFor="ai-api-key"
          className="text-[10px] font-semibold uppercase tracking-widest text-zinc-500"
        >
          API key
        </label>

        {hasKey && (
          <div className="flex items-center gap-2 rounded-lg border border-emerald-500/20 bg-emerald-500/10 px-2.5 py-2">
            <Check className="size-3.5 shrink-0 text-emerald-400" />
            <span className="flex-1 truncate font-mono text-[11px] text-emerald-100">
              {maskKey(apiKey)}
            </span>
            <button
              type="button"
              onClick={clearApiKey}
              title="Delete key from this browser"
              aria-label="Delete key from this browser"
              className="flex size-6 items-center justify-center rounded-md text-red-300/70 transition-colors hover:bg-red-500/15 hover:text-red-300"
            >
              <Trash2 className="size-3.5" />
            </button>
          </div>
        )}

        <div className="flex items-center gap-2">
          <input
            id="ai-api-key"
            type="password"
            dir="ltr"
            autoComplete="off"
            spellCheck={false}
            value={draft}
            onChange={(e) => {
              setDraft(e.target.value);
              setError(null);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                void submit();
              }
            }}
            placeholder={hasKey ? "Paste a new key to replace" : providerInfo.keyPlaceholder}
            disabled={checking}
            aria-invalid={error ? true : undefined}
            aria-describedby={error ? "ai-api-key-error" : undefined}
            className="min-w-0 flex-1 rounded-lg border border-white/[0.08] bg-zinc-950/60 px-2.5 py-2 font-mono text-[11px] text-zinc-200 placeholder:text-zinc-600 focus:border-indigo-500/60 focus:outline-none disabled:opacity-60"
          />
          <button
            type="button"
            onClick={() => void submit()}
            disabled={!draft.trim() || checking}
            className="flex shrink-0 items-center gap-1.5 rounded-lg bg-indigo-500/80 px-3 py-2 text-[11px] font-medium text-white transition-colors hover:bg-indigo-500 disabled:opacity-40"
          >
            {checking && <Loader2 className="size-3 animate-spin" />}
            {checking ? "Checking" : "Save"}
          </button>
        </div>

        {error && (
          <p
            id="ai-api-key-error"
            role="alert"
            className="rounded-lg bg-red-500/10 px-2.5 py-1.5 text-[11px] leading-relaxed text-red-300"
          >
            {error}
          </p>
        )}

        <p className="text-[10px] leading-relaxed text-zinc-500">
          Your key is saved only in this browser and sent only to{" "}
          {providerInfo.label} — never to our servers. Only you use it, and you
          can delete it any time.{" "}
          <a
            href={providerInfo.keyUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-0.5 text-indigo-400 underline decoration-dotted hover:text-indigo-300"
          >
            Get a key
            <ExternalLink className="size-2.5" />
          </a>
        </p>
      </div>
    </div>
  );
}
