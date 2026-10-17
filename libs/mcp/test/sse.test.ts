import { Effect } from "effect";
import { describe, expect, it } from "vite-plus/test";

import { consumeSseStream, type SseEvent } from "../src/transports/streamable-http.ts";

const encoder = new TextEncoder();

const parsesChunkedEvents = Effect.gen(function* () {
  const chunks = [': keepalive\r\nid: 7\r\ndata: {"one":\r\n', "data: 1}\r\n\r\n"];
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
      controller.close();
    },
  });
  const events: SseEvent[] = [];
  yield* consumeSseStream(stream, { onEvent: (event) => events.push(event) });
  expect(events).toEqual([{ id: "7", data: '{"one":\n1}' }]);
});

const rejectsOversizedEvents = Effect.gen(function* () {
  let sent = 0;
  const stream = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (sent++ > 1000) controller.close();
      else controller.enqueue(encoder.encode("data: xxxxxxxxxxxxxxxx\n"));
    },
  });
  const error = yield* Effect.flip(
    consumeSseStream(stream, { maxEventBytes: 256, onEvent: () => undefined }),
  );
  expect(error.message).toContain("MCP SSE event exceeds 256 bytes");
  expect(sent).toBeLessThan(100);
});

describe("consumeSseStream", () => {
  it("parses chunked CRLF events, comments, IDs, and multiline data", () =>
    Effect.runPromise(parsesChunkedEvents));
  it("rejects events whose data lines exceed the limit without a blank line", () =>
    Effect.runPromise(rejectsOversizedEvents));
});
