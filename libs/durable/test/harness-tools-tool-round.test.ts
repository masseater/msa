import { type Conversation, ToolResultEntry } from "@msa/durable";
import { ToolTask } from "@msa/durable/harness";
import { Effect } from "effect";
import { describe, expect, it } from "vite-plus/test";

import { type ChatSetup, chatSetup } from "./chat-support.ts";
import { awaited } from "./effect-support.ts";
import { addHooks, addTool } from "./harness-support.ts";
import {
  resultText,
  results,
  DONE,
  calls,
  run,
  tool,
  type Execute,
} from "./harness-tools-support.ts";
import { context } from "./session-support.ts";

const trace = Effect.fn("trace")(function* (
  setup: ChatSetup,
  prepare?: (root: Conversation) => Promise<void>,
) {
  const runPromise = Effect.runPromiseWith(yield* Effect.context<never>());

  const events: string[] = [];
  const slow =
    (name: string): Execute =>
    () =>
      runPromise(
        Effect.gen(function* () {
          events.push(`start ${name}`);
          yield* Effect.sleep(20);
          events.push(`end ${name}`);
          return { output: [] };
        }),
      );
  if (setup.registry.snapshot().extension("tool:a") === undefined)
    addTool(setup.registry, tool("a", slow("a")));
  if (setup.registry.snapshot().extension("tool:b") === undefined)
    addTool(setup.registry, tool("b", slow("b")));
  const result = yield* run(
    setup,
    [calls(["a", {}, "c1"], ["b", {}, "c2"]), DONE],
    (_harness, root) => (prepare === undefined ? Promise.resolve() : prepare(root)),
  );
  yield* awaited(result.harness.close(context));
  return events;
});

const runsRoundParallel = Effect.gen(function* () {
  const runPromise = Effect.runPromiseWith(yield* Effect.context<never>());

  expect((yield* trace(chatSetup())).slice(0, 2)).toEqual(["start a", "start b"]);
  const configured = chatSetup();
  configured.settings.toolExecution = "sequential";
  const sequential = yield* trace(configured);
  expect(sequential).toEqual(["start a", "end a", "start b", "end b"]);
  const perTool = chatSetup();
  const events: string[] = [];
  addTool(
    perTool.registry,
    tool(
      "a",
      () =>
        runPromise(
          Effect.gen(function* () {
            yield* Effect.sleep(20);
            events.push("a");
            return { output: [] };
          }),
        ),
      { executionMode: "sequential" },
    ),
  );
  addTool(
    perTool.registry,
    tool("b", () => {
      events.push("b");
      return Promise.resolve({ output: [] });
    }),
  );
  const result = yield* run(perTool, [calls(["a", {}, "c1"], ["b", {}, "c2"]), DONE]);
  const tasks = yield* awaited(
    result.harness.commit((tx) => tx.scanTasks({ conversationId: result.root.id }, 20), context),
  );
  const tools = tasks.items.filter((task) => task.kind === "msa.tool").sort((a, b) => a.id - b.id);
  const [generation] = tasks.items.filter((task) => task.kind === "msa.generation");
  expect(tools.map((task) => task.owner)).toEqual([generation!.id, generation!.id]);
  expect(events).toEqual(["a", "b"]);
  yield* awaited(result.harness.close(context));
});

describe("tool round", () => {
  it("runs a round in parallel by default and sequentially when configured or required by a tool", () =>
    Effect.runPromise(runsRoundParallel));
});

const usesRetainedOutput = Effect.gen(function* () {
  const runPromise = Effect.runPromiseWith(yield* Effect.context<never>());

  const setup = chatSetup();
  addTool(
    setup.registry,
    tool(
      "log",
      (_args, api) =>
        runPromise(
          Effect.gen(function* () {
            api.output("line 1\n");
            api.output(new TextEncoder().encode("line 2\nline 3\n"));
            api.diagnostic({ severity: "info", message: "from api" });
            yield* awaited(api.details({ step: 1 }, context));
            yield* awaited(api.details({ step: 2 }, context));
            return { diagnostics: [{ severity: "warn", message: "from result" }] };
          }),
        ),
      { outputLimits: { maxLines: 2 } },
    ),
  );
  const { harness, entries } = yield* run(setup, [calls(["log", {}, "c1"]), DONE]);
  const [result] = results(entries);
  expect(result!.details).toEqual({ step: 2 });
  expect(resultText(result!)).toBe(
    "line 1\nline 2\n|<harness>\n[info] from api\n[warn] from result\n[warn] Output truncated to its beginning: 1 lines, 7 bytes dropped\n</harness>",
  );
  const entry = entries.find((candidate) => ToolResultEntry.is(candidate));
  expect(
    ToolResultEntry.is(entry) && entry.data.diagnostics.map((diagnostic) => diagnostic.code),
  ).toEqual([undefined, undefined, "truncated"]);
  yield* awaited(harness.close(context));
});

describe("tool results", () => {
  it("uses retained output and the last details when the result omits them, with diagnostics in order", () =>
    Effect.runPromise(usesRetainedOutput));
});

const offersTailWindow = Effect.gen(function* () {
  const setup = { ...chatSetup(), settings: { progress: { outputIntervalMs: 250 } } };
  const windows: unknown[] = [];
  addTool(
    setup.registry,
    tool(
      "tailed",
      (_args, api) => {
        windows.push(api.outputWindow);
        api.output("dropped\n");
        api.output("x\ny\n", { bytes: 8, newlines: 1, endsWithNewline: true });
        return Promise.resolve({});
      },
      { outputLimits: { maxLines: 1, retain: "tail" } },
    ),
  );
  addTool(
    setup.registry,
    tool(
      "headed",
      (_args, api) => {
        windows.push(api.outputWindow);
        return Promise.resolve({});
      },
      { outputLimits: { maxLines: 1 } },
    ),
  );
  const { harness, entries } = yield* run(setup, [
    calls(["tailed", {}, "c1"], ["headed", {}, "c2"]),
    DONE,
  ]);
  expect(windows).toContainEqual({
    maxBytes: 50 * 1024,
    maxLines: 1,
    minIntervalMs: 250,
    bytesPerSecond: 100 * 1024,
  });
  expect(windows).toContainEqual(undefined);
  expect(resultText(results(entries).find((result) => result.toolCallId === "c1")!)).toBe(
    "y\n|<harness>\n[warn] Output truncated to its end: 3 lines, 18 bytes dropped\n</harness>",
  );
  yield* awaited(harness.close(context));
});

describe("tool results", () => {
  it("offers the tail window with the configured pace, not a head window, and accepts skipped output", () =>
    Effect.runPromise(offersTailWindow));
});

const boundsExplicitText = Effect.gen(function* () {
  const setup = chatSetup();
  const image = { type: "image", data: "AAAA", mimeType: "image/png" } as const;
  addTool(
    setup.registry,
    tool(
      "big",
      () =>
        Promise.resolve({
          output: [{ type: "text", text: "a\nb\n" }, image, { type: "text", text: "c\nd\n" }],
        }),
      { outputLimits: { maxLines: 2, retain: "tail" } },
    ),
  );
  const { harness, entries } = yield* run(setup, [calls(["big", {}, "c1"]), DONE]);
  expect(resultText(results(entries)[0]!)).toBe(
    "[image]|c\nd\n|<harness>\n[warn] Output truncated to its end: 2 lines, 4 bytes dropped\n</harness>",
  );
  yield* awaited(harness.close(context));
});

const turnsThrowTool = Effect.gen(function* () {
  const setup = chatSetup();
  addTool(
    setup.registry,
    tool("fail", (_args, api) => {
      api.output("partial\n");
      return Promise.reject(new Error("boom"));
    }),
  );
  const { harness, entries, status } = yield* run(setup, [calls(["fail", {}, "c1"]), DONE]);
  expect(status).toBe("done");
  const [result] = results(entries);
  expect(result!.isError).toBe(true);
  expect(resultText(result!)).toBe("partial\n|<harness>\n[error] boom\n</harness>");
  yield* awaited(harness.close(context));
});

describe("tool results", () => {
  it("bounds explicit text content and keeps other content", () =>
    Effect.runPromise(boundsExplicitText));

  it("turns a throw into a tool_error result with the partial output", () =>
    Effect.runPromise(turnsThrowTool));
});

const recordsHowLong = Effect.gen(function* () {
  const runPromise = Effect.runPromiseWith(yield* Effect.context<never>());

  const setup = chatSetup();
  const sleep = (ms: number) => Effect.sleep(ms);
  addTool(
    setup.registry,
    tool("slow", () =>
      runPromise(
        Effect.gen(function* () {
          yield* sleep(30);
          return { output: [] };
        }),
      ),
    ),
  );
  addTool(
    setup.registry,
    tool("thrower", () =>
      runPromise(
        Effect.gen(function* () {
          yield* sleep(30);
          throw new Error("boom");
        }),
      ),
    ),
  );
  addHooks(setup.registry, ToolTask, {
    beforeTool: (call) =>
      runPromise(
        Effect.gen(function* () {
          yield* sleep(100);
          return call.id === "blocked" ? { block: "no" } : undefined;
        }),
      ),
  });
  const { harness, entries } = yield* run(setup, [
    calls(["slow", {}, "slow"], ["thrower", {}, "thrower"], ["slow", {}, "blocked"]),
    DONE,
  ]);
  const byId = new Map(results(entries).map((result) => [result.toolCallId, result]));
  for (const id of ["slow", "thrower"]) {
    expect(byId.get(id)?.durationMs).toBeGreaterThanOrEqual(25);
    expect(byId.get(id)?.durationMs).toBeLessThan(100);
  }
  expect(byId.get("thrower")?.isError).toBe(true);
  expect(byId.get("blocked")).not.toHaveProperty("durationMs");
  yield* awaited(harness.close(context));
});

describe("tool results", () => {
  it("records how long execute() took, excluding hooks, and nothing for calls that did not run", () =>
    Effect.runPromise(recordsHowLong));
});
