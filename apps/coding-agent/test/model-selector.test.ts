import { awaited, runTest } from "@msa/testing";
import { setKeybindings, type TUI } from "@msa/tui";
import { Effect } from "effect";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { KeybindingsManager } from "../src/core/keybindings.ts";
import { ModelSelectorComponent } from "../src/modes/interactive/components/model-selector.ts";
import { initTheme } from "../src/modes/interactive/theme/theme.ts";
import { stripAnsi } from "../src/utils/ansi.ts";
import { createHarness, type Harness } from "./suite/harness.ts";

function createFakeTui(): TUI {
  return { requestRender: () => {} } as unknown as TUI;
}

describe("model selector", () => {
  let harness: Harness | undefined;

  beforeAll(() => {
    initTheme("dark");
  });

  beforeEach(() => {
    setKeybindings(new KeybindingsManager());
  });

  afterEach(() => {
    harness?.cleanup();
    harness = undefined;
  });

  it("keeps the current model marked while browsing", () =>
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
          harness.session.modelRuntime,
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
    ));

  it("uses the configured save binding", () =>
    runTest(
      Effect.gen(function* () {
        setKeybindings(new KeybindingsManager({ "app.models.save": "ctrl+r" }));
        harness = yield* awaited(createHarness());
        const currentModel = harness.getModel()!;
        const saveDefault = vi.fn();
        const selector = new ModelSelectorComponent(
          createFakeTui(),
          currentModel,
          harness.session.modelRuntime,
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
    ));

  it("lists every catalog that failed to refresh", () =>
    runTest(
      Effect.gen(function* () {
        harness = yield* awaited(createHarness());
        vi.spyOn(harness.session.modelRuntime, "refresh").mockResolvedValue({
          aborted: false,
          errors: new Map([
            ["openai", new Error("unavailable")],
            ["anthropic", new Error("unavailable")],
          ]),
        });

        const selector = new ModelSelectorComponent(
          createFakeTui(),
          harness.getModel(),
          harness.session.modelRuntime,
          [],
          () => {},
          () => {},
        );

        yield* awaited(
          vi.waitFor(() => {
            const rendered = stripAnsi(selector.render(120).join("\n"));
            expect(rendered).toContain(
              "Could not refresh 2 model catalogs (openai, anthropic); showing cached models.",
            );
          }),
        );
      }),
    ));
});
