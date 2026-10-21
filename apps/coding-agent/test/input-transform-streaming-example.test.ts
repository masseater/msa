import testing from "@msa/testing";
import { Effect } from "effect";
import { describe, expect, it, vi } from "vite-plus/test";

import inputTransformStreaming from "../examples/extensions/input-transform-streaming.ts";
import type extensionsTypes from "../src/core/extensions/index.types.ts";

const { awaited, runTest } = testing;

type InputHandler = (
  event: extensionsTypes.InputEvent,
  ctx: extensionsTypes.ExtensionContext,
) => Promise<extensionsTypes.InputEventResult | undefined>;

function setup(execResult: extensionsTypes.ExecResult) {
  let handler: InputHandler | undefined;

  const exec = vi.fn<extensionsTypes.ExtensionAPI["exec"]>().mockResolvedValue(execResult);

  const api = {
    exec,
    on: (event: string, h: InputHandler) => {
      if (event === "input") handler = h;
    },
  } as unknown as extensionsTypes.ExtensionAPI;

  inputTransformStreaming(api);

  const ctx = {} as extensionsTypes.ExtensionContext;

  function emit(text: string, streamingBehavior?: "steer" | "followUp") {
    return handler!(
      {
        source: "interactive",
        text,
        type: "input" as const,
        ...(streamingBehavior === undefined ? {} : { streamingBehavior }),
      },
      ctx,
    );
  }

  return { emit, exec };
}

const diffOutput = " src/index.ts | 5 ++---\n 1 file changed, 2 insertions(+), 3 deletions(-)";

const gitSuccess: extensionsTypes.ExecResult = {
  code: 0,
  killed: false,
  stderr: "",
  stdout: diffOutput,
};

const gitEmpty: extensionsTypes.ExecResult = { code: 0, killed: false, stderr: "", stdout: "" };

const gitFail: extensionsTypes.ExecResult = {
  code: 128,
  killed: false,
  stderr: "not a git repo",
  stdout: "",
};

const skipsExecDuringSteering = () =>
  runTest(
    Effect.gen(function* () {
      const { emit, exec } = setup(gitSuccess);
      const result = yield* awaited(emit("what changes did I make?", "steer"));
      expect(result).toEqual({ action: "continue" });
      expect(exec).not.toHaveBeenCalled();
    }),
  );

const transformsWhenIdleAndTextMatchesTrigger = () =>
  runTest(
    Effect.gen(function* () {
      const { emit, exec } = setup(gitSuccess);
      const result = yield* awaited(emit("review my changes"));
      expect(exec).toHaveBeenCalledWith("git", ["diff", "--stat"]);
      expect(result).toMatchObject({ action: "transform" });
      const text = (result as { text: string }).text;
      expect(text).toContain("review my changes");
      expect(text).toContain("src/index.ts");
    }),
  );

const transformsWhenQueuedAsFollowUp = () =>
  runTest(
    Effect.gen(function* () {
      const { emit, exec } = setup(gitSuccess);
      const result = yield* awaited(emit("show me the diff", "followUp"));
      expect(exec).toHaveBeenCalled();
      expect(result).toMatchObject({ action: "transform" });
    }),
  );

const continuesWhenTextDoesNotMatchTrigger = () =>
  runTest(
    Effect.gen(function* () {
      const { emit, exec } = setup(gitSuccess);
      const result = yield* awaited(emit("explain this function"));
      expect(result).toEqual({ action: "continue" });
      expect(exec).not.toHaveBeenCalled();
    }),
  );

const continuesWhenGitDiffIsEmpty = () =>
  runTest(
    Effect.gen(function* () {
      const { emit } = setup(gitEmpty);
      const result = yield* awaited(emit("any changes?"));
      expect(result).toEqual({ action: "continue" });
    }),
  );

const continuesWhenGitFails = () =>
  runTest(
    Effect.gen(function* () {
      const { emit } = setup(gitFail);
      const result = yield* awaited(emit("show modified files"));
      expect(result).toEqual({ action: "continue" });
    }),
  );

describe("input-transform-streaming example", () => {
  it("skips exec during steering", skipsExecDuringSteering);

  it("transforms when idle and text matches trigger", transformsWhenIdleAndTextMatchesTrigger);

  it("transforms when queued as follow-up", transformsWhenQueuedAsFollowUp);

  it("continues when text does not match trigger", continuesWhenTextDoesNotMatchTrigger);

  it("continues when git diff is empty", continuesWhenGitDiffIsEmpty);

  it("continues when git fails", continuesWhenGitFails);
});
