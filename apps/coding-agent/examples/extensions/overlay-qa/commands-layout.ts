import type { ExtensionAPI, ExtensionCommandContext } from "@msa/coding-agent";
import type tuiTypes from "@msa/tui/index.types";
import { Effect } from "effect";

import { AnchorTestComponent } from "./anchor-test-component.ts";
import { EdgeTestComponent } from "./edge-test-component.ts";
import { MarginTestComponent } from "./margin-test-component.ts";
import { MaxHeightTestComponent } from "./max-height-test-component.ts";
import { PercentTestComponent } from "./percent-test-component.ts";
import { registerOverlayCommand, showOverlay } from "./show-overlay.ts";
import { SidepanelComponent } from "./sidepanel-component.ts";

const ANCHORS: tuiTypes.OverlayAnchor[] = [
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

const MARGIN_CONFIGS: { name: string; options: tuiTypes.OverlayOptions }[] = [
  { name: "No margin (top-left)", options: { anchor: "top-left", width: 35 } },
  { name: "Margin: 3 all sides", options: { anchor: "top-left", margin: 3, width: 35 } },
  {
    name: "Margin: top=5, left=10",
    options: { anchor: "top-left", margin: { left: 10, top: 5 }, width: 35 },
  },
  {
    name: "Center + offset (10, -3)",
    options: { anchor: "center", offsetX: 10, offsetY: -3, width: 35 },
  },
  { name: "Bottom-right, margin: 2", options: { anchor: "bottom-right", margin: 2, width: 35 } },
];

const PERCENT_CONFIGS = [
  { col: 50, name: "rowPercent: 0 (top)", row: 0 },
  { col: 50, name: "rowPercent: 50 (middle)", row: 50 },
  { col: 50, name: "rowPercent: 100 (bottom)", row: 100 },
  { col: 0, name: "colPercent: 0 (left)", row: 50 },
  { col: 100, name: "colPercent: 100 (right)", row: 50 },
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
                overlayOptions: { col: `${config.col}%`, row: `${config.row}%`, width: 30 },
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
    component: () => (_tui, theme, _kb, done) => new EdgeTestComponent(theme, done),
    description: "Test overlay positioned at terminal edge",
    msa,
    name: "overlay-edge",
    overlayOptions: { anchor: "right-center", margin: { right: 0 }, width: 40 },
  });
};

const registerMaxHeight = (msa: ExtensionAPI): void => {
  registerOverlayCommand({
    component: () => (_tui, theme, _kb, done) => new MaxHeightTestComponent(theme, done),
    description: "Test maxHeight truncation",
    msa,
    name: "overlay-maxheight",
    overlayOptions: { anchor: "center", maxHeight: 10, width: 50 },
  });
};

const registerSidepanel = (msa: ExtensionAPI): void => {
  registerOverlayCommand({
    component: () => (tui, theme, _kb, done) => new SidepanelComponent(tui, theme, done),
    description: "Test responsive sidepanel (hides when terminal < 100 cols)",
    msa,
    name: "overlay-sidepanel",
    overlayOptions: {
      anchor: "right-center",
      margin: { right: 1 },
      minWidth: 30,
      visible: (termWidth) => termWidth >= 100,
      width: "25%",
    },
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
