import contextModule from "@msa/chord/context";
import type chordTypes from "@msa/chord/index.types";
import type durableTypes from "@msa/durable/index.types";
import { Cause, Effect, Exit } from "effect";
import { dual } from "effect/Function";

import node from "../src/env/node.ts";
import effectSupport from "./effect-support.ts";
import platformSupport from "./platform-support.ts";
import type toolsSupportTypes from "./tools-support.types.ts";
import toolsTimeoutEnvSupport from "./tools-timeout-env-support.ts";

const { BACKGROUND_CONTEXT } = contextModule;

const { NodeExecutionEnv } = node;

const { awaited } = effectSupport;
const { makeTempDir, removeDirs } = platformSupport;

const tempDirs: string[] = [];

const createTempDir: Effect.Effect<string> = makeTempDir("msa-durable-tools-").pipe(
  Effect.tap((dir) => Effect.sync(() => tempDirs.push(dir))),
);

const removeTempDirs: Effect.Effect<void> = Effect.suspend(() => removeDirs(tempDirs.splice(0)));

const createEnv: Effect.Effect<toolsSupportTypes.NodeExecutionEnv> = Effect.map(
  createTempDir,
  (cwd) => new NodeExecutionEnv({ cwd }),
);

function fakeApi(env: toolsSupportTypes.ExecutionEnv | undefined): {
  api: durableTypes.ToolExecutionApi;
  output: string[];
  diagnostics: durableTypes.ToolDiagnostic[];
} {
  const output: string[] = [];
  const diagnostics: durableTypes.ToolDiagnostic[] = [];
  const api = {
    agent: () => Promise.resolve({}),
    callId: "call",
    conversationId: 1,
    details: () => Promise.resolve(),
    diagnostic: (diagnostic: durableTypes.ToolDiagnostic) => diagnostics.push(diagnostic),
    env,
    output: (chunk: string | Uint8Array) =>
      output.push(typeof chunk === "string" ? chunk : new TextDecoder().decode(chunk)),
    retainedOutput: () => ({ text: output.join(""), truncated: false }),
    taskId: 1,
  } as unknown as durableTypes.ToolExecutionApi;
  return { api, diagnostics, output };
}

function runImpl(
  tool: durableTypes.ToolRegistration,
  args: chordTypes.JsonValue,
  env: toolsSupportTypes.ExecutionEnv | undefined,
  context: chordTypes.Context = BACKGROUND_CONTEXT,
): Promise<
  durableTypes.ToolExecutionResult & { streamed: string[]; reported: durableTypes.ToolDiagnostic[] }
> {
  return Effect.runPromise(
    Effect.gen(function* () {
      const { api, output, diagnostics } = fakeApi(env);
      return {
        ...(yield* awaited(tool.execute(args, api, context))),
        reported: diagnostics,
        streamed: output,
      };
    }),
  );
}

const run: {
  (
    args: chordTypes.JsonValue,
    env: toolsSupportTypes.ExecutionEnv | undefined,
    context?: chordTypes.Context,
  ): (tool: durableTypes.ToolRegistration) => ReturnType<typeof runImpl>;
  (
    tool: durableTypes.ToolRegistration,
    args: chordTypes.JsonValue,
    env: toolsSupportTypes.ExecutionEnv | undefined,
    context?: chordTypes.Context,
  ): ReturnType<typeof runImpl>;
} = dual(
  (args) => typeof args[0] === "object" && args[0] !== null && "execute" in args[0],
  runImpl,
);

const runFailing = Effect.fn("runFailing")(function* (
  tool: durableTypes.ToolRegistration,
  args: chordTypes.JsonValue,
  env: toolsSupportTypes.ExecutionEnv,
) {
  const { api, output, diagnostics } = fakeApi(env);
  const exit = yield* Effect.exit(awaited(tool.execute(args, api, BACKGROUND_CONTEXT)));
  if (Exit.isSuccess(exit)) throw new Error("Expected the tool to throw");
  return { error: Cause.squash(exit.cause) as Error, reported: diagnostics, streamed: output };
});

function textOutput(result: durableTypes.ToolExecutionResult): string {
  return (result.output ?? [])
    .flatMap((part) => (part.type === "text" ? [part.text] : []))
    .join("\n");
}

function deferred(): { promise: Promise<void>; resolve: () => void } {
  const { promise, resolve } = Promise.withResolvers<void>();
  return { promise, resolve };
}

const delay = (ms: number): Promise<void> => Effect.runPromise(Effect.sleep(ms));

class BlockingWriteExecutionEnv extends NodeExecutionEnv {
  readonly firstWriteStarted = deferred();
  readonly finishFirstWrite = deferred();
  secondWriteStarted = false;

  override writeFile(
    path: string,
    content: string | Uint8Array,
    context: chordTypes.Context,
  ): Promise<toolsSupportTypes.Result<void, toolsSupportTypes.FileError>> {
    const superWriteFile = super.writeFile.bind(this);
    return Effect.runPromise(
      Effect.gen({ self: this }, function* () {
        if (content === "first\n") {
          this.firstWriteStarted.resolve();
          yield* awaited(this.finishFirstWrite.promise);
        } else if (content === "second\n") {
          this.secondWriteStarted = true;
        }
        return yield* awaited(superWriteFile(path, content, context));
      }),
    );
  }
}

const toolsSupport = {
  BlockingWriteExecutionEnv,
  TRUNCATED_OUTPUT_LINES: toolsTimeoutEnvSupport.TRUNCATED_OUTPUT_LINES,
  TimeoutOutputExecutionEnv: toolsTimeoutEnvSupport.TimeoutOutputExecutionEnv,
  createEnv,
  createTempDir,
  deferred,
  delay,
  fakeApi,
  removeTempDirs,
  run,
  runFailing,
  tempDirs,
  textOutput,
};

export default toolsSupport;
