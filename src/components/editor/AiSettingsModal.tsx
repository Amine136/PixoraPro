"use client";

import { useEffect } from "react";
import { KeyRound, X } from "lucide-react";
import { AiSettingsPanel } from "./AiSettingsPanel";

interface AiSettingsModalProps {
  open: boolean;
  onClose: () => void;
}

/* Pixora Pro Agent settings as a standalone modal — opened from the top bar
 * (and the agent header), not nested inside the chat window. */
export function AiSettingsModal({ open, onClose }: AiSettingsModalProps) {
  useEffect(() => {
    if (!open) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-in fade-in duration-150"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label="Pixora Pro Agent settings"
    >
      <div
        className="w-full max-w-sm rounded-2xl border border-white/[0.1] bg-zinc-900/95 p-4 shadow-2xl shadow-black/80 backdrop-blur-2xl animate-in zoom-in-95 duration-150"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-white/[0.06] pb-3 mb-3">
          <div className="flex items-center gap-2">
            <KeyRound className="size-4 text-indigo-400" />
            <h3 className="text-xs font-semibold uppercase tracking-widest text-zinc-300">
              Pixora Pro Agent Settings
            </h3>
          </div>
          <button
            type="button"
            onClick={onClose}
            title="Close"
            aria-label="Close"
            className="flex size-6 items-center justify-center rounded-md text-zinc-500 hover:bg-zinc-800 hover:text-zinc-200"
          >
            <X className="size-4" />
          </button>
        </div>

        <AiSettingsPanel />
      </div>
    </div>
  );
}
