import { mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { Context, JsonValue } from "@msa/chord";
import { BACKGROUND_CONTEXT } from "@msa/chord/context";
import type {
  ToolDiagnostic,
  ToolExecutionApi,
  ToolExecutionResult,
  ToolRegistration,
} from "@msa/durable";

import { type ExecutionEnv, type FileError, type Result } from "../src/env/index.ts";
import { NodeExecutionEnv } from "../src/env/node.ts";
import { removeDirSync } from "./temp-support.ts";

export const tempDirs: string[] = [];

export function createTempDir(): string {
  const dir = join(
    tmpdir(),
    `msa-durable-tools-${Date.now()}-${Math.random().toString(36).slice(2)}`,
  );
  mkdirSync(dir, { recursive: true });
  tempDirs.push(dir);
  return dir;
}

export function removeTempDirs(): void {
  for (const dir of tempDirs) removeDirSync(dir);
}

export function createEnv(): NodeExecutionEnv {
  return new NodeExecutionEnv({ cwd: createTempDir() });
}

// A minimal execution API: the environment, collected output and diagnostics, and nothing durable.
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
    details: async () => {},
    // No model: `read` treats it as one that sees images.
    agent: () => Promise.resolve({}),
  } as unknown as ToolExecutionApi;
  return { api, output, diagnostics };
}

export async function run(
  tool: ToolRegistration,
  args: JsonValue,
  env: ExecutionEnv | undefined,
  context: Context = BACKGROUND_CONTEXT,
): Promise<ToolExecutionResult & { streamed: string[]; reported: ToolDiagnostic[] }> {
  const { api, output, diagnostics } = fakeApi(env);
  return { ...(await tool.execute(args, api, context)), streamed: output, reported: diagnostics };
}

// Run a tool expected to throw; returns the error with what it streamed and reported first.
export async function runFailing(
  tool: ToolRegistration,
  args: JsonValue,
  env: ExecutionEnv,
): Promise<{ error: Error; streamed: string[]; reported: ToolDiagnostic[] }> {
  const { api, output, diagnostics } = fakeApi(env);
  try {
    await tool.execute(args, api, BACKGROUND_CONTEXT);
  } catch (error) {
    return { error: error as Error, streamed: output, reported: diagnostics };
  }
  throw new Error("Expected the tool to throw");
}

export function textOutput(result: ToolExecutionResult): string {
  return (result.output ?? [])
    .flatMap((part) => (part.type === "text" ? [part.text] : []))
    .join("\n");
}

export function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve = () => {};
  const promise = new Promise<void>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

export function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

export class BlockingWriteExecutionEnv extends NodeExecutionEnv {
  readonly firstWriteStarted = deferred();
  readonly finishFirstWrite = deferred();
  secondWriteStarted = false;

  override async writeFile(
    path: string,
    content: string | Uint8Array,
    context: Context,
  ): Promise<Result<void, FileError>> {
    if (content === "first\n") {
      this.firstWriteStarted.resolve();
      await this.finishFirstWrite.promise;
    } else if (content === "second\n") {
      this.secondWriteStarted = true;
    }
    return super.writeFile(path, content, context);
  }
}
