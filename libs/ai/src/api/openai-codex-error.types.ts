import type openaiCodexError from "./openai-codex-error.ts";

declare namespace openaiCodexErrorTypes {
  interface CodexProtocolFailure {
    readonly source: "SSE" | "WebSocket";
    readonly cause: unknown;
    readonly payload: unknown;
  }

  type CodexStreamError = (typeof openaiCodexError.CodexStreamError)["prototype"];
}

export type { openaiCodexErrorTypes as default };
