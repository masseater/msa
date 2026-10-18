import type { Context, JsonValue } from "@msa/chord";
import { BACKGROUND_CONTEXT } from "@msa/chord/context";
import type {
  ToolDiagnostic,
  ToolExecutionApi,
  ToolExecutionResult,
  ToolRegistration,
} from "@msa/durable";
import { Cause, Effect, Exit } from "effect";
import { dual } from "effect/Function";

import { type ExecutionEnv, type FileError, type Result } from "../src/env/index.ts";
import { NodeExecutionEnv } from "../src/env/node.ts";
import { awaited } from "./effect-support.ts";
import { makeTempDir, removeDirs } from "./platform-support.ts";

export const tempDirs: string[] = [];

export const createTempDir: Effect.Effect<string> = makeTempDir("msa-durable-tools-").pipe(
  Effect.tap((dir) => Effect.sync(() => tempDirs.push(dir))),
);

export const removeTempDirs: Effect.Effect<void> = Effect.suspend(() =>
  removeDirs(tempDirs.splice(0)),
);

export const createEnv: Effect.Effect<NodeExecutionEnv> = Effect.map(
  createTempDir,
  (cwd) => new NodeExecutionEnv({ cwd }),
);

export function fakeApi(env: ExecutionEnv | undefined): {
  api: ToolExecutionApi;
  output: string[];
  diagnostics: ToolDiagnostic[];
} {
  const output: string[] = [];
  const diagnostics: ToolDiagnostic[] = [];
  const api = {
    taskId: 1,
    conversationId: 1,
    callId: "call",
    env,
    output: (chunk: string | Uint8Array) =>
      output.push(typeof chunk === "string" ? chunk : new TextDecoder().decode(chunk)),
    retainedOutput: () => ({ text: output.join(""), truncated: false }),
    diagnostic: (diagnostic: ToolDiagnostic) => diagnostics.push(diagnostic),
    details: () => Promise.resolve(),
    agent: () => Promise.resolve({}),
  } as unknown as ToolExecutionApi;
  return { api, output, diagnostics };
}

function runImpl(
  tool: ToolRegistration,
  args: JsonValue,
  env: ExecutionEnv | undefined,
  context: Context = BACKGROUND_CONTEXT,
): Promise<ToolExecutionResult & { streamed: string[]; reported: ToolDiagnostic[] }> {
  return Effect.runPromise(
    Effect.gen(function* () {
      const { api, output, diagnostics } = fakeApi(env);
      return {
        ...(yield* awaited(tool.execute(args, api, context))),
        streamed: output,
        reported: diagnostics,
      };
    }),
  );
}

export const run: {
  (
    args: JsonValue,
    env: ExecutionEnv | undefined,
    context?: Context,
  ): (tool: ToolRegistration) => ReturnType<typeof runImpl>;
  (
    tool: ToolRegistration,
    args: JsonValue,
    env: ExecutionEnv | undefined,
    context?: Context,
  ): ReturnType<typeof runImpl>;
} = dual(
  (args) => typeof args[0] === "object" && args[0] !== null && "execute" in args[0],
  runImpl,
);

export const runFailing = Effect.fn("runFailing")(function* (
  tool: ToolRegistration,
  args: JsonValue,
  env: ExecutionEnv,
) {
  const { api, output, diagnostics } = fakeApi(env);
  const exit = yield* Effect.exit(awaited(tool.execute(args, api, BACKGROUND_CONTEXT)));
  if (Exit.isSuccess(exit)) throw new Error("Expected the tool to throw");
  return { error: Cause.squash(exit.cause) as Error, streamed: output, reported: diagnostics };
});

export function textOutput(result: ToolExecutionResult): string {
  return (result.output ?? [])
    .flatMap((part) => (part.type === "text" ? [part.text] : []))
    .join("\n");
}

export function deferred(): { promise: Promise<void>; resolve: () => void } {
  const { promise, resolve } = Promise.withResolvers<void>();
  return { promise, resolve };
}

export const delay = (ms: number): Promise<void> => Effect.runPromise(Effect.sleep(ms));

export class BlockingWriteExecutionEnv extends NodeExecutionEnv {
  readonly firstWriteStarted = deferred();
  readonly finishFirstWrite = deferred();
  secondWriteStarted = false;

  override writeFile(
    path: string,
    content: string | Uint8Array,
    context: Context,
  ): Promise<Result<void, FileError>> {
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
