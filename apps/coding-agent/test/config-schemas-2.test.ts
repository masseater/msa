import testing from "@msa/testing";
import { Effect } from "effect";
import { Compile } from "typebox/compile";
import { afterEach, beforeAll, describe, expect, it } from "vite-plus/test";

import { SettingsSchema } from "../src/core/settings-schema.ts";
import configSchemasSupport from "./config-schemas-support.ts";

const { loadSchemas, renderedSchemas } = configSchemasSupport;

beforeAll(loadSchemas);

const { removePath, runTest } = testing;

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

const rejectsNonPositiveModelTokenLimits = () => {
  const schema = JSON.parse(renderedSchemas.get("schemas/models.schema.json") ?? "");
  const validator = Compile(schema);
  for (const field of ["contextWindow", "maxTokens"] as const) {
    for (const value of [0, -1]) {
      expect(
        validator.Check({ providers: { local: { models: [{ id: "model", [field]: value }] } } }),
        `models[].${field}=${value}`,
      ).toBe(false);
      expect(
        validator.Check({
          providers: { local: { modelOverrides: { model: { [field]: value } } } },
        }),
        `modelOverrides.${field}=${value}`,
      ).toBe(false);
    }
  }
  expect(
    validator.Check({
      providers: {
        local: {
          modelOverrides: { model: { contextWindow: 1, maxTokens: 1 } },
          models: [{ contextWindow: 1, id: "model", maxTokens: 1 }],
        },
      },
    }),
  ).toBe(true);
};

const validatesKeybindingSyntax = () => {
  const schema = JSON.parse(renderedSchemas.get("schemas/keybindings.schema.json") ?? "");
  const validator = Compile(schema);
  for (const binding of [
    "a",
    "9",
    "pageUp",
    "+",
    "ctrl+shift+x",
    "alt+ctrl+?",
    "ctrl+shift+alt+super+f12",
  ]) {
    expect(validator.Check({ "extension.action": binding }), binding).toBe(true);
  }
  for (const binding of [
    "",
    "Ctrl+x",
    "control+x",
    "ctrl+not-a-key",
    "ctrl+ctrl+x",
    "ctrl+shift+alt+super+ctrl+x",
  ]) {
    expect(validator.Check({ "extension.action": binding }), binding).toBe(false);
  }
};

const rejectsSettingsValuesThatRuntimeAccessorsReject = () => {
  const validator = Compile(SettingsSchema);
  for (const invalid of [
    { compaction: { reserveTokens: -1 } },
    { compaction: { keepRecentTokens: 1.5 } },
    {
      compaction: {
        modelOverrides: { "provider/model": { reserveTokens: Number.MAX_SAFE_INTEGER + 1 } },
      },
    },
    { httpIdleTimeoutMs: -1 },
    { websocketConnectTimeoutMs: -1 },
    { httpIdleTimeoutMs: "bogus" },
    { websocketConnectTimeoutMs: "30000" },
    { codemode: { inlineBudget: -1 } },
  ]) {
    expect(validator.Check(invalid)).toBe(false);
  }
  expect(
    validator.Check({
      codemode: { inlineBudget: 0 },
      compaction: {
        keepRecentTokens: Number.MAX_SAFE_INTEGER,
        modelOverrides: { "provider/model": { reserveTokens: 0 } },
        reserveTokens: 0,
      },
      httpIdleTimeoutMs: 0,
      websocketConnectTimeoutMs: "disabled",
    }),
  ).toBe(true);
};

const describesLegacySettingsMigrationsAccurately = () => {
  const schema = JSON.parse(renderedSchemas.get("schemas/settings.schema.json") ?? "") as {
    properties: {
      queueMode: { description: string };
      retry: { properties: { maxDelayMs: { description: string } } };
    };
  };
  expect(schema.properties.retry.properties.maxDelayMs.description).toContain(
    "provider.maxRetryDelayMs",
  );
  expect(schema.properties.queueMode.description).toBe("Legacy setting migrated to steeringMode.");
};

describe("generated configuration schemas", () => {
  it("rejects non-positive model token limits", rejectsNonPositiveModelTokenLimits);

  it("validates keybinding syntax", validatesKeybindingSyntax);

  it(
    "rejects settings values that runtime accessors reject",
    rejectsSettingsValuesThatRuntimeAccessorsReject,
  );

  it(
    "describes legacy settings migrations accurately",
    describesLegacySettingsMigrationsAccurately,
  );
});
