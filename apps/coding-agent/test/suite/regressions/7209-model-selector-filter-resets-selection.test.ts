import tui from "@msa/tui";
import type tuiTypes from "@msa/tui/index.types";
import { Effect } from "effect";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import KeybindingsManager from "../../../src/core/keybindings-manager.ts";
import codingAgent from "../../../src/index.ts";
import type modelSelectorTypes from "../../../src/modes/interactive/components/model-selector.types.ts";
import ansi from "../../../src/utils/ansi.ts";
import harnessModule from "../harness.ts";
import type harnessTypes from "../harness.types.ts";

const { cleanupAll } = harnessModule;

const { ModelSelectorComponent } = codingAgent;
const { initTheme } = codingAgent;

const { stripAnsi } = ansi;
const { setKeybindings } = tui;

const { createHarness } = harnessModule;

function createFakeTui(): tuiTypes.TUI {
  return { requestRender: () => {} } as unknown as tuiTypes.TUI;
}

function selectedModelId(rendered: string): string | undefined {
  const line = rendered.split("\n").find((l) => l.startsWith("→ "));
  if (line === undefined || line === "") return undefined;
  const rest = line.replace(/^→\s*/u, "");
  const id = rest.split(" [")[0]?.replace(/^✓\s*/u, "");
  return id?.trim() || undefined;
}

const harnesses: harnessTypes.Harness[] = [];

const movesSelectionToTheFirstRow = Effect.gen(function* () {
  const harness = yield* Effect.promise(() =>
    createHarness({
      models: [
        { id: "alpha-1", name: "Alpha One", reasoning: true },
        { id: "alpha-2", name: "Alpha Two", reasoning: true },
        { id: "alpha-3", name: "Alpha Three", reasoning: true },
        { id: "beta-1", name: "Beta One", reasoning: true },
      ],
    }),
  );
  harnesses.push(harness);
  const current = harness.getModel("alpha-1")!;
  const selector = new ModelSelectorComponent(
    createFakeTui(),
    current,
    harness.session.models.selection.modelRuntime,
    [],
    () => {},
    () => {},
  );
  yield* Effect.promise(() =>
    vi.waitFor(() => {
      const rendered = stripAnsi(selector.render(120).join("\n"));
      expect(rendered).toContain("Model catalogs refreshed.");
    }),
  );
  expect(selectedModelId(stripAnsi(selector.render(120).join("\n")))).toBe("alpha-1");
  selector.handleInput("\x1b[B");
  return yield* movesSelectionToTheFirstRowStep1(selector);
});

const movesSelectionToTheFirstRowStep1 = (selector: modelSelectorTypes.ModelSelectorComponent) =>
  Effect.sync(() => {
    selector.handleInput("\x1b[B");
    expect(selectedModelId(stripAnsi(selector.render(120).join("\n")))).toBe("alpha-3");
    for (const char of "alpha") {
      selector.handleInput(char);
    }
    const rendered = stripAnsi(selector.render(120).join("\n"));
    expect(selectedModelId(rendered)).toBe("alpha-1");
    expect(rendered).not.toContain("beta-1");
  });

const movesSelectionToTheFirstRow2 = Effect.gen(function* () {
  const harness = yield* Effect.promise(() =>
    createHarness({
      models: [
        { id: "alpha-1", name: "Alpha One", reasoning: true },
        { id: "alpha-2", name: "Alpha Two", reasoning: true },
        { id: "alpha-3", name: "Alpha Three", reasoning: true },
      ],
    }),
  );
  harnesses.push(harness);

  const alpha1 = harness.getModel("alpha-1")!;
  const alpha2 = harness.getModel("alpha-2")!;
  const alpha3 = harness.getModel("alpha-3")!;

  const selector = new ModelSelectorComponent(
    createFakeTui(),
    alpha1,
    harness.session.models.selection.modelRuntime,
    [{ model: alpha2 }, { model: alpha3 }, { model: alpha1 }],
    () => {},
    () => {},
  );

  yield* Effect.promise(() =>
    vi.waitFor(() => {
      const rendered = stripAnsi(selector.render(120).join("\n"));
      expect(rendered).toContain("Model catalogs refreshed.");
    }),
  );

  expect(selectedModelId(stripAnsi(selector.render(120).join("\n")))).toBe("alpha-1");

  for (const char of "alpha") {
    selector.handleInput(char);
  }

  expect(selectedModelId(stripAnsi(selector.render(120).join("\n")))).toBe("alpha-2");
});

const movesSelectionToTheFirstRowIn = () => Effect.runPromise(movesSelectionToTheFirstRow);

const movesSelectionToTheFirstRowIn2 = () => Effect.runPromise(movesSelectionToTheFirstRow2);

const afterAllHook = () => cleanupAll(harnesses);

describe("model selector filter resets selection to top", () => {
  beforeAll(() => {
    initTheme("dark");
  });
  beforeEach(() => {
    setKeybindings(new KeybindingsManager());
  });
  afterAll(afterAllHook);
  it(
    "moves selection to the first row in the All tab when typing a query",
    movesSelectionToTheFirstRowIn,
  );
  it(
    "moves selection to the first row in the Scoped tab when typing a query",
    movesSelectionToTheFirstRowIn2,
  );
});
