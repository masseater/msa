import assert from "node:assert/strict";
import { createRequire } from "node:module";

import { Cause, Console, Effect, Fiber, Schedule, Schema } from "effect";

import { readFileString, sha256Hex } from "../test-platform.ts";

type ClipboardValue = string | Buffer | null | undefined;

type ClipboardReader = Record<string, () => unknown>;

const require = createRequire(import.meta.url);
const toJson = Schema.encodeEffect(Schema.fromJsonString(Schema.Unknown));

const read = Effect.gen(function* () {
  const helper: ClipboardReader = require(process.argv[2] ?? "");
  const pending = helper[process.argv[3] ?? ""]?.();
  assert.ok(pending instanceof Promise, "Native reads must return promises");
  const value: ClipboardValue = yield* Effect.promise((): Promise<ClipboardValue> => pending);
  const bytes =
    typeof value === "string" || Buffer.isBuffer(value) ? Buffer.from(value) : undefined;
  const hash = bytes === undefined ? undefined : yield* sha256Hex(bytes);
  yield* Console.log(
    yield* toJson({
      ok: true,
      value:
        value === null || (typeof value === "string" && value.length <= 100) ? value : undefined,
      unavailable: value === undefined || undefined,
      length: bytes?.length,
      hash,
    }),
  );
}).pipe(
  Effect.catchCause((cause) =>
    toJson({ ok: false, error: String(Cause.squash(cause)) }).pipe(Effect.flatMap(Console.log)),
  ),
);

const program = Effect.gen(function* () {
  let ticks = 0;
  const ticker = yield* Effect.forkDetach(
    Effect.sync(() => ticks++).pipe(Effect.repeat(Schedule.spaced(10)), Effect.delay(10)),
  );
  const started = performance.now();
  yield* read.pipe(
    Effect.ensuring(
      Effect.gen(function* () {
        yield* Fiber.interrupt(ticker);
        if (performance.now() - started > 200)
          assert.ok(ticks > 5, "Clipboard I/O must not block the JS event loop");
        const children = yield* readFileString(`/proc/self/task/${process.pid}/children`);
        assert.equal(children.trim(), "");
      }),
    ),
  );
}).pipe(
  Effect.catchCause((cause) =>
    Console.error(Cause.squash(cause)).pipe(
      Effect.andThen(
        Effect.sync(() => {
          process.exitCode = 1;
        }),
      ),
    ),
  ),
);

Effect.runFork(program);
