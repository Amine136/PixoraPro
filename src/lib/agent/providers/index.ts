import type { ProviderId } from "../settings";
import { verifyDeepSeekKey } from "./deepseek";
import { verifyGeminiKey } from "./gemini";
import { verifyOpenAiKey } from "./openai";

/** Validate a key against whichever provider the user selected. Returns null on
 *  success, or a human-readable reason on failure. */
export function verifyKey(
  provider: ProviderId,
  key: string,
): Promise<string | null> {
  if (provider === "openai") return verifyOpenAiKey(key);
  if (provider === "deepseek") return verifyDeepSeekKey(key);
  return verifyGeminiKey(key);
}
