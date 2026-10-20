import platform from "../../core/platform.ts";
import interop from "../../utils/interop.ts";
import client from "./client.ts";
import type clientTypes from "./client.types.ts";

const { callbackPromise } = interop;
const { schedule } = platform;
const { formatBytes } = client;

function errorMessage(payload: unknown, fallback: string): string {
  if (typeof payload !== "object" || payload === null) return fallback;
  const error = (payload as { error?: unknown }).error;
  if (typeof error !== "object" || error === null) return fallback;
  const message = (error as { message?: unknown }).message;
  return typeof message === "string" && message !== "" ? message : fallback;
}

function isModelInfo(value: unknown): value is clientTypes.LlamaModelInfo {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as { id?: unknown; status?: { value?: unknown } };
  return typeof candidate.id === "string" && typeof candidate.status?.value === "string";
}

function linkSignal(source: AbortSignal | undefined, target: AbortController): () => void {
  if (source === undefined) return () => {};
  if (source.aborted) {
    target.abort(source.reason);
    return () => {};
  }
  const abort = () => target.abort(source.reason);
  source.addEventListener("abort", abort, { once: true });
  return () => source.removeEventListener("abort", abort);
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return callbackPromise<void>((resolve, reject) => {
    if (signal?.aborted === true) {
      reject(signal.reason ?? new Error("Cancelled"));
      return;
    }
    const abort = () => {
      timer.cancel();
      reject(signal?.reason ?? new Error("Cancelled"));
    };
    const timer = schedule(() => {
      signal?.removeEventListener("abort", abort);
      resolve();
    }, ms);
    signal?.addEventListener("abort", abort, { once: true });
  });
}

function parseModelEvent(data: string): clientTypes.LlamaModelEvent | undefined {
  try {
    const event = JSON.parse(data) as clientTypes.LlamaModelEvent;
    return typeof event?.model === "string" && typeof event.event === "string" ? event : undefined;
  } catch {
    return undefined;
  }
}

function parseLoadProgress(data: unknown): clientTypes.LlamaProgress | undefined {
  if (typeof data !== "object" || data === null) return undefined;
  const progress = (data as { progress?: unknown }).progress;
  if (typeof progress !== "object" || progress === null) return undefined;
  const value = progress as {
    stages?: unknown;
    current?: unknown;
    stage?: unknown;
    value?: unknown;
  };
  const stage =
    typeof value.current === "string"
      ? value.current
      : typeof value.stage === "string"
        ? value.stage
        : undefined;
  const stages = Array.isArray(value.stages)
    ? value.stages.filter((entry): entry is string => typeof entry === "string")
    : [];
  const stageRatio =
    typeof value.value === "number" ? Math.max(0, Math.min(1, value.value)) : undefined;
  let ratio = stageRatio;
  if (stage !== undefined && stage !== "" && stages.length > 0) {
    const index = stages.indexOf(stage);
    if (index >= 0) ratio = (index + (stageRatio ?? 0)) / stages.length;
  }
  return {
    message:
      stage !== undefined && stage !== ""
        ? `Loading ${stage.replaceAll("_", " ")}`
        : "Loading model",
    ratio,
  };
}

function parseDownloadProgress(data: unknown): clientTypes.LlamaProgress | undefined {
  if (typeof data !== "object" || data === null) return undefined;
  const nested = (data as { progress?: unknown }).progress;
  const files = typeof nested === "object" && nested !== null ? nested : data;
  let done = 0;
  let total = 0;
  for (const value of Object.values(files as Record<string, unknown>)) {
    if (typeof value !== "object" || value === null) continue;
    const entry = value as { done?: unknown; total?: unknown };
    if (typeof entry.done !== "number" || typeof entry.total !== "number") continue;
    done += entry.done;
    total += entry.total;
  }
  if (total <= 0) return undefined;
  return {
    detail: `${formatBytes(done)} / ${formatBytes(total)}`,
    message: "Downloading model",
    ratio: done / total,
  };
}

const llamaClientHelpers = {
  errorMessage,
  isModelInfo,
  linkSignal,
  parseDownloadProgress,
  parseLoadProgress,
  parseModelEvent,
  sleep,
};

export default llamaClientHelpers;
