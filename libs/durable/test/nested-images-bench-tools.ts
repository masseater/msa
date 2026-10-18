import type { ImageContent } from "@msa/ai";
import { Effect } from "effect";
import { Type } from "typebox";

import { createRegistry } from "../src/harness/index.ts";
import {
  defineExtension,
  defineTool,
  type JsonObject,
  NestedCallDoc,
  type TaskId,
  type ToolTaskInput,
} from "../src/index.ts";
import { type Backend } from "./bench-support.ts";
import { toJsonText, awaited } from "./effect-support.ts";

const randomBytes = (length: number): Uint8Array => {
  const bytes = new Uint8Array(length);
  for (let offset = 0; offset < length; offset += 65_536)
    crypto.getRandomValues(bytes.subarray(offset, offset + 65_536));
  return bytes;
};

type Variant = "inline" | "reference";

export type Scenario = { backend: Backend; variant: Variant; count: number; bytes: number };

type Probe = { sample: () => void; beforeReturn: () => Promise<void> };

const ImageArgument = Type.Object({
  type: Type.Literal("image"),
  mimeType: Type.String(),
  data: Type.Optional(Type.String()),
  source: Type.Optional(Type.Object({ taskId: Type.Number() })),
});

function readImageTool(scenario: Scenario) {
  return defineTool({
    name: "read_image",
    description: "Read an image",
    parameters: Type.Object({ n: Type.Number() }),
    execute: () =>
      Promise.resolve({
        output: [
          {
            type: "image",
            data: Buffer.from(randomBytes((scenario.bytes / 4) * 3)).toString("base64"),
            mimeType: "image/png",
          },
        ],
      }),
  });
}

function classifyTool(scenario: Scenario) {
  return defineTool({
    name: "classify",
    description: "Classify images",
    parameters: Type.Object({ images: Type.Array(ImageArgument) }),
    execute: (args, api, callContext) =>
      Effect.runPromise(
        Effect.gen(function* () {
          for (const image of args.images) {
            let data = image.data;
            if (image.source !== undefined) {
              const input = (yield* awaited(api.getTask(api.taskId, callContext)))?.input as
                | ToolTaskInput
                | undefined;
              if (input?.kind !== "nested")
                throw new Error("classify resolves references only as a nested call");
              const source = (yield* awaited(
                api.getTask(image.source.taskId as TaskId, callContext),
              ))?.input as ToolTaskInput;
              if (source.kind !== "nested") throw new Error("A reference names a nested call");
              const stored = yield* awaited(
                api.snapshot(NestedCallDoc, input.parent, source.key, callContext),
              );
              const block = stored?.result?.structuredOutput as ImageContent | undefined;
              data = block?.type === "image" ? block.data : undefined;
            }
            if (data?.length !== scenario.bytes)
              throw new Error(`Image has ${data?.length} characters`);
          }
          return { output: [{ type: "text", text: "ok" }] };
        }),
      ),
  });
}

function scriptTool(scenario: Scenario, probe: Probe) {
  return defineTool({
    name: "script",
    description: "Read and classify images",
    parameters: Type.Object({ count: Type.Number() }),
    callers: ["model"],
    execute: (args, api, callContext) =>
      Effect.runPromise(
        Effect.gen(function* () {
          for (const n of Array.from({ length: args.count }, (_, i) => i)) {
            const key = `read${n}`;
            const read = yield* awaited(api.executeTool("read_image", { n }, callContext, { key }));
            const image = read.structuredOutput as unknown as ImageContent;
            const argument: JsonObject =
              scenario.variant === "inline"
                ? { type: "image", data: image.data, mimeType: image.mimeType }
                : { type: "image", source: { taskId: read.taskId }, mimeType: image.mimeType };
            const classified = yield* awaited(
              api.executeTool("classify", { images: [argument] }, callContext, {
                key: `classify${n}`,
              }),
            );
            if (classified.isError)
              throw new Error(`classify ${n} failed: ${yield* toJsonText(classified.diagnostics)}`);
            probe.sample();
          }
          yield* awaited(probe.beforeReturn());
          return { output: [{ type: "text", text: `classified ${args.count}` }] };
        }),
      ),
  });
}

export function registryFor(scenario: Scenario, probe: Probe) {
  const registry = createRegistry();
  const tools = [readImageTool(scenario), classifyTool(scenario), scriptTool(scenario, probe)];
  registry.install(defineExtension({ name: "bench", tools }));
  return registry;
}
