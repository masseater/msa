import testing from "@msa/testing";
import { Effect } from "effect";
import { afterEach, describe, expect, it } from "vite-plus/test";

import { KeybindingsManager } from "../src/core/keybindings.ts";
import { ModelConfig } from "../src/core/model-config.ts";
import { SettingsManager } from "../src/core/settings-manager.ts";
import { validateThemeJson } from "../src/modes/interactive/theme/theme-schema.ts";

const {
  awaited,
  fromJsonText,
  joinPath,
  makeTempDir,
  readTextFile,
  removeDirs,
  resolvePath,
  runTest,
  toJsonText,
  writeTextFile,
} = testing;

const schemaBaseUrl =
  "https://raw.githubusercontent.com/masseater/msa/main/apps/coding-agent/schemas";

const temporaryDirectories: string[] = [];

afterEach(() => runTest(removeDirs(temporaryDirectories.splice(0))));

const createTemporaryDirectory = Effect.fn("createTemporaryDirectory")(function* () {
  const directory = yield* makeTempDir("msa-config-schema-test-");
  temporaryDirectories.push(directory);
  return directory;
});

function schemaUrl(name: "models" | "settings" | "keybindings" | "theme"): string {
  return `${schemaBaseUrl}/${name}.schema.json`;
}

const acceptsCustomCompatibilitySettingsAndRejectsMalformed = () =>
  runTest(
    Effect.gen(function* () {
      const directory = yield* createTemporaryDirectory();
      const path = joinPath(directory, "models.json");
      const compat = {
        customOption: "value",
        supportsAdditionalTools: true,
        supportsStore: true,
      };
      yield* writeTextFile(
        path,
        yield* toJsonText({ providers: { demo: { api: "custom-api" as const, compat } } }),
      );

      const config = yield* awaited(ModelConfig.load(path));
      expect(config.getError()).toBeUndefined();
      expect(config.getProvider("demo")?.compat).toEqual(compat);

      yield* writeTextFile(
        path,
        yield* toJsonText({
          providers: { demo: { compat: { supportsLongCacheRetention: "yes" } } },
        }),
      );
      expect((yield* awaited(ModelConfig.load(path))).getError()).toContain(
        "Invalid models.json schema",
      );
    }),
  );

const validatesSchemaInModelsJsonAtRuntime = () =>
  runTest(
    Effect.gen(function* () {
      const directory = yield* createTemporaryDirectory();
      const path = joinPath(directory, "models.json");
      yield* writeTextFile(
        path,
        yield* toJsonText({
          $schema: schemaUrl("models"),
          providers: { demo: { baseUrl: "http://localhost:8080/v1", models: [{ id: "demo" }] } },
        }),
      );

      const config = yield* awaited(ModelConfig.load(path));
      expect(config.getError()).toBeUndefined();
      expect(config.getProvider("demo")?.models?.[0]?.id).toBe("demo");

      yield* writeTextFile(
        path,
        yield* toJsonText({
          $schema: schemaUrl("models"),
          providers: { demo: { models: [{ id: "" }] } },
        }),
      );
      expect((yield* awaited(ModelConfig.load(path))).getError()).toContain(
        "Invalid models.json schema",
      );

      yield* writeTextFile(path, yield* toJsonText({ $schema: 42, providers: {} }));
      expect((yield* awaited(ModelConfig.load(path))).getError()).toContain("$schema");
    }),
  );

const acceptsSchemaInSettingsJsonAndPreserves = Effect.gen(function* () {
  const directory = yield* createTemporaryDirectory();
  yield* writeTextFile(
    joinPath(directory, "settings.json"),
    yield* toJsonText({
      $schema: schemaUrl("settings"),
      extensionSetting: { enabled: true },
      theme: "light",
    }),
  );

  const manager = SettingsManager.create(directory, directory);
  expect(manager.getTheme()).toBe("light");
  expect(manager.getGlobalSettings()).toMatchObject({
    $schema: schemaUrl("settings"),
    extensionSetting: { enabled: true },
  });
});

const acceptsSchemaInKeybindingsJsonWithoutTreating = Effect.gen(function* () {
  const directory = yield* createTemporaryDirectory();
  yield* writeTextFile(
    joinPath(directory, "keybindings.json"),
    yield* toJsonText({
      $schema: schemaUrl("keybindings"),
      "app.session.new": "ctrl+n",
      "extension.invalid": "ctrl+not-a-key",
    }),
  );

  const manager = KeybindingsManager.create(directory);
  expect(manager.getUserBindings()).toEqual({ "app.session.new": "ctrl+n" });
  expect(manager.getEffectiveConfig()["app.session.new"]).toBe("ctrl+n");
});

const acceptsSchemaInThemesAndRejectsMalformed = Effect.gen(function* () {
  const builtIn = (yield* fromJsonText(
    yield* readTextFile(
      resolvePath(import.meta.dirname, "../src/modes/interactive/theme/dark.json"),
    ),
  )) as Record<string, unknown>;
  expect(
    validateThemeJson("custom", { ...builtIn, $schema: schemaUrl("theme"), name: "custom" }).name,
  ).toBe("custom");
  expect(() => validateThemeJson("invalid", { ...builtIn, name: "invalid/name" })).toThrow(
    "theme names cannot contain",
  );
  expect(() => validateThemeJson("invalid", { ...builtIn, colors: {} })).toThrow(
    "Missing required color tokens",
  );
  for (const invalid of [
    { ...builtIn, unexpected: true },
    {
      ...builtIn,
      colors: { ...(builtIn["colors"] as Record<string, unknown>), scrollbarThmb: "" },
    },
    { ...builtIn, export: { unexpected: "" } },
  ]) {
    expect(() => validateThemeJson("invalid", invalid)).toThrow(/additional properties/iu);
  }
});

describe("generated configuration schemas", () => {
  it(
    "accepts custom compatibility settings and rejects malformed known fields",
    acceptsCustomCompatibilitySettingsAndRejectsMalformed,
  );

  it("validates $schema in models.json at runtime", validatesSchemaInModelsJsonAtRuntime);

  it("accepts $schema in settings.json and preserves unknown settings", () =>
    runTest(acceptsSchemaInSettingsJsonAndPreserves));

  it("accepts $schema in keybindings.json without treating it as an action", () =>
    runTest(acceptsSchemaInKeybindingsJsonWithoutTreating));
});

describe("generated configuration schemas", () => {
  it("accepts $schema in themes and rejects malformed themes", () =>
    runTest(acceptsSchemaInThemesAndRejectsMalformed));
});
