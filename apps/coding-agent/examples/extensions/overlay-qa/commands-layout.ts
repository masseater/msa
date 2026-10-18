import type { ExtensionAPI, ExtensionCommandContext } from "@msa/coding-agent";
import type { OverlayAnchor, OverlayOptions } from "@msa/tui";
import { Effect } from "effect";

import { AnchorTestComponent } from "./anchor-test-component.ts";
import { EdgeTestComponent } from "./edge-test-component.ts";
import { MarginTestComponent } from "./margin-test-component.ts";
import { MaxHeightTestComponent } from "./max-height-test-component.ts";
import { PercentTestComponent } from "./percent-test-component.ts";
import { registerOverlayCommand, showOverlay } from "./show-overlay.ts";
import { SidepanelComponent } from "./sidepanel-component.ts";

const ANCHORS: OverlayAnchor[] = [
  "top-left",
  "top-center",
  "top-right",
  "left-center",
  "center",
  "right-center",
  "bottom-left",
  "bottom-center",
  "bottom-right",
];

const MARGIN_CONFIGS: { name: string; options: OverlayOptions }[] = [
  { name: "No margin (top-left)", options: { anchor: "top-left", width: 35 } },
  { name: "Margin: 3 all sides", options: { anchor: "top-left", width: 35, margin: 3 } },
  {
    name: "Margin: top=5, left=10",
    options: { anchor: "top-left", width: 35, margin: { top: 5, left: 10 } },
  },
  {
    name: "Center + offset (10, -3)",
    options: { anchor: "center", width: 35, offsetX: 10, offsetY: -3 },
  },
  { name: "Bottom-right, margin: 2", options: { anchor: "bottom-right", width: 35, margin: 2 } },
];

const PERCENT_CONFIGS = [
  { name: "rowPercent: 0 (top)", row: 0, col: 50 },
  { name: "rowPercent: 50 (middle)", row: 50, col: 50 },
  { name: "rowPercent: 100 (bottom)", row: 100, col: 50 },
  { name: "colPercent: 0 (left)", row: 50, col: 0 },
  { name: "colPercent: 100 (right)", row: 50, col: 100 },
];

const registerAnchors = (msa: ExtensionAPI): void => {
  msa.registerCommand("overlay-anchors", {
    description: "Cycle through all anchor positions",
    handler: (_args: string, ctx: ExtensionCommandContext) =>
      Effect.runPromise(
        Effect.gen(function* () {
          let index = 0;
          while (true) {
            const anchor = ANCHORS[index];
            if (anchor === undefined) throw new Error(`No anchor at index ${index}`);
            const result = yield* Effect.promise(() =>
              showOverlay<"next" | "confirm" | "cancel">({
                ctx,
                factory: (_tui, theme, _kb, done) => new AnchorTestComponent(theme, anchor, done),
                overlayOptions: { anchor, width: 40 },
              }),
            );

            if (result === "next") {
              index = (index + 1) % ANCHORS.length;
              continue;
            }
            if (result === "confirm") {
              ctx.ui.notify(`Selected: ${ANCHORS[index]}`, "info");
            }
            return;
          }
        }),
      ),
  });
};

const registerMargins = (msa: ExtensionAPI): void => {
  msa.registerCommand("overlay-margins", {
    description: "Test margin and offset options",
    handler: (_args: string, ctx: ExtensionCommandContext) =>
      Effect.runPromise(
        Effect.gen(function* () {
          let index = 0;
          while (true) {
            const config = MARGIN_CONFIGS[index]!;
            const result = yield* Effect.promise(() =>
              showOverlay<"next" | "close">({
                ctx,
                factory: (_tui, theme, _kb, done) => new MarginTestComponent(theme, config, done),
                overlayOptions: config.options,
              }),
            );

            if (result === "next") {
              index = (index + 1) % MARGIN_CONFIGS.length;
              continue;
            }
            return;
          }
        }),
      ),
  });
};

const registerPercent = (msa: ExtensionAPI): void => {
  msa.registerCommand("overlay-percent", {
    description: "Test percentage-based positioning",
    handler: (_args: string, ctx: ExtensionCommandContext) =>
      Effect.runPromise(
        Effect.gen(function* () {
          let index = 0;
          while (true) {
            const config = PERCENT_CONFIGS[index]!;
            const result = yield* Effect.promise(() =>
              showOverlay<"next" | "close">({
                ctx,
                factory: (_tui, theme, _kb, done) => new PercentTestComponent(theme, config, done),
                overlayOptions: { width: 30, row: `${config.row}%`, col: `${config.col}%` },
              }),
            );

            if (result === "next") {
              index = (index + 1) % PERCENT_CONFIGS.length;
              continue;
            }
            return;
          }
        }),
      ),
  });
};

const registerEdge = (msa: ExtensionAPI): void => {
  registerOverlayCommand({
    msa,
    name: "overlay-edge",
    description: "Test overlay positioned at terminal edge",
    overlayOptions: { anchor: "right-center", width: 40, margin: { right: 0 } },
    component: () => (_tui, theme, _kb, done) => new EdgeTestComponent(theme, done),
  });
};

const registerMaxHeight = (msa: ExtensionAPI): void => {
  registerOverlayCommand({
    msa,
    name: "overlay-maxheight",
    description: "Test maxHeight truncation",
    overlayOptions: { anchor: "center", width: 50, maxHeight: 10 },
    component: () => (_tui, theme, _kb, done) => new MaxHeightTestComponent(theme, done),
  });
};

const registerSidepanel = (msa: ExtensionAPI): void => {
  registerOverlayCommand({
    msa,
    name: "overlay-sidepanel",
    description: "Test responsive sidepanel (hides when terminal < 100 cols)",
    overlayOptions: {
      anchor: "right-center",
      width: "25%",
      minWidth: 30,
      margin: { right: 1 },
      visible: (termWidth) => termWidth >= 100,
    },
    component: () => (tui, theme, _kb, done) => new SidepanelComponent(tui, theme, done),
  });
};

export const registerLayoutCommands = (msa: ExtensionAPI): void => {
  registerAnchors(msa);
  registerMargins(msa);
  registerPercent(msa);
  registerEdge(msa);
  registerMaxHeight(msa);
  registerSidepanel(msa);
};
