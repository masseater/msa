import * as NodeRuntime from "@effect/platform-node/NodeRuntime";
import { BACKGROUND_CONTEXT as context } from "@msa/chord/context";
import { Console, Effect } from "effect";

import { defineDoc, defineDocFamily } from "../src/documents.ts";
import { createSession } from "../src/session/create-session.ts";
import { MemoryStorage } from "../src/storage/memory.ts";
import { awaited } from "./effect-support.ts";

type Entry = { key: string; issued: number; at: number };

const Journal = defineDoc<{ entries: Entry[] }>({
  kind: "bench.journal",
  version: 1,
  scope: "session",
  initial: () => ({ entries: [] }),
});

const Member = defineDocFamily<{ issued: number; at: number }, null>({
  kind: "bench.member",
  version: 1,
  scope: "session",
  family: true,
  initial: () => ({ issued: 0, at: 0 }),
});

const run = Effect.fn("run")(function* (kind: "array" | "family", n: number) {
  const runPromise = Effect.runPromiseWith(yield* Effect.context<never>());

  const session = createSession(new MemoryStorage());
  const started = performance.now();
  for (const i of Array.from({ length: n }, (_, i) => i)) {
    yield* awaited(
      session.commit(
        (tx) =>
          runPromise(
            Effect.gen(function* () {
              if (kind === "array")
                (yield* awaited(tx.doc(Journal))).entries.push({ key: `c${i}`, issued: i, at: i });
              else
                Object.assign(yield* awaited(tx.doc(Member, `c${i}`, null)), { issued: i, at: i });
            }),
          ),
        context,
      ),
    );
  }
  const ms = performance.now() - started;
  yield* awaited(session.close(context));
  return ms;
});

const sizes = (process.argv[2] ?? "1000,8000,16000,32000").split(",").map(Number);

const main = Effect.gen(function* () {
  for (const n of sizes) {
    const array = yield* run("array", n);
    const family = yield* run("family", n);
    const per = (ms: number) => `${((ms / n) * 1000).toFixed(0)} µs`;
    yield* Console.log(
      `n=${n}: array ${array.toFixed(0)} ms (${per(array)}/append), family ${family.toFixed(0)} ms (${per(family)}/append)`,
    );
  }
});

NodeRuntime.runMain(main);
