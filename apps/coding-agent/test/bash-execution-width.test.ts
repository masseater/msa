import { visibleWidth } from "@msa/tui";
import { beforeAll, describe, expect, it } from "vite-plus/test";

import { BashExecutionComponent } from "../src/modes/interactive/components/bash-execution.ts";
import { initTheme } from "../src/modes/interactive/theme/theme.ts";

function createTuiStub(columns: number): { columns: number; stub: any } {
  const state = { columns };
  const stub = {
    addInterval: (_cb: () => void, _ms: number) => ({ dispose: () => {} }),

    removeInterval: () => {},

    requestRender: () => {},

    terminal: {
      get columns() {
        return state.columns;
      },
      get rows() {
        return 24;
      },
    },
  };
  return { columns: state.columns, stub };
}

const collapsedPreviewLinesRespectRenderTimeWidth = () => {
  const wideWidth = 200;
  const narrowWidth = 80;

  const { stub } = createTuiStub(wideWidth);
  const component = new BashExecutionComponent("pwd", stub);

  const longLine = "x".repeat(150);
  component.appendOutput(`${longLine}\n${longLine}\n`);

  component.setComplete(0, false);

  const lines = component.render(narrowWidth);

  for (const [i, line] of lines.entries()) {
    const w = visibleWidth(line);
    expect(w, `Line ${i} visibleWidth=${w} > ${narrowWidth}`).toBeLessThanOrEqual(narrowWidth);
  }
};

const reComputesLinesWhenWidthChangesBetween = () => {
  const { stub } = createTuiStub(200);
  const component = new BashExecutionComponent("echo hello", stub);

  const longLine = "abcdefghij".repeat(20);
  component.appendOutput(`${longLine}\n`);
  component.setComplete(0, false);

  const lines200 = component.render(200);
  for (const line of lines200) {
    expect(visibleWidth(line)).toBeLessThanOrEqual(200);
  }

  const lines60 = component.render(60);
  for (const [i, line] of lines60.entries()) {
    const w = visibleWidth(line);
    expect(w, `Line ${i} visibleWidth=${w} > 60`).toBeLessThanOrEqual(60);
  }
};

describe("BashExecutionComponent width handling (#2569)", () => {
  beforeAll(() => {
    initTheme(undefined, false);
  });

  it(
    "collapsed preview lines respect render-time width, not construction-time width",
    collapsedPreviewLinesRespectRenderTimeWidth,
  );

  it(
    "re-computes lines when width changes between renders",
    reComputesLinesWhenWidthChangesBetween,
  );
});
