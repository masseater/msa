import type TranscriptCacheClass from "./transcripts.ts";

declare namespace transcriptsTypes {
  type TranscriptCache = (typeof TranscriptCacheClass)["prototype"];
}

export type { transcriptsTypes as default };
