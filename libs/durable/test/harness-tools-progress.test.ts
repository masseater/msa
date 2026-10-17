import {
  AgentDoc,
  defineExtension,
  GenerationTask,
  hook,
  LiveDoc,
  MemoryStorage,
  section,
} from "@msa/durable";
import { describe, expect, it } from "vite-plus/test";

import { allEntries, chatSetup, openChat } from "./chat-support.ts";
import { addTool } from "./harness-support.ts";
import { resultText, results, DONE, calls, run, tool } from "./harness-tools-support.ts";
import { context } from "./session-support.ts";
import { deferred } from "./task-support.ts";

describe("tool progress and lifetime", () => {
  it("applies the default output limits", async () => {
    const setup = chatSetup();
    addTool(
      setup.registry,
      tool("lines", (_args, api) => {
        for (let index = 1; index <= 2500; index++) api.output(`${index}\n`);
        return Promise.resolve({});
      }),
    );
    const { harness, entries } = await run(setup, [calls(["lines", {}, "c1"]), DONE]);
    const text = resultText(results(entries)[0]!);
    expect(text.startsWith("1\n2\n")).toBe(true);
    expect(
      text.endsWith(
        "\n2000\n|<harness>\n[warn] Output truncated to its beginning: 500 lines, 2500 bytes dropped\n</harness>",
      ),
    ).toBe(true);
    await harness.close(context);
  });

  it("sanitizes running output but keeps explicit result content as the tool returned it", async () => {
    const setup = chatSetup();
    let slotOutput: string | undefined;
    addTool(
      setup.registry,
      tool("noisy", async (_args, api) => {
        api.output("a\u0007b\r\n");
        await api.details({ ready: true }, context);
        slotOutput = (await api.snapshot(LiveDoc, api.conversationId, context))?.tools?.[0]?.output;
        return {};
      }),
    );
    addTool(
      setup.registry,
      tool("explicit", () => Promise.resolve({ output: [{ type: "text", text: "c\u001bd" }] })),
    );
    const { harness, entries } = await run(setup, [
      calls(["noisy", {}, "c1"], ["explicit", {}, "c2"]),
      DONE,
    ]);
    expect(slotOutput).toBe("ab\n");
    const byId = new Map(results(entries).map((result) => [result.toolCallId, resultText(result)]));
    expect(byId.get("c1")).toBe("ab\n");
    expect(byId.get("c2")).toBe("c\u001bd");
    await harness.close(context);
  });
});

describe("tool progress and lifetime", () => {
  it("drops control keys set to undefined instead of faulting", async () => {
    const setup = chatSetup();
    addTool(
      setup.registry,
      tool("grow", () =>
        Promise.resolve({
          output: [],
          control: { addTools: ["extra"], terminate: undefined },
        }),
      ),
    );
    const extra = tool("extra", () => Promise.resolve({ output: [] }));
    addTool(setup.registry, extra);
    const { harness, root, status } = await run(
      setup,
      [calls(["grow", {}, "c1"]), DONE],
      (_harness, conversation) => conversation.configure({ tools: { remove: [extra] } }, context),
    );
    expect(status).toBe("done");
    // addTools deletes the name from a stored `{ remove }` filter.
    expect((await harness.snapshot(AgentDoc, root.id, context))?.tools).toEqual({ remove: [] });
    await harness.close(context);
  });

  it("uses explicit null details instead of the last reported value", async () => {
    const setup = chatSetup();
    addTool(
      setup.registry,
      tool("null", async (_args, api) => {
        await api.details({ old: 1 }, context);
        return { output: [], details: null };
      }),
    );
    const { harness, entries } = await run(setup, [calls(["null", {}, "c1"]), DONE]);
    expect(results(entries)[0]!.details).toBeNull();
    await harness.close(context);
  });
});

describe("tool progress and lifetime", () => {
  it("settles details() promises with coalesced progress commits and the terminal commit", async () => {
    const setup = chatSetup();
    const settled: string[] = [];
    addTool(
      setup.registry,
      tool("details", async (_args, api) => {
        // Three updates in one throttle window coalesce; the last is still pending when execute() returns.
        const first = api.details({ n: 1 }, context).then(() => settled.push("first"));
        const second = api.details({ n: 2 }, context).then(() => settled.push("second"));
        await first;
        void second;
        void api.details({ n: 3 }, context).then(() => settled.push("third"));
        return { output: [] };
      }),
    );
    const { harness, entries } = await run(setup, [calls(["details", {}, "c1"]), DONE]);
    expect(settled).toEqual(["first", "second", "third"]);
    expect(results(entries)[0]!.details).toEqual({ n: 3 });
    await harness.close(context);
  });
});

describe("tool progress and lifetime", () => {
  it("finishes a call under the implementation it resolved when the tool is replaced mid-call", async () => {
    const setup = chatSetup();
    let release!: () => void;
    const started = new Promise<void>((resolve) => {
      release = resolve;
    });
    let finish!: () => void;
    const finished = new Promise<void>((resolve) => {
      finish = resolve;
    });
    const v1 = tool("work", async () => {
      release();
      await finished;
      return { output: [{ type: "text", text: "v1" }] };
    });
    addTool(setup.registry, v1);
    setup.faux.setResponses([calls(["work", {}, "c1"]), DONE]);
    const { harness, root } = await openChat(new MemoryStorage(), setup);
    const submission = await root.submit({ type: "input", content: "go" }, context);
    await started;
    // The same extension name replaces the old one in place.
    addTool(
      setup.registry,
      tool("work", () => Promise.resolve({ output: [{ type: "text", text: "v2" }] })),
    );
    finish();
    await submission.wait(context);
    expect(resultText(results(await allEntries(root))[0]!)).toBe("v1");
    await harness.close(context);
  });
});

describe("tool progress and lifetime", () => {
  it("uses a section and hook extension reloaded mid-run from the run's next request", async () => {
    const setup = chatSetup();
    const requests: string[] = [];
    const prompt = (version: string) =>
      defineExtension({
        name: "prompt",
        sections: [section("mode", () => version)],
        hooks: [hook(GenerationTask, { beforeRequest: () => void requests.push(version) })],
      });
    setup.registry.install(prompt("v1"));
    const running = deferred();
    const reloaded = deferred();
    addTool(
      setup.registry,
      tool("work", async () => {
        running.resolve();
        await reloaded.promise;
        return { output: [] };
      }),
    );
    setup.faux.setResponses([calls(["work", {}, "c1"]), DONE]);
    const { harness, root } = await openChat(new MemoryStorage(), setup);
    const submission = await root.submit({ type: "input", content: "go" }, context);
    await running.promise;
    setup.registry.install(prompt("v2"));
    reloaded.resolve();
    await submission.wait(context);
    const sections = (await allEntries(root)).flatMap((entry) => {
      const message = entry.model?.[0];
      return message?.role === "system" && message.sections !== undefined ? [message.sections] : [];
    });
    expect(sections).toEqual([{ mode: "<mode>\nv1\n</mode>" }, { mode: "<mode>\nv2\n</mode>" }]);
    expect(requests).toEqual(["v1", "v2"]);
    await harness.close(context);
  });
});
