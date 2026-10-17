import { Type } from "@msa/ai";
import { type CodemodeRun, CodemodeSandbox } from "@msa/codemode";
import { defineTool, type ToolRegistration } from "@msa/durable";

import { type CodemodeGlobal, createCodemodeTool } from "../src/codemode/codemode.ts";
import type { CodemodeNamespace } from "../src/codemode/describe.ts";
import { chatSetup } from "./chat-support.ts";
import { addTool } from "./harness-support.ts";
import { aborted, type Deferred, deferred } from "./task-support.ts";

export const Parameters = Type.Object({
  text: Type.Optional(Type.String()),
  id: Type.Optional(Type.Number()),
});

export function tool(
  name: string,
  execute: ToolRegistration<typeof Parameters>["execute"],
  replay: "safe" | "unsafe" = "unsafe",
) {
  return defineTool({ name, description: name, parameters: Parameters, execute, replay });
}

// A sandbox that counts its runs in `vm.starts` and hands each new run to `vm.onStart`.
export function countingSandbox() {
  const sandbox = new CodemodeSandbox({ memoryLimitBytes: 64 * 1024 * 1024 });
  const vm: { starts: number; onStart?: (run: CodemodeRun) => void } = { starts: 0 };
  const start = sandbox.start.bind(sandbox);
  sandbox.start = (code, options) => {
    vm.starts++;
    const run = start(code, options);
    vm.onStart?.(run);
    return run;
  };
  return { sandbox, vm };
}

export function addEchoTool(registry: ReturnType<typeof chatSetup>["registry"]) {
  const echo = new Map<string, number>();
  addTool(
    registry,
    tool("echo", (args) => {
      echo.set(args.text ?? "", (echo.get(args.text ?? "") ?? 0) + 1);
      return Promise.resolve({ output: [{ type: "text", text: `echo ${args.text ?? ""}` }] });
    }),
  );
  return echo;
}

export function addHoldTool(registry: ReturnType<typeof chatSetup>["registry"]) {
  const holds = { block: true, reached: deferred(), runs: 0 };
  addTool(
    registry,
    tool(
      "hold",
      async (args, _api, callContext) => {
        holds.runs++;
        if (holds.block) {
          holds.reached.resolve();
          await aborted(callContext.abortSignal!);
        }
        return { output: [{ type: "text", text: `held ${args.id ?? ""}` }] };
      },
      "safe",
    ),
  );
  return holds;
}

export function addPauseTool(registry: ReturnType<typeof chatSetup>["registry"]) {
  const pauses = { block: true, reached: deferred() };
  addTool(
    registry,
    tool(
      "pause",
      async (_args, _api, callContext) => {
        if (pauses.block) {
          pauses.reached.resolve();
          await aborted(callContext.abortSignal!);
        }
        return { output: [{ type: "text", text: "paused" }] };
      },
      "safe",
    ),
  );
  return pauses;
}

export function addSlowTool(registry: ReturnType<typeof chatSetup>["registry"]) {
  const gates = new Map<number, Deferred>();
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
    tool("slow", async (args) => {
      await slows.gate(args.id ?? 0).promise;
      finished.push(args.id ?? 0);
      return { output: [{ type: "text", text: `slow ${args.id}` }] };
    }),
  );
  return slows;
}

// A chat with the code mode tool and test tools:
// - `echo` returns `echo <text>` and counts its runs by text;
// - `hold` (replay-safe) waits for `holds.gate` while `holds.block` is set, then returns `held <id>`;
// - `slow` returns `slow <id>` once `slows.release(id)` was called.
export function codemodeChat(globals: CodemodeGlobal[] = [], namespaces: CodemodeNamespace[] = []) {
  const setup = chatSetup();
  const { sandbox, vm } = countingSandbox();
  addTool(setup.registry, createCodemodeTool({ sandbox, globals, namespaces }));
  const echo = addEchoTool(setup.registry);
  const holds = addHoldTool(setup.registry);
  const pauses = addPauseTool(setup.registry);
  const slows = addSlowTool(setup.registry);
  return { setup, sandbox, vm, echo, holds, pauses, slows };
}
