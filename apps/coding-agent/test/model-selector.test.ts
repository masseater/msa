import testing from "@msa/testing";
import tui from "@msa/tui";
import type tuiTypes from "@msa/tui/index.types";
import { Effect } from "effect";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import KeybindingsManager from "../src/core/keybindings-manager.ts";
import codingAgent from "../src/index.ts";
import ansi from "../src/utils/ansi.ts";
import harnessModule from "./suite/harness.ts";
import type harnessTypes from "./suite/harness.types.ts";

const { ModelSelectorComponent } = codingAgent;
const { initTheme } = codingAgent;

const { stripAnsi } = ansi;
const { setKeybindings } = tui;

const { createHarness } = harnessModule;

const { awaited, runTest } = testing;

function createFakeTui(): tuiTypes.TUI {
  return { requestRender: () => {} } as unknown as tuiTypes.TUI;
}

let harness: harnessTypes.Harness | undefined;

const keepsTheCurrentModelMarkedWhileBrowsing = () =>
  runTest(
    Effect.gen(function* () {
      harness = yield* awaited(
        createHarness({
          models: [
            { id: "current-model", name: "Current Model", reasoning: true },
            { id: "browsed-model", name: "Browsed Model", reasoning: true },
          ],
        }),
      );
      const currentModel = harness.getModel("current-model")!;
      const selector = new ModelSelectorComponent(
        createFakeTui(),
        currentModel,
        harness.session.models.selection.modelRuntime,
        [],
        () => {},
        () => {},
      );

      const getModelRow = (id: string): string | undefined =>
        stripAnsi(selector.render(120).join("\n"))
          .split("\n")
          .find((line) => line.includes(`${id} [`))
          ?.trimEnd();

      expect(getModelRow("current-model")).toBe(`→ ✓ current-model [${currentModel.provider}]`);
      selector.handleInput("\x1b[B");
      expect(getModelRow("current-model")).toBe(`  ✓ current-model [${currentModel.provider}]`);
      expect(getModelRow("browsed-model")).toBe(`→   browsed-model [${currentModel.provider}]`);
      selector.dispose();
    }),
  );

const usesTheConfiguredSaveBinding = () =>
  runTest(
    Effect.gen(function* () {
      setKeybindings(new KeybindingsManager({ "app.models.save": "ctrl+r" }));
      harness = yield* awaited(createHarness());
      const currentModel = harness.getModel()!;
      const saveDefault = vi.fn();
      const selector = new ModelSelectorComponent(
        createFakeTui(),
        currentModel,
        harness.session.models.selection.modelRuntime,
        [],
        () => {},
        () => {},
        undefined,
        saveDefault,
      );

      expect(stripAnsi(selector.render(120).join("\n"))).toContain("Ctrl+R to set as default");
      selector.handleInput("\x13");
      expect(saveDefault).not.toHaveBeenCalled();
      selector.handleInput("\x12");
      expect(saveDefault).toHaveBeenCalledWith(currentModel);
    }),
  );

const listsEveryCatalogThatFailedToRefresh = () =>
  runTest(
    Effect.gen(function* () {
      harness = yield* awaited(createHarness());
      vi.spyOn(harness.session.models.selection.modelRuntime, "refresh").mockResolvedValue({
        aborted: false,
        errors: new Map([
          ["openai", new Error("unavailable")],
          ["anthropic-api", new Error("unavailable")],
        ]),
      });

      const selector = new ModelSelectorComponent(
        createFakeTui(),
        harness.getModel(),
        harness.session.models.selection.modelRuntime,
        [],
        () => {},
        () => {},
      );

      yield* awaited(
        vi.waitFor(() => {
          const rendered = stripAnsi(selector.render(120).join("\n"));
          expect(rendered).toContain(
            "Could not refresh 2 model catalogs (openai, anthropic-api); showing cached models.",
          );
        }),
      );
    }),
  );

describe("model selector", () => {
  beforeAll(() => {
    initTheme("dark");
  });

  beforeEach(() => {
    setKeybindings(new KeybindingsManager());
  });

  afterEach(() => {
    const closing = harness?.cleanup();
    harness = undefined;
    return closing;
  });

  it("keeps the current model marked while browsing", keepsTheCurrentModelMarkedWhileBrowsing);

  it("uses the configured save binding", usesTheConfiguredSaveBinding);

  it("lists every catalog that failed to refresh", listsEveryCatalogThatFailedToRefresh);
});
