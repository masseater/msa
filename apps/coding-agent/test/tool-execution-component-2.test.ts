import testing from "@msa/testing";
import { resetCapabilitiesCache } from "@msa/tui";
import { Effect } from "effect";
import { afterEach, beforeAll, describe, expect, test, vi } from "vite-plus/test";

import { type BashOperations, createBashToolDefinition } from "../src/core/tools/bash.ts";
import { ToolExecutionComponent } from "../src/modes/interactive/components/tool-execution.ts";
import { initTheme } from "../src/modes/interactive/theme/theme.ts";
import { stripAnsi } from "../src/utils/ansi.ts";
import toolExecutionComponentSupport from "./tool-execution-component-support.ts";

const { createFakeTui } = toolExecutionComponentSupport;

const { awaited, runTest } = testing;

const bashExecuteEmitsAnInitialEmptyPartial = Effect.gen(function* () {
  const effectRunPromise = Effect.runPromiseWith(yield* Effect.context<never>());

  const updates: Array<{
    content: Array<{ type: string; text?: string }>;
    details?: unknown;
  }> = [];
  const operations: BashOperations = {
    exec: () =>
      effectRunPromise(
        Effect.gen(function* () {
          yield* Effect.sleep(10);
          return yield* awaited({ exitCode: 0 });
        }),
      ),
  };
  const tool = createBashToolDefinition(process.cwd(), {
    exposeSessionEnvironment: false,
    operations,
  });
  const promise = tool.execute(
    "tool-bash-1",
    { command: "sleep 10" },
    undefined,
    (update) =>
      updates.push(
        update as { content: Array<{ type: string; text?: string }>; details?: unknown },
      ),
    {} as never,
  );
  expect(updates).toEqual([{ content: [], details: undefined }]);
  yield* awaited(promise);
});

const bashRendererDoesNotDuplicateFinalFull = Effect.gen(function* () {
  const effectRunPromise = Effect.runPromiseWith(yield* Effect.context<never>());

  const operations: BashOperations = {
    exec: (_command, _cwd, { onData }) =>
      effectRunPromise(
        Effect.gen(function* () {
          for (let i = 1; i <= 4000; i++) {
            onData(Buffer.from(`line-${String(i).padStart(4, "0")}\n`));
          }
          return yield* awaited({ exitCode: 0 });
        }),
      ),
  };
  const tool = createBashToolDefinition(process.cwd(), {
    exposeSessionEnvironment: false,
    operations,
  });
  const result = yield* awaited(
    tool.execute("tool-bash-1b", { command: "generate output" }, undefined, undefined, {} as never),
  );
  const component = new ToolExecutionComponent(
    "bash",
    "tool-bash-1b",
    { command: "generate output" },
    {},
    tool,
    createFakeTui(),
    process.cwd(),
  );
  component.setExpanded(true);
  component.updateResult({ ...result, isError: false }, false);

  const rendered = stripAnsi(component.render(200).join("\n"));
  expect(rendered.match(/Full output:/gu)?.length ?? 0).toBe(1);
  expect(rendered).toMatch(/line-4000[^\n]*\n[^\S\n]*\n \[Full output:/u);
  expect(rendered).not.toMatch(/line-4000[^\n]*\n[^\S\n]*\n[^\S\n]*\n \[Full output:/u);
  expect(rendered).toContain("Truncated: showing 2000 of 4000 lines");
  expect(rendered).not.toContain("[Showing lines 2001-4000 of 4000. Full output:");
});

const bashRendererShowsAResultSRecorded = () => {
  const render = (live: boolean): string => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    const component = new ToolExecutionComponent(
      "bash",
      "tool-bash-recorded",
      { command: "sleep 4" },
      {},
      createBashToolDefinition(process.cwd(), { exposeSessionEnvironment: false }),
      createFakeTui(),
      process.cwd(),
    );
    if (live) {
      component.markExecutionStarted();
      component.updateResult({ content: [], isError: false }, true);

      vi.advanceTimersByTime(3_600_000);
    }
    component.updateResult({ content: [], durationMs: 4_200, isError: false }, false);
    return stripAnsi(component.render(120).join("\n"));
  };
  expect(render(true)).toContain("Took 4.2s");
  expect(render(false)).toContain("Took 4.2s");
};

const bashCollapsesToTheCommandSFirst = () => {
  const component = new ToolExecutionComponent(
    "bash",
    "tool-bash-collapsed",
    { command: "echo start\necho middle\necho end" },
    {},
    createBashToolDefinition(process.cwd(), { exposeSessionEnvironment: false }),
    createFakeTui(),
    process.cwd(),
  );
  component.updateResult(
    {
      content: [{ text: "start\nmiddle\nend", type: "text" as const }],
      durationMs: 1_000,
      isError: false,
    },
    false,
  );
  const collapsed = stripAnsi(component.render(120).join("\n"))
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  expect(collapsed).toEqual([
    expect.stringMatching(/^\$ echo start \(\+2 lines\)$/u),
    expect.stringMatching(/^3 lines, Took 1\.0s \(.* to expand\) {2}end$/u),
  ]);

  component.setExpanded(true);
  const expanded = stripAnsi(component.render(120).join("\n"));
  expect(expanded).toContain("echo middle");
  expect(expanded).toContain("middle\nend".split("\n")[0]);
  expect(expanded).not.toContain("to expand");
};

describe("ToolExecutionComponent parity", () => {
  beforeAll(() => {
    initTheme("dark");
  });

  afterEach(() => {
    resetCapabilitiesCache();
    vi.useRealTimers();
  });

  test("bash execute emits an initial empty partial update before output arrives", () =>
    runTest(bashExecuteEmitsAnInitialEmptyPartial));

  test("bash renderer does not duplicate final full output truncation details", () =>
    runTest(bashRendererDoesNotDuplicateFinalFull));
});

const DURATION_CASES = [
  { formatted: "0.0s", ms: 0 },
  { formatted: "4.2s", ms: 4_200 },
  { formatted: "59.9s", ms: 59_900 },
  { formatted: "60.0s", ms: 59_999 },
  { formatted: "1m 0s", ms: 60_000 },
  { formatted: "1m 30s", ms: 90_900 },
  { formatted: "26m 32s", ms: 1_592_200 },
  { formatted: "59m 59s", ms: 3_599_999 },
  { formatted: "1h 0m 0s", ms: 3_600_000 },
  { formatted: "2h 3m 4s", ms: 7_384_900 },
];

const renderBashDuration = (ms: number) => {
  vi.useFakeTimers();
  vi.setSystemTime(0);
  const component = new ToolExecutionComponent(
    "bash",
    "tool-bash-duration",
    { command: "long-running-command" },
    {},
    createBashToolDefinition(process.cwd(), { exposeSessionEnvironment: false }),
    createFakeTui(),
    process.cwd(),
  );
  component.markExecutionStarted();
  component.updateResult({ content: [], isError: false }, true);
  vi.advanceTimersByTime(ms);
  component.invalidate();
  const running = stripAnsi(component.render(120).join("\n"));
  component.updateResult({ content: [], isError: false }, false);
  const completed = stripAnsi(component.render(120).join("\n"));
  vi.advanceTimersByTime(1_000);
  component.invalidate();
  expect(stripAnsi(component.render(120).join("\n"))).toBe(completed);
  return { completed, running };
};

describe("ToolExecutionComponent parity", () => {
  beforeAll(() => {
    initTheme("dark");
  });

  afterEach(() => {
    resetCapabilitiesCache();
    vi.useRealTimers();
  });

  test.each(DURATION_CASES)(
    "bash renderer formats $ms ms as $formatted while running and after completion",
    ({ ms, formatted }) => {
      const { completed, running } = renderBashDuration(ms);
      expect(running).toContain(`Elapsed ${formatted}`);
      expect(completed).toContain(`Took ${formatted}`);
    },
  );
});

describe("ToolExecutionComponent parity", () => {
  beforeAll(() => {
    initTheme("dark");
  });

  afterEach(() => {
    resetCapabilitiesCache();
    vi.useRealTimers();
  });

  test(
    "bash renderer shows a result's recorded duration, also for a result restored without a live start",
    bashRendererShowsAResultSRecorded,
  );

  test(
    "bash collapses to the command's first line and the output's last line until expanded",
    bashCollapsesToTheCommandSFirst,
  );
});
