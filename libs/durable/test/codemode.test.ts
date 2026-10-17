import { rm } from "node:fs/promises";

import { afterEach, describe, expect, it } from "vite-plus/test";

import {
  type CodemodeGlobal,
  CodemodeJournalDoc,
  CodemodeRunDoc,
} from "../src/codemode/codemode.ts";
import { openNodeSqliteStorage } from "../src/storage/sqlite/node.ts";
import { openChat } from "./chat-support.ts";
import { codemodeChat } from "./codemode-chat-support.ts";
import {
  restart,
  resultText,
  DONE,
  script,
  sqlitePath,
  directories,
  nestedCount,
} from "./codemode-support.ts";
import { context } from "./session-support.ts";
import { eventually } from "./task-support.ts";

afterEach(async () => {
  for await (const directory of directories) await rm(directory, { recursive: true, force: true });
  directories.clear();
});

describe("durable code mode", () => {
  it("runs a script that calls tools as nested calls, and journals each result before delivering it", async () => {
    const chat = codemodeChat();
    chat.holds.block = false;
    chat.setup.faux.setResponses([
      script(
        `const a = await tools.echo({ text: "a" }); const b = await tools.echo({ text: "b" }); return [a, b];`,
      ),
      DONE,
    ]);
    const { harness, root } = await openChat(
      await openNodeSqliteStorage(await sqlitePath()),
      chat.setup,
    );
    await (await root.submit({ type: "input", content: "go" }, context)).wait(context);
    expect(await resultText(chat.setup, root)).toEqual({
      text: '["echo a","echo b"]',
      isError: false,
    });
    expect(await nestedCount(harness)).toBe(2);
    await harness.close(context);
  });

  it("resumes a script after a restart without running its finished calls again", async () => {
    const chat = codemodeChat();
    const { harness, result } = await restart(
      chat,
      `const a = await tools.echo({ text: "a" });
			const held = await tools.hold({ id: 1 });
			const b = await tools.echo({ text: "b" });
			return [a, held, b, Date.now() > 0];`,
    );
    expect(result).toEqual({ text: '["echo a","held 1","echo b",true]', isError: false });
    expect(Object.fromEntries(chat.echo)).toEqual({ a: 1, b: 1 });
    // The VM ran twice; hold, replay-safe, reran once after the restart.
    expect(chat.vm.starts).toBe(2);
    expect(chat.holds.runs).toBe(2);
    await harness.close(context);
  });
});

describe("durable code mode", () => {
  it("replays results in the order they arrived, not the order the calls were made", async () => {
    const chat = codemodeChat();
    const code = `const order = [];
			await Promise.all([tools.slow({ id: 1 }).then(() => order.push(1)), tools.slow({ id: 2 }).then(() => order.push(2))]);
			await tools.echo({ text: order.join(",") });
			await tools.hold({});
			return order;`;
    // 2 finishes first, then 1.
    chat.slows.release(2);
    void eventually(() => chat.slows.finished.includes(2)).then(() => chat.slows.release(1));
    const { harness, result } = await restart(chat, code);
    expect(result).toEqual({ text: "[2,1]", isError: false });
    expect(Object.fromEntries(chat.echo)).toEqual({ "2,1": 1 });
    await harness.close(context);
  });

  it("journals globals with their results and hands a replay the recorded ones", async () => {
    let counter = 0;
    const globals: CodemodeGlobal[] = [{ name: "next", execute: () => Promise.resolve(++counter) }];
    const chat = codemodeChat(globals);
    const { harness, result } = await restart(
      chat,
      `const n = await next(); await tools.hold({}); return [n, await next()];`,
    );
    // The first next() ran once and was replayed from the journal; the second ran after the restart.
    expect(result).toEqual({ text: "[1,2]", isError: false });
    expect(counter).toBe(2);
    await harness.close(context);
  });

  it("keeps the script's clock and randomness across a restart", async () => {
    const chat = codemodeChat();
    const { harness, result } = await restart(
      chat,
      `const before = [Date.now(), Math.random()];
			await tools.hold({});
			await tools.echo({ text: String(before[0]) + "/" + String(before[1]) });
			return "ok";`,
    );
    expect(result.text).toBe("ok");
    // One echo: the same arguments, so the rerun admitted no second call.
    expect([...chat.echo.values()]).toEqual([1]);
    await harness.close(context);
  });
});

describe("durable code mode", () => {
  it("ends the call when a resumed script made a different number of calls than before", async () => {
    const chat = codemodeChat();
    const { harness, result } = await restart(
      chat,
      `await tools.echo({ text: "a" }); await tools.hold({});`,
      async (opened, task) => {
        await opened.commit(async (tx) => {
          const journal = await tx.doc(CodemodeJournalDoc, task);
          journal.entries[0]!.issuedAfter = 7;
        }, context);
      },
    );
    expect(result.isError).toBe(true);
    expect(result.text).toContain("after result 1 it had made 2 calls, where it had made 7");
    await harness.close(context);
  });

  it("ends the call at once when a resumed script waits without making a call it made before", async () => {
    const chat = codemodeChat();
    const { harness, result } = await restart(
      chat,
      `await tools.echo({ text: "a" }); await tools.hold({});`,
      async (opened, task) => {
        await opened.commit(async (tx) => {
          const journal = await tx.doc(CodemodeJournalDoc, task);
          journal.entries[0]!.id = 99;
        }, context);
      },
    );
    expect(result.isError).toBe(true);
    expect(result.text).toContain("it waits without making call 99");
    // hold, admitted before the restart, resumed on its own; no call was admitted by the replay.
    expect(await nestedCount(harness)).toBe(2);
    await harness.close(context);
  });
});

describe("durable code mode", () => {
  it("ends the call when a resumed script calls a global with other arguments", async () => {
    const chat = codemodeChat([{ name: "next", execute: () => Promise.resolve(1) }]);
    const { harness, result } = await restart(
      chat,
      `await next(); await tools.hold({});`,
      async (opened, task) => {
        await opened.commit(async (tx) => {
          const journal = await tx.doc(CodemodeJournalDoc, task);
          journal.entries[0]!.global!.args = "other";
        }, context);
      },
    );
    expect(result.isError).toBe(true);
    expect(result.text).toContain("call 1 is next");
    await harness.close(context);
  });

  it("admits no call of a diverging replay, even one the script never made before", async () => {
    const chat = codemodeChat();
    // With k set, the replay makes three extra calls after result 1, which the live run did not make; the count in
    // result 1's acknowledgment shows the divergence only after they were issued.
    const { harness, result } = await restart(
      chat,
      `await tools.echo({ text: "a" });
			const extra = load("k") ?? 0;
			for (let i = 0; i < extra; i++) tools.echo({ text: "extra" + i });
			await tools.hold({});`,
      async (opened, task) => {
        await opened.commit(async (tx) => {
          const run = await tx.doc(CodemodeRunDoc, task);
          run.start!.store = { k: 3 };
        }, context);
      },
      async (opened, task) => {
        await eventually(
          async () =>
            (await opened.snapshot(CodemodeJournalDoc, task, context))?.entries[0]?.issuedAfter ===
            2,
        );
      },
    );
    expect(result.isError).toBe(true);
    expect(result.text).toContain("after result 1 it had made 5 calls, where it had made 2");
    expect(Object.fromEntries(chat.echo)).toEqual({ a: 1 });
    expect(await nestedCount(harness)).toBe(2);
    await harness.close(context);
  });
});

describe("durable code mode", () => {
  it("ends the call when a resumed script ends where it went on before", async () => {
    const chat = codemodeChat();
    const { harness, result } = await restart(
      chat,
      `await tools.echo({ text: "a" }); if (load("k")) return "early"; await tools.hold({});`,
      async (opened, task) => {
        await opened.commit(async (tx) => {
          const run = await tx.doc(CodemodeRunDoc, task);
          run.start!.store = { k: true };
        }, context);
      },
      // The live run acknowledged result 1 before the restart: it went on after it.
      async (opened, task) => {
        await eventually(
          async () =>
            (await opened.snapshot(CodemodeJournalDoc, task, context))?.entries[0]?.issuedAfter ===
            2,
        );
      },
    );
    expect(result.isError).toBe(true);
    expect(result.text).toContain("it ended after result 1, where it went on before");
    await harness.close(context);
  });

  it("ends the call when a resumed script ends before calls the live run made, even without a recorded count", async () => {
    const chat = codemodeChat();
    const { harness, result } = await restart(
      chat,
      `await tools.echo({ text: "a" }); if (load("k")) return "early"; await tools.echo({ text: "b" }); await tools.hold({});`,
      async (opened, task) => {
        await opened.commit(async (tx) => {
          const run = await tx.doc(CodemodeRunDoc, task);
          run.start!.store = { k: true };
          // As if the live run crashed before recording result 1's count.
          const journal = await tx.doc(CodemodeJournalDoc, task);
          delete journal.entries[0]!.issuedAfter;
        }, context);
      },
    );
    expect(result.isError).toBe(true);
    expect(result.text).toContain("it ended after result 1, where it went on before");
    await harness.close(context);
  });
});

describe("durable code mode", () => {
  it("ends the call when a resumed script makes a call an earlier attempt admitted with other arguments", async () => {
    const chat = codemodeChat();
    const { harness, result } = await restart(
      chat,
      `await tools.echo({ text: load("k") ?? "a" }); await tools.hold({});`,
      async (opened, task) => {
        await opened.commit(async (tx) => {
          const run = await tx.doc(CodemodeRunDoc, task);
          run.start!.store = { k: "other" };
          // As if the restart came before the first journal commit: the rerun runs live from the start.
          const journal = await tx.doc(CodemodeJournalDoc, task);
          journal.entries.length = 0;
        }, context);
      },
    );
    expect(result.isError).toBe(true);
    expect(result.text).toContain("different path");
    expect(result.text).toContain("call 1 is tools.echo");
    expect(Object.fromEntries(chat.echo)).toEqual({ a: 1 });
    await harness.close(context);
  });
});
