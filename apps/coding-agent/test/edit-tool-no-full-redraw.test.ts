import testing from "@msa/testing";
import tuiModule from "@msa/tui";
import type tuiTypes from "@msa/tui/index.types";
import { Effect } from "effect";
import { afterEach, beforeAll, describe, expect, it } from "vite-plus/test";

import editDiff from "../src/core/tools/edit-diff.ts";
import edit from "../src/core/tools/edit.ts";
import codingAgent from "../src/index.ts";
import editToolNoFullRedrawSupport from "./edit-tool-no-full-redraw-support.ts";
import FakeTerminal from "./fake-terminal.ts";

const { ToolExecutionComponent } = codingAgent;
const { initTheme } = codingAgent;

const { computeEditsDiff } = editDiff;
const { createEditToolDefinition } = edit;
const { Container, Text, TuiMainScreen } = tuiModule;

const { createLargeEdits, tempDirs, waitForRender, waitForRenderedText } =
  editToolNoFullRedrawSupport;

const { awaited, joinPath, makeTempDir, readTextFile, removeDirs, runTest, writeTextFile } =
  testing;

const renderLargeEditPreview = () =>
  Effect.gen(function* () {
    const dir = yield* makeTempDir("msa-edit-redraw-");
    tempDirs.push(dir);
    const filePath = joinPath(dir, "large-edit.txt");
    yield* writeTextFile(
      filePath,
      `${Array.from({ length: 1000 }, (_, i) => `line ${i}`).join("\n")}
`,
    );
    const lines = (yield* readTextFile(filePath)).trimEnd().split("\n");
    const edits = createLargeEdits(lines);
    const diff = yield* awaited(computeEditsDiff(filePath, edits, process.cwd()));
    if ("error" in diff) {
      throw new Error(diff.error);
    }

    const terminal = new FakeTerminal();
    const tui: tuiTypes.TUI = new TuiMainScreen(terminal);
    const root = new Container();
    for (let i = 0; i < 200; i++) {
      root.addChild(new Text(`history ${i}`, 0, 0));
    }

    const component = new ToolExecutionComponent(
      "edit",
      "tool-call-1",
      { edits, path: filePath },
      {},
      createEditToolDefinition(process.cwd()),
      tui,
      process.cwd(),
    );
    component.setExpanded(true);
    return { component, diff, edits, filePath, root, terminal, tui };
  });

const afterEachHook = () => runTest(removeDirs(tempDirs.splice(0)));

const rendersTheLargeDiffInTheCall = Effect.gen(function* () {
  const { component, diff, edits, filePath, root, terminal, tui } = yield* renderLargeEditPreview();
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
          text: `Successfully replaced ${edits.length} block(s) in ${filePath}.`,
          type: "text" as const,
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
});

describe("edit tool TUI rendering", () => {
  beforeAll(() => {
    initTheme("dark");
  });

  afterEach(afterEachHook);

  it("renders the large diff in the call preview and does not full-redraw when the result settles", () =>
    runTest(rendersTheLargeDiffInTheCall));
});
