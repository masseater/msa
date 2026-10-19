import { BACKGROUND_CONTEXT } from "@msa/chord/context";
import { Effect } from "effect";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import { getOrThrow } from "../src/env/index.ts";
import { NodeExecutionEnv } from "../src/env/node.ts";
import { awaited } from "./effect-support.ts";
import { joinPath, makeTempDir, removeDirs } from "./platform-support.ts";

const SPILL_WRITE_DELAY_MS = 600;
const spill = vi.hoisted(() => ({ rejectedWrites: 0 }));

type SpillStream = { write: (...args: unknown[]) => boolean };
type FsModule = { createWriteStream: (path: unknown, options?: unknown) => SpillStream };

vi.mock("node:fs", (importOriginal) =>
  Promise.all([importOriginal<FsModule>(), import("effect")]).then(([actual, { Effect }]) => {
    const delayed = (stream: SpillStream, key: string): void => {
      const original: unknown = Reflect.get(stream, key);
      if (typeof original !== "function") return;
      Reflect.set(stream, key, (...args: unknown[]) =>
        Effect.runFork(
          Effect.sleep(SPILL_WRITE_DELAY_MS).pipe(
            Effect.andThen(Effect.sync(() => Reflect.apply(original, stream, args))),
          ),
        ),
      );
    };
    return {
      ...actual,
      createWriteStream: (path: unknown, options?: unknown) => {
        const stream = actual.createWriteStream(
          path,
          typeof options === "object" ? { ...options, highWaterMark: 1 } : { highWaterMark: 1 },
        );
        delayed(stream, "_write");
        delayed(stream, "_writev");
        const write = stream.write.bind(stream);
        stream.write = (...args: unknown[]) => {
          const accepted = write(...args);
          if (!accepted) spill.rejectedWrites++;
          return accepted;
        };
        return stream;
      },
    };
  }),
);

const tempDirs: string[] = [];

afterEach(() => {
  spill.rejectedWrites = 0;
  return Effect.runPromise(removeDirs(tempDirs.splice(0)));
});

describe("NodeExecutionEnv spill backpressure", () => {
  it.skipIf(process.platform === "win32")(
    "keeps inherited stdio open past the exit grace period while a spill write is pending",
    () =>
      Effect.runPromise(
        Effect.gen(function* () {
          const root = yield* makeTempDir("msa-durable-env-spill-");
          tempDirs.push(root);
          const env = new NodeExecutionEnv({ cwd: root });
          const command = "printf '%020d' 0 | tr 0 a; (sleep 0.2; printf '%01000d' 0 | tr 0 b) &";

          let output = "";
          const result = getOrThrow(
            yield* awaited(
              env.exec(
                command,
                {
                  spill: { afterBytes: 10, afterLines: 10 },
                  onOutput: (text) => {
                    output += text;
                  },
                },
                BACKGROUND_CONTEXT,
              ),
            ),
          );

          expect(spill.rejectedWrites).toBeGreaterThan(0);
          expect(output).toHaveLength(1020);
          expect(result.spillPath).toBeDefined();
          tempDirs.push(joinPath(result.spillPath!, ".."));
          expect(
            getOrThrow(yield* awaited(env.readTextFile(result.spillPath!, BACKGROUND_CONTEXT))),
          ).toBe(`${"a".repeat(20)}${"b".repeat(1000)}`);
        }),
      ),
    10_000,
  );
});
