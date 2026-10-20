import type asyncEventStreamTypes from "./utils/async-event-stream.types.ts";
import type diagnosticsTypes from "./utils/diagnostics.types.ts";
import type eventStreamTypes from "./utils/event-stream.types.ts";
import type retryTypes from "./utils/retry.types.ts";
import type transcriptTypes from "./utils/transcript.types.ts";

declare namespace aiTypesPart5 {
  type DiagnosticErrorInfo = diagnosticsTypes.DiagnosticErrorInfo;
  type AssistantMessageDiagnostic = diagnosticsTypes.AssistantMessageDiagnostic;
  type EventChannelOptions<T, R> = eventStreamTypes.EventChannelOptions<T, R>;
  type EventChannel<T, R> = eventStreamTypes.EventChannel<T, R>;
  type RetryPolicy = retryTypes.RetryPolicy;
  type RetryCallbacks = retryTypes.RetryCallbacks;
  type TranscriptMessages = transcriptTypes.TranscriptMessages;
  type ToolStateChanges = transcriptTypes.ToolStateChanges;
  type TranscriptTools = transcriptTypes.TranscriptTools;
  type AssistantMessageEventStream = eventStreamTypes.AssistantMessageEventStream;
  type EventStream<T, R = T> = asyncEventStreamTypes.EventStream<T, R>;
}

export type { aiTypesPart5 as default };
