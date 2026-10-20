import type tuiTypes from "@msa/tui/index.types";
import { describe, expect, it, vi } from "vite-plus/test";

import { createInteractiveTuiReference } from "../../../src/modes/interactive/interactive-mode.ts";

const callsTheMethodCapturedBeforeA = () => {
  const renderer = {
    render: (width: number) => [`width: ${width}`],
  } as unknown as tuiTypes.TUI;
  const tui = createInteractiveTuiReference(() => renderer);
  const originalRender = tui.render;
  tui.render = (width: number) => originalRender(width);

  expect(tui.render(80)).toEqual(["width: 80"]);
};

const routesACapturedMethodToA = () => {
  const regularRequestRender = vi.fn();
  const fullscreenRequestRender = vi.fn();
  let renderer = { requestRender: regularRequestRender } as unknown as tuiTypes.TUI;
  const tui = createInteractiveTuiReference(() => renderer);
  const requestRender = tui.requestRender;

  requestRender();
  renderer = { requestRender: fullscreenRequestRender } as unknown as tuiTypes.TUI;
  requestRender();

  expect(regularRequestRender).toHaveBeenCalledOnce();
  expect(fullscreenRequestRender).toHaveBeenCalledOnce();
};

describe("TUI method wrapping", () => {
  it("calls the method captured before a replacement", callsTheMethodCapturedBeforeA);
  it("routes a captured method to a replacement renderer", routesACapturedMethodToA);
});
