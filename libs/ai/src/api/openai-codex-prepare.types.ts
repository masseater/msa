import type typesModule from "../types.types.ts";
import type openaiCodexStreamRunTypes from "./openai-codex-stream-run.types.ts";

declare namespace openaiCodexPrepareTypes {
  interface CodexRunRequest extends Pick<
    openaiCodexStreamRunTypes.CodexStreamRun,
    "model" | "output" | "events" | "options"
  > {
    readonly context: typesModule.TranscriptContext;
  }
}

export type { openaiCodexPrepareTypes as default };
