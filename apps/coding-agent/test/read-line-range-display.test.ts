import testing from "@msa/testing";
import { Effect } from "effect";
import { afterAll, beforeAll, describe, expect, it } from "vite-plus/test";

import { formatReadLineRange } from "../src/core/tools/render-utils.ts";
import { initTheme } from "../src/modes/interactive/theme/theme.ts";
import readLineRangeSupport from "./read-line-range-support.ts";

const { makeTempDir, removePath, runTest } = testing;

const { RANGE_CASES, exportViewer, writeReadSession } = readLineRangeSupport;

const dirs = { temp: "" };

const formatsRawReadArguments = () => {
  for (const [offset, limit, range] of RANGE_CASES) {
    expect(formatReadLineRange(offset, limit), `${offset}, ${limit}`).toBe(range);
  }
};

const showsStringRangesInTheHtmlExport = Effect.gen(function* () {
  const { assistant, result, sessionPath } = yield* writeReadSession(dirs.temp);
  const viewer = yield* exportViewer(sessionPath, dirs.temp);
  for (const [offset, limit, range] of RANGE_CASES) {
    expect(viewer.formatReadLineRange(offset, limit), `${offset}, ${limit}`).toBe(range);
  }
  expect(viewer.getTreeNodeDisplayHtml(result)).toBe(
    '<span class="tree-role-tool">[read: notes.txt:25-37]</span>',
  );
  expect(viewer.renderEntry(assistant)).toContain('<span class="line-numbers">:25-37</span>');
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

  it("formats raw read arguments", formatsRawReadArguments);

  it("shows string ranges in the HTML export", () => runTest(showsStringRangesInTheHtmlExport));
});
