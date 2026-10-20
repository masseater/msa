import testing from "@msa/testing";
import { Effect } from "effect";
import { afterEach, describe, expect, it } from "vite-plus/test";

import runtimeKit from "../runtime-kit.ts";
import agentSessionRuntimeSupport from "./agent-session-runtime-support.ts";

const { awaited, joinPath, makeTempDir, realPath, runTest } = testing;
const { createFauxRuntime, disposeRuntimes } = runtimeKit;
const { createRuntimeForTest } = agentSessionRuntimeSupport;

const updatesTheSessionCwdOnCrossCwdReplacement = Effect.gen(function* () {
  const firstDir = yield* makeTempDir("msa-runtime-cwd-a-");
  const secondDir = yield* makeTempDir("msa-runtime-cwd-b-");
  const { runtime, faux, tempDir } = yield* createRuntimeForTest(() => {}, { cwd: firstDir });
  const other = yield* createFauxRuntime({
    agentDir: tempDir,
    bootstrapModel: false,
    cwd: secondDir,
    faux,
  });
  yield* awaited(other.runtime.session.prompt("other"));
  yield* awaited(runtime.switchSession(other.runtime.session.sessionFile ?? ""));
  const expected = yield* realPath(secondDir);
  expect(yield* realPath(runtime.session.sessionManager.getCwd())).toBe(expected);
  expect(yield* realPath(runtime.cwd)).toBe(expected);
});

const restoresModelAndThinkingState = Effect.gen(function* () {
  const { runtime, faux, tempDir } = yield* createRuntimeForTest(() => {}, {
    bootstrapModel: false,
  });
  const other = yield* createFauxRuntime({
    agentDir: tempDir,
    bootstrapModel: false,
    cwd: joinPath(tempDir, "other"),
    faux,
  });
  const fauxTwo = faux.getModel("faux-2");
  expect(fauxTwo).toBeDefined();
  if (fauxTwo !== undefined) {
    yield* awaited(other.runtime.session.setModel(fauxTwo));
  }
  other.runtime.session.setThinkingLevel("off");
  yield* awaited(other.runtime.session.prompt("hello"));
  yield* awaited(runtime.switchSession(other.runtime.session.sessionFile ?? ""));
  expect(runtime.session.model?.id).toBe("faux-2");
  expect(runtime.session.thinkingLevel).toBe("off");
});

describe("AgentSessionRuntime cross-session state", () => {
  afterEach(() => runTest(disposeRuntimes));

  it("updates the runtime session cwd on cross-cwd session replacement", () =>
    runTest(updatesTheSessionCwdOnCrossCwdReplacement));

  it("restores model and thinking state from the destination session", () =>
    runTest(restoresModelAndThinkingState));
});
