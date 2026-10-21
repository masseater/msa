import { type Server, createServer } from "node:net";

import { Effect, ManagedRuntime } from "effect";
import { FetchHttpClient, HttpClient } from "effect/http";
import { afterEach, describe, expect, it } from "vite-plus/test";

import testing from "../src/index.ts";

const { closeServers, listen, runTest } = testing;

const squatters: Server[] = [];

const squat = (port: number) =>
  Effect.callback<void>((resume) => {
    const squatter = createServer((socket) => socket.destroy());
    squatters.push(squatter);
    squatter.once("error", () => resume(Effect.void));
    squatter.listen(port, "127.0.0.1", () => resume(Effect.void));
  });

const closeSquatters = Effect.suspend(() =>
  Effect.forEach(
    squatters.splice(0),
    (squatter) =>
      Effect.callback<void>((resume) => {
        if (!squatter.listening) return resume(Effect.void);
        squatter.close(() => resume(Effect.void));
      }),
    { discard: true },
  ),
);

const client = ManagedRuntime.make(FetchHttpClient.layer);

const getText = (url: string) =>
  Effect.promise(() =>
    client.runPromise(HttpClient.get(url).pipe(Effect.flatMap((response) => response.text))),
  );

afterEach(() => runTest(Effect.andThen(closeSquatters, closeServers)));

describe("listen", () => {
  it("keeps its origin when another socket asks for the same loopback port", () =>
    runTest(
      Effect.gen(function* () {
        const origin = yield* listen(() => Effect.succeed(new Response("served")));
        yield* squat(Number(new URL(origin).port));
        expect(yield* getText(origin)).toBe("served");
      }),
    ));
});
