import ai from "@msa/ai";
import codemodeModule from "@msa/codemode";
import type codemodeTypesModule from "@msa/codemode/index.types";
import durable from "@msa/durable";
import type durableTypes from "@msa/durable/index.types";
import { Effect } from "effect";
import { dual } from "effect/Function";

import type codemodeTypes from "../src/codemode/codemode.types.ts";
import type describeTypes from "../src/codemode/describe.types.ts";
import codemodeChatSupportKit from "./codemode-chat-support-kit.ts";

const { codemode, support } = codemodeChatSupportKit;

const { Type } = ai;

const { CodemodeSandbox } = codemodeModule;

const { defineTool } = durable;
const { createCodemodeTool } = codemode;

const { aborted, addTool, awaited, chatSetup, deferred } = support;

const Parameters = Type.Object({
  id: Type.Optional(Type.Number()),
  text: Type.Optional(Type.String()),
});

function toolImpl(
  name: string,
  execute: durableTypes.ToolRegistration<typeof Parameters>["execute"],
  replay: "safe" | "unsafe" = "unsafe",
) {
  return defineTool({ description: name, execute, name, parameters: Parameters, replay });
}

const tool: {
  (
    execute: durableTypes.ToolRegistration<typeof Parameters>["execute"],
    replay?: "safe" | "unsafe",
  ): (name: string) => ReturnType<typeof toolImpl>;
  (
    name: string,
    execute: durableTypes.ToolRegistration<typeof Parameters>["execute"],
    replay?: "safe" | "unsafe",
  ): ReturnType<typeof toolImpl>;
} = dual((args) => typeof args[0] === "string", toolImpl);

function countingSandbox() {
  const sandbox = new CodemodeSandbox({ memoryLimitBytes: 64 * 1024 * 1024 });
  const vm: { starts: number; onStart?: (run: codemodeTypesModule.CodemodeRun) => void } = {
    starts: 0,
  };
  const start = sandbox.start.bind(sandbox);
  sandbox.start = (code, options) => {
    vm.starts++;
    const run = start(code, options);
    vm.onStart?.(run);
    return run;
  };
  return { sandbox, vm };
}

function addEchoTool(registry: ReturnType<typeof chatSetup>["registry"]) {
  const echo = new Map<string, number>();
  addTool(
    registry,
    tool("echo", (args) => {
      echo.set(args.text ?? "", (echo.get(args.text ?? "") ?? 0) + 1);
      return Promise.resolve({ output: [{ text: `echo ${args.text ?? ""}`, type: "text" }] });
    }),
  );
  return echo;
}

function addHoldTool(registry: ReturnType<typeof chatSetup>["registry"]) {
  const holds = { block: true, reached: deferred(), runs: 0 };
  addTool(
    registry,
    tool(
      "hold",
      (args, _api, callContext) =>
        Effect.runPromise(
          Effect.gen(function* () {
            holds.runs++;
            if (holds.block) {
              holds.reached.resolve();
              return yield* awaited(aborted(callContext.abortSignal!));
            }
            return { output: [{ text: `held ${args.id ?? ""}`, type: "text" }] };
          }),
        ),
      "safe",
    ),
  );
  return holds;
}

function addPauseTool(registry: ReturnType<typeof chatSetup>["registry"]) {
  const pauses = { block: true, reached: deferred() };
  addTool(
    registry,
    tool(
      "pause",
      (_args, _api, callContext) =>
        Effect.runPromise(
          Effect.gen(function* () {
            if (pauses.block) {
              pauses.reached.resolve();
              return yield* awaited(aborted(callContext.abortSignal!));
            }
            return { output: [{ text: "paused", type: "text" }] };
          }),
        ),
      "safe",
    ),
  );
  return pauses;
}

function addSlowTool(registry: ReturnType<typeof chatSetup>["registry"]) {
  const gates = new Map<number, PromiseWithResolvers<void>>();
  const finished: number[] = [];
  const slows = {
    finished,
    gate: (id: number) => {
      const gate = gates.get(id) ?? deferred();
      gates.set(id, gate);
      return gate;
    },
    release: (id: number) => slows.gate(id).resolve(),
  };
  addTool(
    registry,
    tool("slow", (args) =>
      Effect.runPromise(
        Effect.gen(function* () {
          yield* awaited(slows.gate(args.id ?? 0).promise);
          finished.push(args.id ?? 0);
          return { output: [{ text: `slow ${args.id}`, type: "text" }] };
        }),
      ),
    ),
  );
  return slows;
}

function codemodeChat({
  globals = [],
  namespaces = [],
}: {
  readonly globals?: codemodeTypes.CodemodeGlobal[];
  readonly namespaces?: describeTypes.CodemodeNamespace[];
} = {}) {
  const setup = chatSetup();
  const { sandbox, vm } = countingSandbox();
  addTool(setup.registry, createCodemodeTool({ globals, namespaces, sandbox }));
  const echo = addEchoTool(setup.registry);
  const holds = addHoldTool(setup.registry);
  const pauses = addPauseTool(setup.registry);
  const slows = addSlowTool(setup.registry);
  return { echo, holds, pauses, sandbox, setup, slows, vm };
}

const codemodeChatSupport = {
  Parameters,
  addEchoTool,
  addHoldTool,
  addPauseTool,
  addSlowTool,
  codemodeChat,
  countingSandbox,
  tool,
};

export default codemodeChatSupport;
