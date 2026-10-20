import { AgentDoc, LiveDoc, defineExtension, hook, section } from "@msa/durable";
import { GenerationTask } from "@msa/durable/harness";
import { MemoryStorage } from "@msa/durable/storage/memory";
import { Effect } from "effect";
import { describe, expect, it } from "vite-plus/test";

import harnessToolsSupport from "./harness-tools-support.ts";
import support from "./support.ts";

const { DONE, calls, resultText, results, run, tool } = harnessToolsSupport;
const { addTool, allEntries, awaited, chatSetup, context, deferred, openChat } = support;

const appliesDefaultOutput = Effect.gen(function* () {
  const setup = chatSetup();
  addTool(
    setup.registry,
    tool("lines", (_args, api) => {
      for (let index = 1; index <= 2500; index++) api.output(`${index}\n`);
      return Promise.resolve({});
    }),
  );
  const { harness, entries } = yield* run(setup, [calls(["lines", {}, "c1"]), DONE]);
  const text = resultText(results(entries)[0]!);
  expect(text.startsWith("1\n2\n")).toBe(true);
  expect(
    text.endsWith(
      "\n2000\n|<harness>\n[warn] Output truncated to its beginning: 500 lines, 2500 bytes dropped\n</harness>",
    ),
  ).toBe(true);
  yield* awaited(harness.close(context));
});

const sanitizesRunningOutput = Effect.gen(function* () {
  const runPromise = Effect.runPromiseWith(yield* Effect.context<never>());

  const setup = chatSetup();
  let slotOutput: string | undefined;
  addTool(
    setup.registry,
    tool("noisy", (_args, api) =>
      runPromise(
        Effect.gen(function* () {
          api.output("a\u0007b\r\n");
          yield* awaited(api.details({ ready: true }, context));
          slotOutput = (yield* awaited(api.snapshot(LiveDoc, api.conversationId, context)))
            ?.tools?.[0]?.output;
          return {};
        }),
      ),
    ),
  );
  addTool(
    setup.registry,
    tool("explicit", () => Promise.resolve({ output: [{ text: "c\u001bd", type: "text" }] })),
  );
  const { harness, entries } = yield* run(setup, [
    calls(["noisy", {}, "c1"], ["explicit", {}, "c2"]),
    DONE,
  ]);
  expect(slotOutput).toBe("ab\n");
  const byId = new Map(results(entries).map((result) => [result.toolCallId, resultText(result)]));
  expect(byId.get("c1")).toBe("ab\n");
  expect(byId.get("c2")).toBe("c\u001bd");
  yield* awaited(harness.close(context));
});

describe("tool progress and lifetime", () => {
  it("applies the default output limits", () => Effect.runPromise(appliesDefaultOutput));

  it("sanitizes running output but keeps explicit result content as the tool returned it", () =>
    Effect.runPromise(sanitizesRunningOutput));
});

const dropsControlKeys = Effect.gen(function* () {
  const setup = chatSetup();
  addTool(
    setup.registry,
    tool("grow", () =>
      Promise.resolve({
        control: { addTools: ["extra"], terminate: undefined },
        output: [],
      }),
    ),
  );
  const extra = tool("extra", () => Promise.resolve({ output: [] }));
  addTool(setup.registry, extra);
  const { harness, root, status } = yield* run(
    setup,
    [calls(["grow", {}, "c1"]), DONE],
    (_harness, conversation) => conversation.configure({ tools: { remove: [extra] } }, context),
  );
  expect(status).toBe("done");
  expect((yield* awaited(harness.snapshot(AgentDoc, root.id, context)))?.tools).toEqual({
    remove: [],
  });
  yield* awaited(harness.close(context));
});

const usesExplicitNull = Effect.gen(function* () {
  const runPromise = Effect.runPromiseWith(yield* Effect.context<never>());

  const setup = chatSetup();
  addTool(
    setup.registry,
    tool("null", (_args, api) =>
      runPromise(
        Effect.gen(function* () {
          yield* awaited(api.details({ old: 1 }, context));
          return { details: null, output: [] };
        }),
      ),
    ),
  );
  const { harness, entries } = yield* run(setup, [calls(["null", {}, "c1"]), DONE]);
  expect(results(entries)[0]!.details).toBeNull();
  yield* awaited(harness.close(context));
});

describe("tool progress and lifetime", () => {
  it("drops control keys set to undefined instead of faulting", () =>
    Effect.runPromise(dropsControlKeys));

  it("uses explicit null details instead of the last reported value", () =>
    Effect.runPromise(usesExplicitNull));
});

const settlesDetailsPromises = Effect.gen(function* () {
  const runPromise = Effect.runPromiseWith(yield* Effect.context<never>());

  const setup = chatSetup();
  const settled: string[] = [];
  addTool(
    setup.registry,
    tool("details", (_args, api) =>
      runPromise(
        Effect.gen(function* () {
          const first = api.details({ n: 1 }, context).then(() => settled.push("first"));
          const second = api.details({ n: 2 }, context).then(() => settled.push("second"));
          yield* awaited(first);
          void second;
          void api.details({ n: 3 }, context).then(() => settled.push("third"));
          return { output: [] };
        }),
      ),
    ),
  );
  const { harness, entries } = yield* run(setup, [calls(["details", {}, "c1"]), DONE]);
  expect(settled).toEqual(["first", "second", "third"]);
  expect(results(entries)[0]!.details).toEqual({ n: 3 });
  yield* awaited(harness.close(context));
});

describe("tool progress and lifetime", () => {
  it("settles details() promises with coalesced progress commits and the terminal commit", () =>
    Effect.runPromise(settlesDetailsPromises));
});

const finishesCallUnder = Effect.gen(function* () {
  const runPromise = Effect.runPromiseWith(yield* Effect.context<never>());

  const setup = chatSetup();
  const { promise: started, resolve: release } = Promise.withResolvers<void>();
  const { promise: finished, resolve: finish } = Promise.withResolvers<void>();
  const v1 = tool("work", () =>
    runPromise(
      Effect.gen(function* () {
        release();
        yield* awaited(finished);
        return { output: [{ text: "v1", type: "text" }] };
      }),
    ),
  );
  addTool(setup.registry, v1);
  setup.faux.setResponses([calls(["work", {}, "c1"]), DONE]);
  const { harness, root } = yield* openChat(new MemoryStorage(), setup);
  const submission = yield* awaited(root.submit({ content: "go", type: "input" }, context));
  yield* awaited(started);
  addTool(
    setup.registry,
    tool("work", () => Promise.resolve({ output: [{ text: "v2", type: "text" }] })),
  );
  finish();
  yield* awaited(submission.wait(context));
  expect(resultText(results(yield* allEntries(root))[0]!)).toBe("v1");
  yield* awaited(harness.close(context));
});

describe("tool progress and lifetime", () => {
  it("finishes a call under the implementation it resolved when the tool is replaced mid-call", () =>
    Effect.runPromise(finishesCallUnder));
});

const usesSectionHook = Effect.gen(function* () {
  const runPromise = Effect.runPromiseWith(yield* Effect.context<never>());

  const setup = chatSetup();
  const requests: string[] = [];
  const prompt = (version: string) =>
    defineExtension({
      hooks: [hook(GenerationTask, { beforeRequest: () => void requests.push(version) })],
      name: "prompt",
      sections: [section("mode", () => version)],
    });
  setup.registry.install(prompt("v1"));
  const running = deferred();
  const reloaded = deferred();
  addTool(
    setup.registry,
    tool("work", () =>
      runPromise(
        Effect.gen(function* () {
          running.resolve();
          yield* awaited(reloaded.promise);
          return { output: [] };
        }),
      ),
    ),
  );
  setup.faux.setResponses([calls(["work", {}, "c1"]), DONE]);
  const { harness, root } = yield* openChat(new MemoryStorage(), setup);
  const submission = yield* awaited(root.submit({ content: "go", type: "input" }, context));
  yield* awaited(running.promise);
  setup.registry.install(prompt("v2"));
  reloaded.resolve();
  yield* awaited(submission.wait(context));
  const sections = (yield* allEntries(root)).flatMap((entry) => {
    const message = entry.model?.[0];
    return message?.role === "system" && message.sections !== undefined ? [message.sections] : [];
  });
  expect(sections).toEqual([{ mode: "<mode>\nv1\n</mode>" }, { mode: "<mode>\nv2\n</mode>" }]);
  expect(requests).toEqual(["v1", "v2"]);
  yield* awaited(harness.close(context));
});

describe("tool progress and lifetime", () => {
  it("uses a section and hook extension reloaded mid-run from the run's next request", () =>
    Effect.runPromise(usesSectionHook));
});
