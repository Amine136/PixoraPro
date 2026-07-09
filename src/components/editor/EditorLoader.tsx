"use client";

import dynamic from "next/dynamic";

/**
 * Fabric.js needs a real DOM, so the editor is loaded client-side only.
 */
const Editor = dynamic(() => import("./Editor"), {
  ssr: false,
  loading: () => (
    <div className="flex h-dvh w-full items-center justify-center bg-[#09090b]">
      <div className="flex items-center gap-3 text-sm text-zinc-500">
        <span className="size-2 animate-pulse rounded-full bg-indigo-400" />
        Loading Pixora…
      </div>
    </div>
  ),
});

export default function EditorLoader() {
  return <Editor />;
}
