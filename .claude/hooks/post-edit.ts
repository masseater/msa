import { Array as Arr, Effect, Schema, pipe } from "effect";

import env from "./env.ts";
import HookPlatform from "./platform.ts";
import type platformTypes from "./platform.types.ts";

const { blockWhen, localBin, projectRoot, readHookInput, runCommand, runHook, writeJson } = env;

const PostToolUseInput = Schema.Struct({
  tool_input: Schema.Struct({ file_path: Schema.optional(Schema.String) }),
});

const PostToolUseOutput = Schema.Struct({
  hookSpecificOutput: Schema.Struct({
    additionalContext: Schema.String,
    hookEventName: Schema.Literal("PostToolUse"),
  }),
});

const locate = Effect.fn("locate")(function* locate(filePath: string) {
  const platform = yield* HookPlatform;
  const root = yield* projectRoot;
  const [scope = "", name = ""] = platform.relative(root, filePath).split(platform.sep);
  const candidates = [scope, platform.join(scope, name)].filter((dir) => dir !== "");
  return { candidates, root };
});

const fallowTargets = Effect.fn("fallowTargets")(function* fallowTargets(
  root: string,
  candidates: readonly string[],
) {
  const platform = yield* HookPlatform;
  const withConfig = yield* pipe(
    candidates,
    Effect.filter((dir: string) => platform.exists(platform.join(root, dir, ".fallowrc.jsonc"))),
  );
  return [[], ...withConfig.map((dir) => ["-r", dir])];
});

const runFallow = Effect.fn("runFallow")(function* runFallow(
  root: string,
  candidates: readonly string[],
) {
  const fallow = yield* localBin("fallow");
  const targets = yield* fallowTargets(root, candidates);
  const runs = yield* Effect.forEach(
    targets,
    (args) =>
      runCommand(fallow, ["--changed-since", "HEAD", "--quiet", "--format", "compact", ...args]),
    { concurrency: "unbounded" },
  );
  yield* blockWhen(runs.filter((run) => !run.succeeded).map((run) => run.output));
  return runs;
});

const reportDuplication = (
  runs: readonly platformTypes.CommandResult[],
): Effect.Effect<void, never, HookPlatform> => {
  const duplication = Arr.dedupe(
    runs
      .flatMap((run) => run.stdout.split("\n"))
      .filter((line) => line.startsWith("code-duplication:")),
  );
  if (!Arr.isArrayNonEmpty(duplication)) {
    return Effect.void;
  }
  return writeJson(PostToolUseOutput, {
    hookSpecificOutput: {
      additionalContext: [
        "fallow が重複を検出した。共通化すべきか判断すること。",
        ...duplication,
      ].join("\n"),
      hookEventName: "PostToolUse",
    },
  });
};

runHook(
  Effect.gen(function* postEdit() {
    const input = yield* readHookInput(PostToolUseInput);
    const filePath = input.tool_input.file_path ?? "";
    const { candidates, root } = yield* locate(filePath);
    const runs = yield* runFallow(root, candidates);
    yield* reportDuplication(runs);
  }),
);
