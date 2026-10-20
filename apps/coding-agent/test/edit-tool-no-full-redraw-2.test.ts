import testing from "@msa/testing";
import tuiModule from "@msa/tui";
import type tuiTypes from "@msa/tui/index.types";
import { Effect } from "effect";
import { afterEach, beforeAll, describe, expect, it } from "vite-plus/test";

import editDiff from "../src/core/tools/edit-diff.ts";
import edit from "../src/core/tools/edit.ts";
import codingAgent from "../src/index.ts";
import ansi from "../src/utils/ansi.ts";
import editToolNoFullRedrawSupport from "./edit-tool-no-full-redraw-support.ts";
import FakeTerminal from "./fake-terminal.ts";

const { ToolExecutionComponent } = codingAgent;
const { initTheme } = codingAgent;

const { computeEditsDiff } = editDiff;
const { createEditToolDefinition } = edit;
const { stripAnsi } = ansi;
const { TuiMainScreen } = tuiModule;

const { createLargeEdits, tempDirs, waitForRender, waitForRenderedText } =
  editToolNoFullRedrawSupport;

const {
  awaited,
  joinPath,
  makeTempDir,
  readTextFile,
  removeDirs,
  removePath,
  runTest,
  writeTextFile,
} = testing;

const reconstructsTheBoxedPreviewFromASettledPart1 = () =>
  Effect.gen(function* () {
    const dir = yield* makeTempDir("msa-edit-replay-");
    tempDirs.push(dir);
    const filePath = joinPath(dir, "replay-edit.txt");
    yield* writeTextFile(
      filePath,
      `${Array.from({ length: 200 }, (_, i) => `line ${i}`).join("\n")}
`,
    );
    const lines = (yield* readTextFile(filePath)).trimEnd().split("\n");
    const edits = createLargeEdits(lines).slice(0, 2);
    return { edits, filePath };
  });

const reconstructsTheBoxedPreviewFromASettled = Effect.gen(function* () {
  const { edits, filePath } = yield* reconstructsTheBoxedPreviewFromASettledPart1();
  const diff = yield* awaited(computeEditsDiff(filePath, edits, process.cwd()));
  if ("error" in diff) {
    throw new Error(diff.error);
  }
  yield* removePath(filePath);

  const terminal = new FakeTerminal();
  const tui: tuiTypes.TUI = new TuiMainScreen(terminal);
  const component = new ToolExecutionComponent(
    "edit",
    "tool-call-replay",
    { edits, path: filePath },
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
          text: `Successfully replaced ${edits.length} block(s) in ${filePath}.`,
          type: "text" as const,
        },
      ],
      details: diff,
      isError: false,
    },
    false,
  );
  yield* awaited(waitForRender());
  yield* awaited(waitForRender());

  const collapsed = stripAnsi(component.render(80).join("\n"));
  expect(collapsed).toMatch(/\+2 -2 lines \(.* to expand\)/u);
  expect(collapsed).not.toContain("line 50 changed");

  component.setExpanded(true);
  const rendered = component.render(80).join("\n");
  expect(rendered).toContain("line 50 changed");
  expect(rendered).toContain("line 150 changed");
});

const showsAPreflightErrorWithoutRenderingA = Effect.gen(function* () {
  const dir = yield* makeTempDir("msa-edit-preflight-");
  tempDirs.push(dir);
  const filePath = joinPath(dir, "missing-edit.txt");
  yield* writeTextFile(filePath, "line 0\nline 1\n");

  const terminal = new FakeTerminal();
  const tui: tuiTypes.TUI = new TuiMainScreen(terminal);
  const component = new ToolExecutionComponent(
    "edit",
    "tool-call-2",
    { edits: [{ newText: "replacement", oldText: "does not exist" }], path: filePath },
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
});

const afterEachHook2 = () => runTest(removeDirs(tempDirs.splice(0)));

describe("edit tool TUI rendering", () => {
  beforeAll(() => {
    initTheme("dark");
  });

  afterEach(afterEachHook2);

  it("reconstructs the boxed preview from a settled result without argsComplete", () =>
    runTest(reconstructsTheBoxedPreviewFromASettled));

  it("shows a preflight error without rendering a diff when the edits do not apply", () =>
    runTest(showsAPreflightErrorWithoutRenderingA));
});
