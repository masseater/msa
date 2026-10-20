import type { ImageContent } from "@msa/ai";
import { Effect } from "effect";
import { dual } from "effect/Function";
import { Type } from "typebox";

import { createRegistry } from "../src/harness/index.ts";
import {
  type JsonObject,
  NestedCallDoc,
  type TaskId,
  type ToolTaskInput,
  defineExtension,
  defineTool,
} from "../src/index.ts";
import effectSupport from "./effect-support.ts";
import type nestedImagesBenchToolsTypes from "./nested-images-bench-tools.types.ts";

const { awaited, toJsonText } = effectSupport;

const randomBytes = (length: number): Uint8Array => {
  const bytes = new Uint8Array(length);
  for (let offset = 0; offset < length; offset += 65_536)
    crypto.getRandomValues(bytes.subarray(offset, offset + 65_536));
  return bytes;
};

type Probe = { sample: () => void; beforeReturn: () => Promise<void> };

const ImageArgument = Type.Object({
  data: Type.Optional(Type.String()),
  mimeType: Type.String(),
  source: Type.Optional(Type.Object({ taskId: Type.Number() })),
  type: Type.Literal("image"),
});

function readImageTool(scenario: nestedImagesBenchToolsTypes.Scenario) {
  return defineTool({
    description: "Read an image",
    execute: () =>
      Promise.resolve({
        output: [
          {
            data: Buffer.from(randomBytes((scenario.bytes / 4) * 3)).toString("base64"),
            mimeType: "image/png",
            type: "image",
          },
        ],
      }),
    name: "read_image",
    parameters: Type.Object({ n: Type.Number() }),
  });
}

function classifyTool(scenario: nestedImagesBenchToolsTypes.Scenario) {
  return defineTool({
    description: "Classify images",
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
          return { output: [{ text: "ok", type: "text" }] };
        }),
      ),
    name: "classify",
    parameters: Type.Object({ images: Type.Array(ImageArgument) }),
  });
}

function scriptTool(scenario: nestedImagesBenchToolsTypes.Scenario, probe: Probe) {
  return defineTool({
    callers: ["model"],
    description: "Read and classify images",
    execute: (args, api, callContext) =>
      Effect.runPromise(
        Effect.gen(function* () {
          for (const n of Array.from({ length: args.count }, (_, i) => i)) {
            const key = `read${n}`;
            const read = yield* awaited(api.executeTool("read_image", { n }, callContext, { key }));
            const image = read.structuredOutput as unknown as ImageContent;
            const argument: JsonObject =
              scenario.variant === "inline"
                ? { data: image.data, mimeType: image.mimeType, type: "image" }
                : { mimeType: image.mimeType, source: { taskId: read.taskId }, type: "image" };
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
          return { output: [{ text: `classified ${args.count}`, type: "text" }] };
        }),
      ),
    name: "script",
    parameters: Type.Object({ count: Type.Number() }),
  });
}

function registryForImpl(scenario: nestedImagesBenchToolsTypes.Scenario, probe: Probe) {
  const registry = createRegistry();
  const tools = [readImageTool(scenario), classifyTool(scenario), scriptTool(scenario, probe)];
  registry.install(defineExtension({ name: "bench", tools }));
  return registry;
}

const registryFor: {
  (
    probe: Probe,
  ): (scenario: nestedImagesBenchToolsTypes.Scenario) => ReturnType<typeof registryForImpl>;
  (
    scenario: nestedImagesBenchToolsTypes.Scenario,
    probe: Probe,
  ): ReturnType<typeof registryForImpl>;
} = dual(2, registryForImpl);

export default registryFor;
