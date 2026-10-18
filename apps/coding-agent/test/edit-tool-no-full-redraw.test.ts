import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { stripVTControlCharacters } from "node:util";

import { awaited, runTest, currentTimeMillis, joinPath } from "@msa/testing";
import { Container, type Terminal, Text, type TUI, TuiMainScreen } from "@msa/tui";
import { Effect } from "effect";
import { afterEach, beforeAll, describe, expect, it } from "vite-plus/test";

import { computeEditsDiff, type Edit } from "../src/core/tools/edit-diff.ts";
import { createEditToolDefinition } from "../src/core/tools/edit.ts";
import { ToolExecutionComponent } from "../src/modes/interactive/components/tool-execution.ts";
import { initTheme } from "../src/modes/interactive/theme/theme.ts";

class FakeTerminal implements Terminal {
  columns = 80;
  rows = 24;
  kittyProtocolActive = true;
  writes: string[] = [];

  start(): void {}
  stop(): void {}
  drainInput(): Promise<void> {
    return runTest(Effect.sync(() => {}));
  }
  write(data: string): void {
    this.writes.push(data);
  }
  moveBy(_lines: number): void {}
  hideCursor(): void {}
  showCursor(): void {}
  clearLine(): void {}
  clearFromCursor(): void {}
  clearScreen(): void {}
  setTitle(_title: string): void {}
  setProgress(_active: boolean): void {}
  setProgramStatus(): void {}

  get fullClearCount(): number {
    return this.writes.filter((write) => write.includes("\x1b[2J\x1b[H\x1b[3J")).length;
  }
}

function waitForRender(): Promise<void> {
  return runTest(
    Effect.gen(function* () {
      yield* Effect.sleep(0);
    }),
  );
}

function waitForRenderedText(
  getRender: () => string,
  expectedText: string,
  onRetry?: () => void,
  timeoutMs = 2000,
): Promise<string> {
  return runTest(
    Effect.gen(function* () {
      const deadline = currentTimeMillis() + timeoutMs;
      let lastRender = "";
      while (currentTimeMillis() < deadline) {
        onRetry?.();
        yield* awaited(waitForRender());
        lastRender = getRender();
        if (lastRender.includes(expectedText)) {
          return yield* awaited(lastRender);
        }
      }
      throw new Error(
        `Timed out waiting for render to include "${expectedText}". Last render:\n${lastRender}`,
      );
    }),
  );
}

function createLargeEdits(lines: string[]): Edit[] {
  const targets = [50, 150, 250, 350, 450, 550, 650, 750, 850, 950];
  return targets.map((lineNumber) => ({
    oldText: `${lines[lineNumber - 1]}\n${lines[lineNumber]}\n${lines[lineNumber + 1]}`,
    newText: `${lines[lineNumber - 1]}\n${lines[lineNumber]} changed\n${lines[lineNumber + 1]}`,
  }));
}

describe("edit tool TUI rendering", () => {
  const tempDirs: string[] = [];

  beforeAll(() => {
    initTheme("dark");
  });

  afterEach(() =>
    runTest(
      Effect.gen(function* () {
        yield* awaited(
          Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true }))),
        );
      }),
    ),
  );

  it("renders the large diff in the call preview and does not full-redraw when the result settles", () =>
    runTest(
      Effect.gen(function* () {
        const dir = yield* awaited(mkdtemp(joinPath(tmpdir(), "msa-edit-redraw-")));
        tempDirs.push(dir);
        const filePath = joinPath(dir, "large-edit.txt");
        yield* awaited(
          writeFile(
            filePath,
            `${Array.from({ length: 1000 }, (_, i) => `line ${i}`).join("\n")}
`,
            "utf8",
          ),
        );
        const lines = (yield* awaited(readFile(filePath, "utf8"))).trimEnd().split("\n");
        const edits = createLargeEdits(lines);
        const diff = yield* awaited(computeEditsDiff(filePath, edits, process.cwd()));
        if ("error" in diff) {
          throw new Error(diff.error);
        }

        const terminal = new FakeTerminal();
        const tui: TUI = new TuiMainScreen(terminal);
        const root = new Container();
        for (let i = 0; i < 200; i++) {
          root.addChild(new Text(`history ${i}`, 0, 0));
        }

        const component = new ToolExecutionComponent(
          "edit",
          "tool-call-1",
          { path: filePath, edits },
          {},
          createEditToolDefinition(process.cwd()),
          tui,
          process.cwd(),
        );
        component.setExpanded(true);
        root.addChild(component);
        tui.addChild(root);
        tui.start();
        yield* awaited(waitForRender());

        component.setArgsComplete();
        tui.requestRender();
        yield* awaited(waitForRender());
        yield* awaited(waitForRender());

        const callOnlyRender = yield* awaited(
          waitForRenderedText(
            () => component.render(80).join("\n"),
            "line 50 changed",
            () => tui.requestRender(true),
          ),
        );
        expect(callOnlyRender).toContain("edit");
        expect(callOnlyRender).toContain("line 950 changed");

        const redrawsBeforeResult = tui.fullRedraws;
        const clearsBeforeResult = terminal.fullClearCount;
        component.updateResult(
          {
            content: [
              {
                type: "text" as const,
                text: `Successfully replaced ${edits.length} block(s) in ${filePath}.`,
              },
            ],
            details: diff,
            isError: false,
          },
          false,
        );
        tui.requestRender();
        yield* awaited(waitForRender());

        expect(tui.fullRedraws).toBe(redrawsBeforeResult);
        expect(terminal.fullClearCount).toBe(clearsBeforeResult);

        const settledRender = component.render(80).join("\n");
        expect(settledRender).toContain("line 50 changed");
        expect(settledRender).toContain("line 950 changed");
        expect(settledRender).not.toContain("Successfully replaced");
      }),
    ));

  it("reconstructs the boxed preview from a settled result without argsComplete", () =>
    runTest(
      Effect.gen(function* () {
        const dir = yield* awaited(mkdtemp(joinPath(tmpdir(), "msa-edit-replay-")));
        tempDirs.push(dir);
        const filePath = joinPath(dir, "replay-edit.txt");
        yield* awaited(
          writeFile(
            filePath,
            `${Array.from({ length: 200 }, (_, i) => `line ${i}`).join("\n")}
`,
            "utf8",
          ),
        );
        const lines = (yield* awaited(readFile(filePath, "utf8"))).trimEnd().split("\n");
        const edits = createLargeEdits(lines).slice(0, 2);
        const diff = yield* awaited(computeEditsDiff(filePath, edits, process.cwd()));
        if ("error" in diff) {
          throw new Error(diff.error);
        }
        yield* awaited(rm(filePath, { force: true }));

        const terminal = new FakeTerminal();
        const tui: TUI = new TuiMainScreen(terminal);
        const component = new ToolExecutionComponent(
          "edit",
          "tool-call-replay",
          { path: filePath, edits },
          {},
          createEditToolDefinition(process.cwd()),
          tui,
          process.cwd(),
        );
        tui.addChild(component);
        tui.start();
        yield* awaited(waitForRender());

        component.updateResult(
          {
            content: [
              {
                type: "text" as const,
                text: `Successfully replaced ${edits.length} block(s) in ${filePath}.`,
              },
            ],
            details: diff,
            isError: false,
          },
          false,
        );
        yield* awaited(waitForRender());
        yield* awaited(waitForRender());

        const collapsed = stripVTControlCharacters(component.render(80).join("\n"));
        expect(collapsed).toMatch(/\+2 -2 lines \(.* to expand\)/u);
        expect(collapsed).not.toContain("line 50 changed");

        component.setExpanded(true);
        const rendered = component.render(80).join("\n");
        expect(rendered).toContain("line 50 changed");
        expect(rendered).toContain("line 150 changed");
      }),
    ));

  it("shows a preflight error without rendering a diff when the edits do not apply", () =>
    runTest(
      Effect.gen(function* () {
        const dir = yield* awaited(mkdtemp(joinPath(tmpdir(), "msa-edit-preflight-")));
        tempDirs.push(dir);
        const filePath = joinPath(dir, "missing-edit.txt");
        yield* awaited(writeFile(filePath, "line 0\nline 1\n", "utf8"));

        const terminal = new FakeTerminal();
        const tui: TUI = new TuiMainScreen(terminal);
        const component = new ToolExecutionComponent(
          "edit",
          "tool-call-2",
          { path: filePath, edits: [{ oldText: "does not exist", newText: "replacement" }] },
          {},
          createEditToolDefinition(process.cwd()),
          tui,
          process.cwd(),
        );
        tui.addChild(component);
        tui.start();
        yield* awaited(waitForRender());

        component.setArgsComplete();
        tui.requestRender();
        yield* awaited(waitForRender());
        yield* awaited(waitForRender());

        const rendered = yield* awaited(
          waitForRenderedText(
            () => component.render(80).join("\n"),
            "Could not find",
            () => tui.requestRender(true),
          ),
        );
        expect(rendered).not.toContain("+1 ");
        expect(rendered).not.toContain("-1 ");
      }),
    ));
});
