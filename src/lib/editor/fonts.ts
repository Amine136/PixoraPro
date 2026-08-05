/** Web fonts served by the Google Fonts stylesheet in app/layout.tsx.
 *  Family names must match that stylesheet exactly — Fabric resolves them
 *  through normal CSS font matching, so a name mismatch silently falls back
 *  to a default font. */
export const WEB_FONTS = [
  "Anton",
  "Bebas Neue",
  "Alfa Slab One",
  "Oswald",
  "Playfair Display",
  "Pacifico",
  "Caveat",
  "Montserrat",
  "Poppins",
];

let loading: Promise<void> | null = null;

/** Pull every editor web font into memory so Fabric measures text with the
 *  real font instead of a fallback (a swap after measuring leaves the text
 *  box sized for the wrong font). Safe to call repeatedly. */
export function loadEditorFonts(): Promise<void> {
  if (loading) return loading;
  if (typeof document === "undefined" || !document.fonts) {
    return Promise.resolve();
  }
  loading = Promise.allSettled(
    WEB_FONTS.flatMap((family) => [
      document.fonts.load(`16px "${family}"`),
      document.fonts.load(`bold 16px "${family}"`),
    ]),
  ).then(() => undefined);
  return loading;
}
