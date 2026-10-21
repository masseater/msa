import { Effect } from "effect";
import { dual } from "effect/Function";

import foreignModule from "../foreign.ts";
import type foreignTypes from "../foreign.types.ts";
import type sseTypes from "./sse.types.ts";
import transport from "./transport.ts";

const { DEFAULT_MAX_MESSAGE_BYTES } = transport;
const { fromPromise, fromSync } = foreignModule;

const exceeded = (maxEventBytes: number): Error =>
  new Error(`MCP SSE event exceeds ${maxEventBytes} bytes`);

class SseParser {
  private options: sseTypes.ConsumeSseOptions;
  private maxEventBytes: number;
  private buffered = "";
  private eventName: string | undefined;
  private eventId: string | undefined;
  private dataLines: string[] = [];
  private dataBytes = 0;

  constructor(options: sseTypes.ConsumeSseOptions) {
    this.options = options;
    this.maxEventBytes = options.maxEventBytes ?? DEFAULT_MAX_MESSAGE_BYTES;
  }

  push(text: string): void {
    this.buffered += text;
    let newline = this.buffered.indexOf("\n");
    while (newline >= 0) {
      this.processLine(this.buffered.slice(0, newline));
      this.buffered = this.buffered.slice(newline + 1);
      newline = this.buffered.indexOf("\n");
    }
    if (Buffer.byteLength(this.buffered) > this.maxEventBytes) throw exceeded(this.maxEventBytes);
  }

  end(text: string): void {
    this.buffered += text;
    if (this.buffered !== "") this.processLine(this.buffered);
    this.dispatch();
  }

  private dispatch(): void {
    if (this.dataLines.length > 0) {
      const { eventName, eventId } = this;
      this.options.onEvent({
        ...(eventName !== undefined && eventName !== "" ? { event: eventName } : {}),
        data: this.dataLines.join("\n"),
        ...(eventId !== undefined && eventId !== "" ? { id: eventId } : {}),
      });
      this.dataLines = [];
      this.dataBytes = 0;
    }
    this.eventName = undefined;
    this.eventId = undefined;
  }

  private processField(field: string, value: string): void {
    if (field === "data") {
      this.dataBytes += Buffer.byteLength(value) + (this.dataLines.length > 0 ? 1 : 0);
      if (this.dataBytes > this.maxEventBytes) throw exceeded(this.maxEventBytes);
      this.dataLines.push(value);
    } else if (field === "event") this.eventName = value;
    else if (field === "id" && !value.includes("\0")) {
      this.eventId = value;
      this.options.onId?.(value);
    } else if (field === "retry" && /^\d+$/u.test(value)) this.options.onRetry?.(Number(value));
  }

  private processLine(rawLine: string): void {
    const line = rawLine.endsWith("\r") ? rawLine.slice(0, -1) : rawLine;
    if (line === "") {
      this.dispatch();
      return;
    }
    if (line.startsWith(":")) return;
    const colon = line.indexOf(":");
    const value = colon < 0 ? "" : line.slice(colon + 1);
    this.processField(
      colon < 0 ? line : line.slice(0, colon),
      value.startsWith(" ") ? value.slice(1) : value,
    );
  }
}

const consume = (
  stream: ReadableStream<Uint8Array>,
  options: sseTypes.ConsumeSseOptions,
): Effect.Effect<void, foreignTypes.McpForeignError> =>
  Effect.suspend(() => {
    const reader = stream.getReader();
    const decoder = new TextDecoder();
    const parser = new SseParser(options);
    return Effect.gen(function* () {
      while (true) {
        const chunk = yield* fromPromise(() => reader.read());
        if (chunk.done) break;
        const { value } = chunk;
        yield* fromSync(() => parser.push(decoder.decode(value, { stream: true })));
      }
      yield* fromSync(() => parser.end(decoder.decode()));
    }).pipe(Effect.ensuring(Effect.sync(() => reader.releaseLock())));
  });

const consumeSseStream: {
  (
    options: sseTypes.ConsumeSseOptions,
  ): (stream: ReadableStream<Uint8Array>) => Effect.Effect<void, foreignTypes.McpForeignError>;
  (
    stream: ReadableStream<Uint8Array>,
    options: sseTypes.ConsumeSseOptions,
  ): Effect.Effect<void, foreignTypes.McpForeignError>;
} = dual(2, consume);

const sse = {
  consumeSseStream,
};

export default sse;
