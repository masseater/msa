import { expect, it } from "vite-plus/test";

import {
  compareModelCatalogPiVersions,
  getModelCatalogArtifactKey,
  getModelCatalogProviderKey,
  type ModelCatalogIndex,
  parseModelCatalogIndex,
  parseModelCatalogRepresentation,
  parseModelCatalogRequest,
  selectModelCatalog,
} from "./model-catalog-protocol.ts";

const legacyRevision = `sha256-${"a".repeat(64)}`;
const mixedApiRevision = `sha256-${"b".repeat(64)}`;
const index: ModelCatalogIndex = {
  schemaVersion: 1,
  defaultRevision: mixedApiRevision,
  catalogs: [
    { minimumPiVersion: "0.80.7", revision: legacyRevision },
    { minimumPiVersion: "0.85.0", revision: mixedApiRevision },
  ],
};

it("builds revision scoped storage keys", () => {
  expect(getModelCatalogArtifactKey(legacyRevision, "models.json")).toBe(
    `models/v1/revisions/${legacyRevision}/models.json`,
  );
  expect(getModelCatalogProviderKey(legacyRevision, "openrouter", "legacy")).toBe(
    `models/v1/revisions/${legacyRevision}/providers/openrouter.json`,
  );
  expect(getModelCatalogProviderKey(legacyRevision, "openrouter", "typed")).toBe(
    `models/v1/revisions/${legacyRevision}/providers/openrouter.all.json`,
  );
});

it("orders Pi versions with semver precedence", () => {
  expect(compareModelCatalogPiVersions("0.85.0", "0.84.4")).toBeGreaterThan(0);
  expect(compareModelCatalogPiVersions("0.85.0-rc.1", "0.85.0")).toBeLessThan(0);
  expect(compareModelCatalogPiVersions("0.85.0-rc.2", "0.85.0-rc.10")).toBeLessThan(0);
  expect(compareModelCatalogPiVersions("v1.0.0", "1.0.0+build")).toBe(0);
  expect(() => compareModelCatalogPiVersions("0.85", "0.85.0")).toThrow(/Invalid Pi version/u);
});

it("selects the newest catalog a Pi version supports", () => {
  expect(selectModelCatalog(index, "0.84.4")?.revision).toBe(legacyRevision);
  expect(selectModelCatalog(index, "0.85.0-rc.1")?.revision).toBe(legacyRevision);
  expect(selectModelCatalog(index, "0.85.0")?.revision).toBe(mixedApiRevision);
  expect(selectModelCatalog(index, "1.0.0")?.revision).toBe(mixedApiRevision);
  expect(selectModelCatalog(index, "0.80.6")).toBeUndefined();
  expect(selectModelCatalog(index, undefined)?.revision).toBe(mixedApiRevision);
});

it("redirects Pi user agents to an explicit catalog version", () => {
  expect(
    parseModelCatalogRequest(
      "https://pi.dev/api/models/providers/openrouter?types=chat%2Cimage",
      "pi/0.84.4 (linux; node/v22.0.0; x64)",
    ),
  ).toEqual({
    kind: "redirect",
    location: "https://pi.dev/api/models/providers/openrouter?types=chat%2Cimage&pi-version=0.84.4",
  });
  expect(parseModelCatalogRequest("https://pi.dev/api/models", "pi/0.84.4")).toEqual({
    kind: "redirect",
    location: "https://pi.dev/api/models?pi-version=0.84.4",
  });
});

it("serves explicit and unversioned catalog requests without redirecting", () => {
  expect(
    parseModelCatalogRequest(
      "https://pi.dev/api/models?pi-version=0.83.0",
      "pi/0.85.1 (linux; node/v22.0.0; x64)",
    ),
  ).toEqual({ kind: "catalog", piVersion: "0.83.0", representation: "legacy" });
  expect(parseModelCatalogRequest("https://pi.dev/api/models?types=chat", "curl/8.0.0")).toEqual({
    kind: "catalog",
    piVersion: undefined,
    representation: "typed",
  });
  expect(parseModelCatalogRequest("https://pi.dev/api/models", "pi/latest")).toEqual({
    kind: "catalog",
    piVersion: undefined,
    representation: "legacy",
  });
});

it("rejects invalid catalog request parameters", () => {
  expect(
    parseModelCatalogRequest("https://pi.dev/api/models?pi-version=latest", undefined),
  ).toEqual({
    kind: "invalid",
    error: "Invalid Pi version.",
  });
  expect(parseModelCatalogRequest("https://pi.dev/api/models?types=", "pi/0.84.4")).toEqual({
    kind: "invalid",
    error: "Invalid model types.",
  });
  expect(parseModelCatalogRepresentation("chat,-image")).toBeUndefined();
  expect(parseModelCatalogRepresentation(null)).toBe("legacy");
});

it("validates stored indexes and drops publication metadata", () => {
  expect(
    parseModelCatalogIndex({
      ...index,
      catalogs: index.catalogs.map((catalog) => ({
        ...catalog,
        sourceCommit: "abc",
        modelCount: 1,
      })),
    }),
  ).toEqual(index);
  expect(() => parseModelCatalogIndex({ ...index, schemaVersion: 2 })).toThrow(/index is invalid/u);
  expect(() =>
    parseModelCatalogIndex({ ...index, defaultRevision: `sha256-${"c".repeat(64)}` }),
  ).toThrow(/invalid/u);
  expect(() =>
    parseModelCatalogIndex({
      ...index,
      catalogs: [{ minimumPiVersion: "latest", revision: legacyRevision }],
    }),
  ).toThrow(/invalid/u);
});
