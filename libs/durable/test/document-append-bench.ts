import * as NodeRuntime from "@effect/platform-node/NodeRuntime";
import contextModule from "@msa/chord/context";
import { Console, Effect } from "effect";

import documents from "../src/documents.ts";
import createSessionModule from "../src/session/create-session.ts";
import memory from "../src/storage/memory.ts";
import effectSupport from "./effect-support.ts";

const { BACKGROUND_CONTEXT: context } = contextModule;

const { defineDoc, defineDocFamily } = documents;
const { createSession } = createSessionModule;
const { MemoryStorage } = memory;

const { awaited } = effectSupport;

type Entry = { key: string; issued: number; at: number };

const Journal = defineDoc<{ entries: Entry[] }>({
  initial: () => ({ entries: [] }),
  kind: "bench.journal",
  scope: "session",
  version: 1,
});

const Member = defineDocFamily<{ issued: number; at: number }, null>({
  family: true,
  initial: () => ({ at: 0, issued: 0 }),
  kind: "bench.member",
  scope: "session",
  version: 1,
});

const run = Effect.fn("run")(function* (kind: "array" | "family", n: number) {
  const runPromise = Effect.runPromiseWith(yield* Effect.context<never>());

  const session = createSession(new MemoryStorage());
  const started = performance.now();
  for (const i of Array.from({ length: n }, (_, iInner) => iInner)) {
    yield* awaited(
      session.commit(
        (tx) =>
          runPromise(
            Effect.gen(function* () {
              if (kind === "array")
                (yield* awaited(tx.doc(Journal))).entries.push({ at: i, issued: i, key: `c${i}` });
              else
                Object.assign(yield* awaited(tx.doc(Member, `c${i}`, null)), { at: i, issued: i });
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
