import type { Model } from "@msa/ai";
import { BACKGROUND_CONTEXT as context } from "@msa/chord/context";
import type { ToolDiagnostic, ToolExecutionApi, ToolExecutionResult } from "@msa/durable";
import { Effect } from "effect";
import { expect } from "vite-plus/test";

import { getOrThrow } from "../src/env/index.ts";
import { NodeExecutionEnv } from "../src/env/node.ts";
import type { ImageProcessor } from "../src/tools/image.ts";
import { createReadTool } from "../src/tools/read.ts";
import { awaited, makeTempDir, removeDir, writeTempFile } from "./support.ts";

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

export function readEnv(
  onRead: (offset: number, length: number) => Effect.Effect<void> = () => Effect.void,
) {
  const env = new NodeExecutionEnv({ cwd: directory });
  const reads = { largest: 0 };
  const open = env.openBinaryReader.bind(env);
  env.openBinaryReader = (path, options, ctx) =>
    Effect.runPromise(
      Effect.gen(function* () {
        const runPromise = Effect.runPromiseWith(yield* Effect.context<never>());

        const reader = getOrThrow(yield* awaited(open(path, options, ctx)));
        return {
          ok: true,
          value: {
            info: (c) => reader.info(c),
            scanLines: (o, c) => reader.scanLines(o, c),
            close: (c) => reader.close(c),
            read: (offset, length, c) =>
              runPromise(
                Effect.gen(function* () {
                  reads.largest = Math.max(reads.largest, length);
                  const result = yield* awaited(reader.read(offset, length, c));
                  yield* onRead(offset, length);
                  return result;
                }),
              ),
          },
        };
      }),
    );
  return { env, reads };
}
