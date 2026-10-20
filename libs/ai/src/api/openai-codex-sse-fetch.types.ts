import type openaiCodexStreamRunTypes from "./openai-codex-stream-run.types.ts";

declare namespace openaiCodexSseFetchTypes {
  interface CodexSseRequest {
    readonly run: openaiCodexStreamRunTypes.CodexStreamRun;
    readonly body: Uint8Array<ArrayBuffer> | string;
    readonly maxRetries: number;
  }
}

export type { openaiCodexSseFetchTypes as default };
