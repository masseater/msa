import { Cause, Effect, Stream } from "effect";

import { codexProtocolError, throwIfRequestAborted } from "./openai-codex-error.ts";

export type CodexRawEvent = Record<string, unknown>;

function parseCodexSseChunk(chunk: string): CodexRawEvent | undefined {
  const dataLines = chunk
    .split("\n")
    .filter((line) => line.startsWith("data:"))
    .map((line) => line.slice(5).trim());
  if (dataLines.length === 0) return undefined;
  const data = dataLines.join("\n").trim();
  if (data === "" || data === "[DONE]") return undefined;
  try {
    return JSON.parse(data) as CodexRawEvent;
  } catch (cause) {
    throw codexProtocolError({ source: "SSE", cause, payload: data });
  }
}

function splitCodexSseChunks(buffer: string): readonly [string, ReadonlyArray<string>] {
  const chunks = buffer.split("\n\n");
  const rest = chunks.pop() ?? "";
  return [rest, chunks];
}

const openCodexSseReader = (body: ReadableStream<Uint8Array>, signal: AbortSignal | undefined) =>
  Effect.acquireRelease(
    Effect.sync(() => {
      const reader = body.getReader();
      const onAbort = () => {
        void reader.cancel().catch(() => undefined);
      };
      signal?.addEventListener("abort", onAbort, { once: true });
      return { reader, onAbort };
    }),
    ({ reader, onAbort }) =>
      Effect.sync(() => signal?.removeEventListener("abort", onAbort)).pipe(
        Effect.andThen(Effect.promise(() => reader.cancel().catch(() => undefined))),
        Effect.andThen(Effect.sync(() => reader.releaseLock())),
      ),
  );

const readCodexSseBytes = (
  body: ReadableStream<Uint8Array>,
  signal: AbortSignal | undefined,
): Stream.Stream<Uint8Array> =>
  Stream.unwrap(
    openCodexSseReader(body, signal).pipe(
      Effect.map(({ reader }) =>
        Stream.fromEffectRepeat(
          Effect.suspend(() => {
            throwIfRequestAborted(signal);
            return Effect.promise(() => reader.read());
          }).pipe(
            Effect.flatMap(({ done, value }) => {
              throwIfRequestAborted(signal);
              return done ? Cause.done() : Effect.succeed(value);
            }),
          ),
        ),
      ),
    ),
  );

export function readCodexSseEvents(
  signal: AbortSignal | undefined,
): (response: Response) => Stream.Stream<CodexRawEvent> {
  return (response) => {
    const body = response.body;
    if (body === null) return Stream.empty;
    const decoder = new TextDecoder();
    return readCodexSseBytes(body, signal).pipe(
      Stream.map((value) => decoder.decode(value, { stream: true })),
      Stream.concat(Stream.sync(() => decoder.decode())),
      Stream.mapAccum(
        () => "",
        (buffer, text: string) => splitCodexSseChunks(buffer + text),
        { onHalt: (buffer) => (buffer.trim() === "" ? [] : [buffer]) },
      ),
      Stream.map(parseCodexSseChunk),
      Stream.filter((event): event is CodexRawEvent => event !== undefined),
    );
  };
}
