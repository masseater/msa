import { rm } from "node:fs/promises";

import {
  type Harness,
  LiveDoc,
  type NestedToolExecutionResult,
  type ToolTaskInput,
} from "@msa/durable";
import { ToolTask } from "@msa/durable/harness";
import { afterEach, describe, expect, it } from "vite-plus/test";

import { chatSetup } from "./chat-support.ts";
import {
  DONE,
  call,
  tool,
  directories,
  sqlitePath,
  codes,
  nestedTasks,
  restartDuring,
  open,
} from "./harness-nested-tools-restart-support.ts";
import { addTool } from "./harness-support.ts";
import { context } from "./session-support.ts";
import { aborted, deferred } from "./task-support.ts";

afterEach(async () => {
  for await (const directory of directories) await rm(directory, { recursive: true, force: true });
  directories.clear();
});

// Record how many nested call slots `msa.live` lists in the commit that ends the model-issued call.
function slotsAtCallerEnd(harness: Harness) {
  const seen: { slots?: number } = {};
  harness.subscribeCommits((publication) => {
    for (const change of publication.changes) {
      if (change.type !== "task" || change.value.kind !== ToolTask.definition.name) continue;
      if (
        (change.value.input as ToolTaskInput).kind !== "model" ||
        change.value.state.status !== "terminal"
      )
        continue;
      const live = publication.changes.find(
        (each) => each.type === "document" && each.record.kind === "msa.live",
      );
      const value =
        live?.type === "document" ? (live.value as { nestedTools?: unknown[] } | null) : undefined;
      seen.slots = value?.nestedTools?.length ?? 0;
    }
  });
  return seen;
}

async function replaySafeBatch() {
  const path = await sqlitePath();
  const setup = chatSetup();
  const runs = { safe: 0, unsafe: 0, caller: 0 };
  const running = { safe: deferred(), unsafe: deferred() };
  addTool(
    setup.registry,
    tool(
      "safe",
      async (_args, _api, callContext) => {
        runs.safe++;
        if (runs.safe === 1) {
          running.safe.resolve();
          await aborted(callContext.abortSignal!);
        }
        return { output: [{ type: "text", text: `safe run ${runs.safe}` }] };
      },
      { replay: "safe" },
    ),
  );
  addTool(
    setup.registry,
    tool("unsafe", (_args, _api, callContext) => {
      runs.unsafe++;
      running.unsafe.resolve();
      return Promise.resolve(aborted(callContext.abortSignal!));
    }),
  );
  return { path, setup, runs, running };
}

describe("nested tool calls across a restart", () => {
  it("marks nothing when the reopened Harness never starts scheduling", async () => {
    const path = await sqlitePath();
    const setup = chatSetup();
    const running = deferred();
    addTool(
      setup.registry,
      tool("hang", (_args, _api, callContext) => {
        running.resolve();
        return Promise.resolve(aborted(callContext.abortSignal!));
      }),
    );
    addTool(
      setup.registry,
      tool("batch", async (_args, api, callContext) => {
        await api.executeTool("hang", {}, callContext);
        return {};
      }),
    );
    setup.faux.setResponses([call("batch"), DONE]);
    let opened = await open(path, setup);
    await opened.root.submit({ type: "input", content: "go" }, context);
    await running.promise;
    await opened.harness.close(context);

    // An inspection-only open: no resume, no submission.
    opened = await open(path, setup);
    const inspected = await opened.harness.inspect(context);
    expect(inspected.scheduling).toBe("paused");
    await opened.harness.close(context);

    opened = await open(path, setup);
    const [nested] = await nestedTasks(opened.harness);
    expect(nested).toMatchObject({ abandonOnRestart: true, abortRequested: false });
    expect(nested!.state.status).toBe("pending");
    await opened.harness.close(context);
  });
});

describe("nested tool calls across a restart", () => {
  it("lets a replay-safe caller's unfinished nested calls recover and reattaches to them by key", async () => {
    const { path, setup, runs, running } = await replaySafeBatch();
    let results_: NestedToolExecutionResult[] = [];
    addTool(
      setup.registry,
      tool(
        "batch",
        async (_args, api, callContext) => {
          runs.caller++;
          results_ = await Promise.all([
            api.executeTool("safe", {}, callContext),
            api.executeTool("unsafe", {}, callContext),
          ]);
          return {};
        },
        { replay: "safe" },
      ),
    );
    setup.faux.setResponses([call("batch"), DONE]);
    const { opened, id } = await restartDuring(
      path,
      setup,
      Promise.all([running.safe.promise, running.unsafe.promise]),
    );
    opened.harness.resume();
    expect((await (await opened.harness.submission(id, context))!.wait(context)).status).toBe(
      "done",
    );
    expect(runs).toEqual({ safe: 2, unsafe: 1, caller: 2 });
    // Default keys follow call order, so the rerun found both calls.
    expect(await nestedTasks(opened.harness)).toHaveLength(2);
    for (const task of await nestedTasks(opened.harness)) {
      expect(task.abandonOnRestart).toBeUndefined();
      expect(task.abortReason).toBeUndefined();
    }
    expect(results_[0]?.structuredOutput).toBe("safe run 2");
    expect(codes(results_[1])).toEqual(["interrupted"]);
    await opened.harness.close(context);
  });
});

describe("nested tool calls across a restart", () => {
  it("clears the slots of nested calls an earlier attempt finished when the rerun makes none", async () => {
    const path = await sqlitePath();
    const setup = chatSetup();
    const finished = deferred();
    let attempts = 0;
    addTool(
      setup.registry,
      tool("quick", () => Promise.resolve({ output: [{ type: "text", text: "ok" }] })),
    );
    addTool(
      setup.registry,
      tool(
        "caller",
        async (_args, api, callContext) => {
          attempts++;
          if (attempts === 1) {
            await api.executeTool("quick", {}, callContext);
            finished.resolve();
            return aborted(callContext.abortSignal!);
          }
          return { output: [{ type: "text", text: "done" }] };
        },
        { replay: "safe" },
      ),
    );
    setup.faux.setResponses([call("caller"), DONE]);
    let opened = await open(path, setup);
    const id = (await opened.root.submit({ type: "input", content: "go" }, context)).id;
    await finished.promise;
    // The finished nested call's slot is still listed, below its running caller.
    expect(
      (await opened.harness.snapshot(LiveDoc, opened.root.id, context))?.nestedTools,
    ).toHaveLength(1);
    await opened.harness.close(context);

    opened = await open(path, setup);
    const afterCaller = slotsAtCallerEnd(opened.harness);
    opened.harness.resume();
    expect((await (await opened.harness.submission(id, context))!.wait(context)).status).toBe(
      "done",
    );
    expect(attempts).toBe(2);
    // The caller's terminal commit removed the slot, though the rerun made no nested call.
    expect(afterCaller.slots).toBe(0);
    await opened.harness.close(context);
  });
});

describe("nested tool calls across a restart", () => {
  it("aborts a nested call an earlier attempt of a replay-safe caller left running and the rerun never made again", async () => {
    const path = await sqlitePath();
    const setup = chatSetup();
    const running = deferred();
    let attempts = 0;
    addTool(
      setup.registry,
      tool(
        "slow",
        (_args, _api, callContext) => {
          running.resolve();
          return Promise.resolve(aborted(callContext.abortSignal!));
        },
        { replay: "safe" },
      ),
    );
    addTool(
      setup.registry,
      tool(
        "caller",
        async (_args, api, callContext) => {
          attempts++;
          // Only the first attempt calls `slow`; the rerun after the restart returns at once.
          if (attempts === 1) await api.executeTool("slow", {}, callContext, { key: "slow" });
          return { output: [{ type: "text", text: "done" }] };
        },
        { replay: "safe" },
      ),
    );
    setup.faux.setResponses([call("caller"), DONE]);
    const { opened, id } = await restartDuring(path, setup, running.promise);
    opened.harness.resume();
    expect((await (await opened.harness.submission(id, context))!.wait(context)).status).toBe(
      "done",
    );
    expect(attempts).toBe(2);
    // The rerun's settlement found the leftover call among the tasks it owns and aborted it.
    const [leftover] = await nestedTasks(opened.harness);
    expect(leftover?.state).toMatchObject({ status: "terminal", outcome: { status: "aborted" } });
    await opened.harness.close(context);
  });
});
