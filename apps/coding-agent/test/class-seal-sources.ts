import * as NodeServices from "@effect/platform-node/NodeServices";
import { Effect, FileSystem, ManagedRuntime } from "effect";

import classSealTransform from "../../../tools/class-seal/transform.ts";

const packageRoot = `${import.meta.dirname}/..`;

const RUNTIME = "src/core/platform/node/class-seal";

const entries: readonly string[] = [
  "src/bun/cli",
  "src/bun/runtime-setup",
  "src/cli",
  "src/experimental/source-resolver",
  "src/extensions/codemode/worker",
  "src/rpc-entry",
  "src/utils/image-resize-worker",
];

type Expected = {
  readonly counts: Readonly<Record<string, number>>;
  readonly entryCounts: Readonly<Record<string, number>>;
};

const runtime = ManagedRuntime.make(NodeServices.layer);

const countsOf = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem;
  const files = (yield* fs.readDirectory(`${packageRoot}/src`, { recursive: true }))
    .filter((file) => file.endsWith(".ts") && !file.endsWith(".d.ts"))
    .map((file) => `${packageRoot}/src/${file}`);
  const counted = yield* Effect.forEach(
    files,
    (file) =>
      fs
        .readFileString(file)
        .pipe(
          Effect.map(
            (code) =>
              [
                classSealTransform.moduleOf(packageRoot, file),
                classSealTransform.countClasses(code, file),
              ] as const,
          ),
        ),
    { concurrency: 32 },
  );
  return counted.filter(([module]) => module !== RUNTIME);
});

const expectedSealed = (): Promise<Expected> =>
  runtime.runPromise(
    countsOf.pipe(
      Effect.map((counted) => ({
        counts: Object.fromEntries(
          counted.filter(([module, count]) => count > 0 && !entries.includes(module)),
        ),
        entryCounts: Object.fromEntries(counted.filter(([module]) => entries.includes(module))),
      })),
    ),
  );

const classSealSources = { entries, expectedSealed, packageRoot };

export default classSealSources;
