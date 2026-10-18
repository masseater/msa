import * as NodeServices from "@effect/platform-node/NodeServices";
import { setKeybindings, type TUI } from "@msa/tui";
import { Effect, FileSystem, ManagedRuntime } from "effect";
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vite-plus/test";

import { AuthStorage } from "../../../src/core/auth-storage.ts";
import { KeybindingsManager } from "../../../src/core/keybindings.ts";
import { ModelSelectorComponent } from "../../../src/modes/interactive/components/model-selector.ts";
import { initTheme } from "../../../src/modes/interactive/theme/theme.ts";
import { stripAnsi } from "../../../src/utils/ansi.ts";
import { createModelRegistry, getModelRuntime } from "../../model-runtime-test-utils.ts";
import { stringifyJson } from "../../test-json.ts";
import { join } from "../../test-path.ts";

const runtime = ManagedRuntime.make(NodeServices.layer);
const fs = runtime.runSync(FileSystem.FileSystem.useSync((service) => service));

function observeRefreshRender(): { tui: TUI; renderedAfterRefresh: Promise<void> } {
  let renderCount = 0;
  let resolveRefreshRender = () => {};
  const renderedAfterRefresh = new Promise<void>((resolve) => {
    resolveRefreshRender = resolve;
  });
  return {
    tui: {
      requestRender: () => {
        renderCount++;
        if (renderCount === 2) resolveRefreshRender();
      },
    } as unknown as TUI,
    renderedAfterRefresh,
  };
}

function modelsJson(provider: string, model: string): Record<string, unknown> {
  return {
    providers: {
      [provider]: {
        baseUrl: "https://example.test/v1",
        api: "openai-completions",
        apiKey: "test-key",
        models: [{ id: model }],
      },
    },
  };
}

let tempDir: string | undefined;

const reloadsModelsJsonWhenOpeningModel = Effect.gen(function* () {
  tempDir = yield* fs.makeTempDirectory({ prefix: "msa-models-json-hot-reload-" });
  const modelsPath = join(tempDir, "models.json");
  yield* fs.writeFileString(modelsPath, stringifyJson(modelsJson("old-provider", "old-model")));
  const modelRuntime = getModelRuntime(
    yield* Effect.promise(() => createModelRegistry(AuthStorage.inMemory(), modelsPath)),
  );
  expect(modelRuntime.getModel("old-provider", "old-model")).toBeDefined();

  yield* fs.writeFileString(modelsPath, stringifyJson(modelsJson("new-provider", "new-model")));
  const { tui, renderedAfterRefresh } = observeRefreshRender();
  const selector = new ModelSelectorComponent(
    tui,
    undefined,
    modelRuntime,
    [],
    () => {},
    () => {},
  );

  yield* Effect.promise(() => renderedAfterRefresh);
  const rendered = stripAnsi(selector.render(120).join("\n"));
  expect(rendered).toContain("new-model [new-provider]");
  expect(rendered).not.toContain("old-model [old-provider]");
});

describe("issue #6999 models.json hot reload", () => {
  beforeAll(() => {
    initTheme("dark");
  });
  beforeEach(() => {
    setKeybindings(new KeybindingsManager());
  });
  afterEach(() =>
    runtime.runPromise(
      Effect.gen(function* () {
        if (tempDir !== undefined && tempDir !== "")
          yield* fs.remove(tempDir, { recursive: true, force: true });
        tempDir = undefined;
      }),
    ),
  );
  it("reloads models.json when opening /model", () =>
    Effect.runPromise(reloadsModelsJsonWhenOpeningModel));
});
