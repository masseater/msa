import testing from "@msa/testing";
import { Effect } from "effect";
import { Compile } from "typebox/compile";
import { afterEach, beforeAll, describe, expect, it } from "vite-plus/test";

import configSchemasSupport from "./config-schemas-support.ts";

const { loadSchemas, renderedSchemas } = configSchemasSupport;

beforeAll(loadSchemas);

const { readTextFile, removePath, resolvePath, runTest } = testing;

const temporaryDirectories: string[] = [];

afterEach(() =>
  runTest(
    Effect.gen(function* () {
      for (const directory of temporaryDirectories.splice(0)) {
        yield* removePath(directory);
      }
    }),
  ),
);

const matchesTheFourCommittedArtifacts = Effect.gen(function* () {
  expect([...renderedSchemas.keys()]).toEqual([
    "schemas/models.schema.json",
    "schemas/settings.schema.json",
    "schemas/keybindings.schema.json",
    "schemas/theme.schema.json",
  ]);
  for (const [relativePath, expected] of renderedSchemas) {
    expect(
      yield* readTextFile(resolvePath(import.meta.dirname, "..", relativePath)),
      `${relativePath} is stale; run npm run generate:schemas`,
    ).toBe(expected);
  }
});

const preservesEditorGuidanceInTheGeneratedTheme = () => {
  const schema = JSON.parse(renderedSchemas.get("schemas/theme.schema.json") ?? "");
  const accent = schema.properties.colors.properties.accent;
  const colorValue =
    accent.$ref === null || accent.$ref === undefined ? accent : schema.$defs.ColorValue;
  expect(schema).toMatchObject({
    description: "Theme schema for msa coding agent",
    properties: {
      colors: {
        description: expect.stringContaining("use compatible fallbacks"),
        properties: {
          accent: { description: "Primary accent color (logo, selected items, cursor)" },
          scrollbarTrack: { description: expect.stringContaining("falls back to muted") },
        },
      },
      export: { description: expect.stringContaining("defaults derived from userMessageBg") },
    },
    title: "msa Coding Agent Theme",
  });
  expect(colorValue).toMatchObject({
    anyOf: [{ description: expect.stringContaining("Hex color") }, expect.any(Object)],
  });
};

const preservesMovedModelAndSettingsGuidance = () => {
  const models = JSON.parse(renderedSchemas.get("schemas/models.schema.json") ?? "");
  expect(models.$defs.ModelCost.properties).toMatchObject({
    input: { description: expect.stringContaining("USD per million tokens") },
    tiers: { description: expect.stringContaining("highest matching input threshold") },
  });
  expect(models.$defs.ModelInputLimits.properties).toMatchObject({
    maxRequestBytes: { description: expect.stringContaining("serialized provider request size") },
  });

  const settings = JSON.parse(renderedSchemas.get("schemas/settings.schema.json") ?? "");
  expect(settings.properties).toMatchObject({
    defaultTools: { description: expect.stringContaining("+name and -name") },
    fullscreenWheelScrollLines: { description: expect.stringContaining("1 to 100") },
    quietStartup: { description: expect.stringContaining("hide all startup output") },
  });
};

describe("generated configuration schemas", () => {
  it("matches the four committed artifacts", () => runTest(matchesTheFourCommittedArtifacts));

  it(
    "preserves editor guidance in the generated theme schema",
    preservesEditorGuidanceInTheGeneratedTheme,
  );

  it("preserves moved model and settings guidance", preservesMovedModelAndSettingsGuidance);
});

const SCHEMA_CASES = [
  {
    artifact: "schemas/models.schema.json",
    invalid: { providers: { local: { models: [{ id: "" }] } } },
    name: "models.json",
    valid: {
      providers: {
        local: {
          compat: {
            chatTemplateKwargs: { budget: { $var: "thinking.budget" } },
            sendSessionAffinityHeaders: true,
            supportsMidConvoSystemMessages: true,
            thinkingTokenBudgetField: "thinking_budget",
          },
          models: [
            {
              id: "model",
              inputLimits: { images: { maxPerRequest: 2 }, maxRequestBytes: 1024 },
              promptCache: { short: 300 },
            },
          ],
        },
      },
    },
  },
  {
    artifact: "schemas/settings.schema.json",
    invalid: { cacheWarming: "always" },
    name: "settings.json",
    valid: {
      cacheWarming: "idle",
      extensionSetting: { enabled: true },
      queueMode: "all",
      retry: { maxDelayMs: 1000 },
      skills: { customDirectories: ["./skills"], enableSkillCommands: true },
      theme: "dark",
      websockets: true,
    },
  },
  {
    artifact: "schemas/keybindings.schema.json",
    invalid: { "app.session.new": 42 },
    name: "keybindings.json",
    valid: { "app.session.new": "ctrl+n", "extension.action": ["alt+x"] },
  },
];

describe("generated configuration schemas", () => {
  it.each(SCHEMA_CASES)(
    "validates representative $name documents",
    ({ artifact, valid, invalid }) => {
      const schema = JSON.parse(renderedSchemas.get(artifact) ?? "");
      const validator = Compile(schema);
      expect(validator.Check(valid)).toBe(true);
      expect(validator.Check(invalid)).toBe(false);
    },
  );
});
