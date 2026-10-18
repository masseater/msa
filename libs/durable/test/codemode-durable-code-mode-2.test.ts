import { Type } from "@msa/ai";
import { defineTool } from "@msa/durable";
import { afterEach, describe, expect, it } from "vite-plus/test";

import { CodemodeRunDoc } from "../src/codemode/codemode.ts";
import { openChat } from "./chat-support.ts";
import { codemodeChat, tool } from "./codemode-chat-support.ts";
import {
  restart,
  resultText,
  DONE,
  script,
  sqlitePath,
  nestedCount,
  removeDirectories,
  openStoredChat,
} from "./codemode-support.ts";
import { addTool } from "./harness-support.ts";
import { ControlledStorage, context } from "./session-support.ts";
import { aborted, eventually } from "./task-support.ts";

afterEach(removeDirectories);

function schemaErrorToolsChat() {
  const chat = codemodeChat();
  const Exit = Type.Object({ output: Type.String(), exitCode: Type.Number() });
  addTool(
    chat.setup.registry,
    defineTool({
      name: "run",
      description: "run",
      parameters: Type.Object({}),
      structuredOutputSchema: Exit,
      // Like bash on a nonzero exit: an error result with its value.
      execute: () =>
        Promise.resolve({
          output: [{ type: "text", text: "no matches" }],
          structuredOutput: { output: "no matches", exitCode: 1 },
          isError: true,
        }),
    }),
  );
  addTool(
    chat.setup.registry,
    defineTool({
      name: "denied",
      description: "denied",
      parameters: Type.Object({}),
      structuredOutputSchema: Exit,
      execute: () =>
        Promise.resolve({
          output: [{ type: "text", text: "permission denied" }],
          isError: true,
        }),
    }),
  );
  chat.holds.block = false;
  return { chat };
}

describe("durable code mode", () => {
  it("checks every call a rerun holds before launching any of them", async () => {
    // Live, call 1 is a global that never finishes and call 2 is hold; with k set, call 1 is a new tool call and call 2
    // holds with other arguments. Checking call 1 alone would launch it before call 2's conflict shows.
    const chat = codemodeChat([
      {
        name: "forever",
        execute: async (_args, _api, callContext) => {
          await aborted(callContext.abortSignal!);
          return null;
        },
      },
    ]);
    const { harness, result } = await restart(
      chat,
      `const k = load("k");
			if (k) tools.echo({ text: "new" }); else forever();
			await tools.hold({ id: k ? 2 : 1 });`,
      async (opened, task) => {
        await opened.commit(async (tx) => {
          const run = await tx.doc(CodemodeRunDoc, task);
          run.start!.store = { k: true };
        }, context);
      },
    );
    expect(result.isError).toBe(true);
    expect(result.text).toContain('call 2 is tools.hold({"id":2}), but was tools.hold({"id":1})');
    expect(chat.echo.size).toBe(0);
    expect(await nestedCount(harness)).toBe(1);
    await harness.close(context);
  });

  it("keeps a global's undefined result undefined, live and replayed", async () => {
    const chat = codemodeChat([{ name: "nothing", execute: () => Promise.resolve(undefined) }]);
    const { harness, result } = await restart(
      chat,
      `const before = await nothing(); await tools.hold({}); return [before === undefined, (await nothing()) === undefined];`,
    );
    expect(result).toEqual({ text: "[true,true]", isError: false });
    await harness.close(context);
  });
});

describe("durable code mode", () => {
  it("rejects a failed tool call with its error text and structured output", async () => {
    const chat = codemodeChat();
    addTool(
      chat.setup.registry,
      tool("fails", () =>
        Promise.resolve({
          output: [{ type: "text", text: "permission denied" }],
          isError: true,
        }),
      ),
    );
    chat.holds.block = false;
    chat.setup.faux.setResponses([
      script(
        `try { await tools.fails({}); } catch (e) { return [e.message, e.structuredOutput]; }`,
      ),
      DONE,
    ]);
    const { harness, root } = await openStoredChat(await sqlitePath(), chat.setup);
    await (await root.submit({ type: "input", content: "go" }, context)).wait(context);
    expect(await resultText(chat.setup, root)).toEqual({
      text: '["permission denied","permission denied"]',
      isError: false,
    });
    await harness.close(context);
  });
});

describe("durable code mode", () => {
  it("resolves a schema tool's error result that carries its value, and rejects one without with its text", async () => {
    const { chat } = schemaErrorToolsChat();
    chat.setup.faux.setResponses([
      script(
        `const r = await tools.run({});
				let e; try { await tools.denied({}); } catch (error) { e = [error.message, error.structuredOutput ?? null]; }
				return [r.exitCode, r.output, e];`,
      ),
      DONE,
    ]);
    const { harness, root } = await openStoredChat(await sqlitePath(), chat.setup);
    await (await root.submit({ type: "input", content: "go" }, context)).wait(context);
    expect(await resultText(chat.setup, root)).toEqual({
      text: '[1,"no matches",["permission denied",null]]',
      isError: false,
    });
    await harness.close(context);
  });
});

describe("durable code mode", () => {
  it("resolves a schema-less tool with its text, as its declaration says, also when it returned images", async () => {
    const chat = codemodeChat();
    const PNG =
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";
    addTool(
      chat.setup.registry,
      defineTool({
        name: "picture",
        description: "picture",
        parameters: Type.Object({ caption: Type.Boolean() }),
        execute: (args) =>
          Promise.resolve({
            output: [
              ...(args.caption ? [{ type: "text" as const, text: "a cat" }] : []),
              { type: "image" as const, data: PNG, mimeType: "image/png" },
            ],
          }),
      }),
    );
    chat.holds.block = false;
    chat.setup.faux.setResponses([
      script(
        `return [await tools.picture({ caption: true }), await tools.picture({ caption: false })];`,
      ),
      DONE,
    ]);
    const { harness, root } = await openStoredChat(await sqlitePath(), chat.setup);
    await (await root.submit({ type: "input", content: "go" }, context)).wait(context);
    expect(await resultText(chat.setup, root)).toEqual({ text: '["a cat",""]', isError: false });
    await harness.close(context);
  });
});

describe("durable code mode", () => {
  it("delivers a result only after its journal commit", async () => {
    const storage = new ControlledStorage();
    const seen: string[] = [];
    const chat = codemodeChat([
      {
        name: "first",
        execute: () => {
          seen.push("first");
          // The next commit is this result's journal commit: it never lands.
          storage.failNextCommit(new Error("lost"));
          return Promise.resolve(1);
        },
      },
      {
        name: "second",
        execute: () => {
          seen.push("second");
          return Promise.resolve(2);
        },
      },
    ]);
    chat.holds.block = false;
    chat.setup.faux.setResponses([script(`await first(); await second();`), DONE]);
    const { harness, root } = await openChat(storage, chat.setup);
    await root.submit({ type: "input", content: "go" }, context);
    await eventually(() => seen.includes("first"));
    await new Promise((resolve) => {
      setTimeout(resolve, 100);
    });
    expect(seen).toEqual(["first"]);
    await harness.close(context).catch(() => {});
  });
});

describe("durable code mode", () => {
  it("refuses to resume when the sandbox's fingerprint or the code mode version changed", async () => {
    for await (const field of ["fingerprint", "version"] as const) {
      const chat = codemodeChat();
      const { harness, result } = await restart(
        chat,
        `await tools.hold({}); await tools.echo({ text: "late" });`,
        async (opened, task) => {
          await opened.commit(async (tx) => {
            const run = await tx.doc(CodemodeRunDoc, task);
            if (field === "fingerprint") run.start!.fingerprint = "another sandbox";
            else run.start!.version = 0;
          }, context);
        },
      );
      expect(result.isError).toBe(true);
      expect(result.text).toContain("cannot resume");
      expect(chat.echo.size).toBe(0);
      await harness.close(context);
    }
  });

  it("times a script out across a restart, without admitting new calls", async () => {
    const chat = codemodeChat();
    // The live run must reach the hold before its own timeout fires, so the timeout is far beyond the test's. The
    // deadline then passes while the call is interrupted by moving the stored deadline to now, without waiting for it.
    const { harness, result } = await restart(
      chat,
      `// @options: {"timeout_ms": 60000}
			await tools.hold({}); await tools.echo({ text: "late" });`,
      async (opened, task) => {
        await opened.commit(async (tx) => {
          const run = await tx.doc(CodemodeRunDoc, task);
          expect(run.start!.deadline).toBe(run.start!.startedAt + 60_000);
          run.start!.deadline = Date.now();
        }, context);
      },
    );
    expect(result.isError).toBe(true);
    expect(result.text).toContain("deadline passed");
    expect(chat.echo.size).toBe(0);
    expect(chat.vm.starts).toBe(1);
    await harness.close(context);
  });
});
