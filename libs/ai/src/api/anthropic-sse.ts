import type { BetaRawMessageStreamEvent as RawMessageStreamEvent } from "@anthropic-ai/sdk/resources/beta/messages/messages.js";
import { Effect, Stream } from "effect";

import { toErrorMessage } from "../utils/errors.ts";
import { parseJsonWithRepair } from "../utils/json-parse.ts";

interface ServerSentEvent {
  event: string | null;
  data: string;
  raw: string[];
}

interface SseDecoderState {
  event: string | null;
  data: string[];
  raw: string[];
}

const ANTHROPIC_MESSAGE_EVENTS: ReadonlySet<string> = new Set([
  "message_start",
  "message_delta",
  "message_stop",
  "content_block_start",
  "content_block_delta",
  "content_block_stop",
]);

function flushSseEvent(state: SseDecoderState): ServerSentEvent | null {
  if ((state.event === null || state.event === "") && state.data.length === 0) {
    return null;
  }

  const event: ServerSentEvent = {
    event: state.event,
    data: state.data.join("\n"),
    raw: [...state.raw],
  };
  state.event = null;
  state.data = [];
  state.raw = [];
  return event;
}

function decodeSseLine(line: string, state: SseDecoderState): ServerSentEvent | null {
  if (line === "") {
    return flushSseEvent(state);
  }

  state.raw.push(line);
  if (line.startsWith(":")) {
    return null;
  }

  const delimiterIndex = line.indexOf(":");
  const fieldName = delimiterIndex === -1 ? line : line.slice(0, delimiterIndex);
  let value = delimiterIndex === -1 ? "" : line.slice(delimiterIndex + 1);
  if (value.startsWith(" ")) {
    value = value.slice(1);
  }

  if (fieldName === "event") {
    state.event = value;
  } else if (fieldName === "data") {
    state.data.push(value);
  }

  return null;
}

function nextLineBreakIndex(text: string): number {
  const carriageReturnIndex = text.indexOf("\r");
  const newlineIndex = text.indexOf("\n");
  if (carriageReturnIndex === -1) {
    return newlineIndex;
  }
  if (newlineIndex === -1) {
    return carriageReturnIndex;
  }
  return Math.min(carriageReturnIndex, newlineIndex);
}

function consumeLine(text: string): { line: string; rest: string } | null {
  const lineBreakIndex = nextLineBreakIndex(text);
  if (lineBreakIndex === -1) {
    return null;
  }

  let nextIndex = lineBreakIndex + 1;
  if (text[lineBreakIndex] === "\r" && text[nextIndex] === "\n") {
    nextIndex += 1;
  }

  return {
    line: text.slice(0, lineBreakIndex),
    rest: text.slice(nextIndex),
  };
}

interface SseAccumulator {
  readonly buffer: string;
  readonly state: SseDecoderState;
}

const consumeSseLines = (
  { buffer, state }: SseAccumulator,
  text: string,
): readonly [SseAccumulator, ReadonlyArray<ServerSentEvent>] => {
  const events: ServerSentEvent[] = [];
  let rest = buffer + text;
  let consumed = consumeLine(rest);
  while (consumed !== null) {
    rest = consumed.rest;
    const event = decodeSseLine(consumed.line, state);
    if (event !== null) events.push(event);
    consumed = consumeLine(rest);
  }
  return [{ buffer: rest, state }, events];
};

const finishSseLines = ({ buffer, state }: SseAccumulator): ReadonlyArray<ServerSentEvent> => {
  const events: ServerSentEvent[] = [];
  if (buffer.length > 0) {
    const event = decodeSseLine(buffer, state);
    if (event !== null) events.push(event);
  }
  const trailingEvent = flushSseEvent(state);
  if (trailingEvent !== null) events.push(trailingEvent);
  return events;
};

function iterateSseMessages(
  body: ReadableStream<Uint8Array>,
  signal?: AbortSignal,
): Stream.Stream<ServerSentEvent> {
  const decoder = new TextDecoder();
  const throwIfAborted = Effect.sync(() => {
    if (signal?.aborted === true) throw new Error("Request was aborted");
  });
  const chunks = Stream.fromReadableStream({
    evaluate: () => body,
    onError: (error) => error,
    releaseLockOnEnd: true,
  }).pipe(
    Stream.orDie,
    Stream.mapEffect((value) => Effect.as(throwIfAborted, decoder.decode(value, { stream: true }))),
  );
  return Stream.fromEffect(throwIfAborted).pipe(
    Stream.drain,
    Stream.concat(chunks),
    Stream.concat(Stream.sync(() => decoder.decode())),
    Stream.mapAccum(
      (): SseAccumulator => ({ buffer: "", state: { event: null, data: [], raw: [] } }),
      consumeSseLines,
      { onHalt: finishSseLines },
    ),
  );
}

const parseAnthropicEvent = (sse: ServerSentEvent): RawMessageStreamEvent | undefined => {
  if (sse.event === "error") {
    throw new Error(sse.data);
  }
  if (!ANTHROPIC_MESSAGE_EVENTS.has(sse.event ?? "")) return undefined;
  try {
    return parseJsonWithRepair<RawMessageStreamEvent>(sse.data);
  } catch (error) {
    const message = toErrorMessage(error);
    throw new Error(
      `Could not parse Anthropic SSE event ${sse.event}: ${message}; data=${sse.data}; raw=${sse.raw.join("\\n")}`,
      { cause: error },
    );
  }
};

interface IterateAnthropicEventsInput {
  readonly response: Response;
  readonly signal?: AbortSignal | undefined;
}

function iterateAnthropicEvents(
  input: IterateAnthropicEventsInput,
): Stream.Stream<RawMessageStreamEvent> {
  const { response, signal } = input;
  const body = response.body;
  if (body === null) {
    return Stream.die(new Error("Attempted to iterate over an Anthropic response with no body"));
  }
  return Stream.suspend(() => {
    let sawMessageStart = false;
    let sawMessageEnd = false;
    return iterateSseMessages(body, signal).pipe(
      Stream.map(parseAnthropicEvent),
      Stream.filter((event) => event !== undefined),
      Stream.tap((event) =>
        Effect.sync(() => {
          if (event.type === "message_start") sawMessageStart = true;
          else if (event.type === "message_stop") sawMessageEnd = true;
        }),
      ),
      Stream.concat(
        Stream.fromEffect(
          Effect.sync(() => {
            if (sawMessageStart && !sawMessageEnd) {
              throw new Error("Anthropic stream ended before message_stop");
            }
          }),
        ).pipe(Stream.drain),
      ),
    );
  });
}

function describeThrown(error: unknown): string {
  return error instanceof Error ? error.message : JSON.stringify(error);
}

export { describeThrown, iterateAnthropicEvents };
