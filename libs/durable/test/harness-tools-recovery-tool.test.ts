import type { JsonValue } from "@msa/chord";
import { LiveDoc } from "@msa/durable";
import { afterEach, describe, expect, it } from "vite-plus/test";

import { allEntries, chatSetup } from "./chat-support.ts";
import { addTool } from "./harness-support.ts";
import {
  DONE,
  call,
  text,
  results,
  open,
  tool,
  sqlitePath,
  removeDirectories,
} from "./harness-tools-recovery-support.ts";
import { context } from "./session-support.ts";
import { aborted, deferred } from "./task-support.ts";

afterEach(removeDirectories);

describe("tool recovery", () => {
  it("lets context derivation answer a faulted tool and continues the run", async () => {
    const path = await sqlitePath();
    const setup = chatSetup();
    // A result that is not strict JSON makes the result commit throw, so the scheduler faults the task.
    addTool(
      setup.registry,
      tool("bad", () =>
        Promise.resolve({ output: [], details: { fn: (() => 1) as unknown as JsonValue } }),
      ),
    );
    const requests: string[] = [];
    setup.faux.setResponses([
      call("bad"),
      (request) => {
        const result = request.messages.find((message) => message.role === "toolResult");
        requests.push(result?.role === "toolResult" ? text(result) : "none");
        return DONE;
      },
    ]);
    const opened = await open(path, setup);
    const settled = await (
      await opened.root.submit({ type: "input", content: "go" }, context)
    ).wait(context);
    expect(settled.status).toBe("done");
    expect(results(await allEntries(opened.root))).toEqual([]);
    expect(requests).toEqual(["Tool result unavailable: history ends before this call completed."]);
    const tasks = await opened.harness.commit(
      (tx) => tx.scanTasks({ conversationId: opened.root.id }, 20),
      context,
    );
    const faulted = tasks.items.find((task) => task.kind === "msa.tool")!;
    expect(faulted.state).toMatchObject({ status: "terminal", outcome: { status: "faulted" } });
    await opened.harness.close(context);
  });
});

describe("tool recovery", () => {
  it("clears the interrupted attempt's progress before a safe rerun", async () => {
    const path = await sqlitePath();
    const setup = chatSetup();
    const started = [deferred(), deferred()];
    let runs = 0;
    addTool(
      setup.registry,
      tool(
        "work",
        async (_args, api, callContext) => {
          const run = runs++;
          if (run === 0) {
            api.diagnostic({ severity: "info", message: "first a" });
            api.diagnostic({ severity: "info", message: "first b" });
            await api.details({ run: 1, extra: true }, callContext);
          } else {
            api.diagnostic({ severity: "info", message: "second" });
            await api.details({ run: 2 }, callContext);
          }
          started[run]!.resolve();
          await aborted(callContext.abortSignal!);
          return {};
        },
        { replay: "safe" },
      ),
    );
    setup.faux.setResponses([call("work"), DONE]);
    let opened = await open(path, setup);
    await opened.root.submit({ type: "input", content: "go" }, context);
    await started[0]!.promise;
    await opened.harness.close(context);

    opened = await open(path, setup);
    await started[1]!.promise;
    const slot = (await opened.harness.snapshot(LiveDoc, opened.root.id, context))?.tools?.[0];
    expect(slot?.diagnostics).toEqual([{ severity: "info", message: "second" }]);
    expect(slot?.details).toEqual({ run: 2 });
    await opened.harness.close(context);
  });
});
