import testing from "@msa/testing";
import type tuiTypes from "@msa/tui/index.types";
import { Effect } from "effect";
import { afterAll, beforeAll, describe, expect, it } from "vite-plus/test";

import { createReadToolDefinition } from "../src/core/tools/read.ts";
import { ToolExecutionComponent } from "../src/modes/interactive/components/tool-execution.ts";
import { TreeSelectorComponent } from "../src/modes/interactive/components/tree-selector.ts";
import { initTheme } from "../src/modes/interactive/theme/theme.ts";
import { stripAnsi } from "../src/utils/ansi.ts";
import readLineRangeSupport from "./read-line-range-support.ts";

const { makeTempDir, removePath, runTest } = testing;

const { READ_ARGS, openTree, writeReadSession } = readLineRangeSupport;

const dirs = { temp: "" };

const showsStringRangesInTheTuiAndTree = Effect.gen(function* () {
  const { result, sessionPath } = yield* writeReadSession(dirs.temp);
  const tool = new ToolExecutionComponent(
    "read",
    "call",
    READ_ARGS,
    {},
    createReadToolDefinition(dirs.temp),
    { requestRender() {} } as tuiTypes.TUI,
    dirs.temp,
  );
  expect(stripAnsi(tool.render(120).join("\n"))).toContain("read notes.txt:25-37");
  const tree = new TreeSelectorComponent(
    openTree(sessionPath),
    result.id,
    40,
    () => {},
    () => {},
  );
  expect(tree.getTreeList().render(120).map(stripAnsi).join("\n")).toContain(
    "[read: notes.txt:25-37]",
  );
});

describe("read line range display", () => {
  beforeAll(() =>
    runTest(
      Effect.gen(function* () {
        initTheme("dark");
        dirs.temp = yield* makeTempDir("msa-read-range-");
      }),
    ),
  );

  afterAll(() => runTest(removePath(dirs.temp)));

  it("shows string ranges in the TUI and session tree", () =>
    runTest(showsStringRangesInTheTuiAndTree));
});
