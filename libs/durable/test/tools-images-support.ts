import type { Model } from "@msa/ai";
import { BACKGROUND_CONTEXT as context } from "@msa/chord/context";
import type { ToolDiagnostic, ToolExecutionApi, ToolExecutionResult } from "@msa/durable";
import { Effect } from "effect";
import { expect } from "vite-plus/test";

import { NodeExecutionEnv } from "../src/env/node.ts";
import type { ImageProcessor } from "../src/tools/image.ts";
import { createReadTool } from "../src/tools/read.ts";
import { awaited } from "./effect-support.ts";
import { makeTempDir, removeDir, writeTempFile } from "./platform-support.ts";

export const directory = await Effect.runPromise(makeTempDir("msa-durable-images-"));

export const removeImageDirectory = (): Promise<void> => Effect.runPromise(removeDir(directory));

export const read = Effect.fn("read")(function* (
  name: string,
  bytes: Uint8Array,
  options: {
    readonly images?: ImageProcessor;
    readonly input?: readonly string[];
    readonly resize?: {
      readonly maxWidth?: number;
      readonly maxHeight?: number;
      readonly maxBytes?: number;
    };
    readonly env?: NodeExecutionEnv;
    readonly tool?: ReturnType<typeof createReadTool>;
  } = {},
) {
  yield* writeTempFile(directory, name, bytes);
  const model = {
    input: options.input ?? ["text", "image"],
    ...(options.resize === undefined
      ? {}
      : { inputLimits: { images: { resize: options.resize } } }),
  } as unknown as Model<never>;
  const api = {
    env: options.env ?? new NodeExecutionEnv({ cwd: directory }),
    output: () => {},
    diagnostic: () => {},
    details: () => Promise.resolve(),
    agent: () => Promise.resolve({ model: { provider: "test", modelId: "test" } }),
    models: { getModel: () => model },
  } as unknown as ToolExecutionApi;
  const tool = options.tool ?? createReadTool(options);
  return yield* awaited(tool.execute({ path: name }, api, context));
});

export function messages(result: ToolExecutionResult): string[] {
  return (result.diagnostics ?? []).map((diagnostic: ToolDiagnostic) => diagnostic.message);
}

export function onlyImage(result: ToolExecutionResult): { data: string; mimeType: string } {
  expect(result.output).toHaveLength(1);
  return (result.output as { data: string; mimeType: string }[])[0]!;
}
