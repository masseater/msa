import { Function } from "effect";

import { comparePiVersions, parsePiVersion, requirePiVersion } from "./pi-version.ts";
import type { ParsedPiVersion } from "./pi-version.ts";

export const MODEL_CATALOG_SCHEMA_VERSION = 1;
export const MODEL_CATALOG_PREFIX = `models/v${MODEL_CATALOG_SCHEMA_VERSION}`;
export const MODEL_CATALOG_INDEX_KEY = `${MODEL_CATALOG_PREFIX}/index.json`;
export const MODEL_CATALOG_REVISION_RE = /^sha256-[0-9a-f]{64}$/u;

const PI_USER_AGENT_RE = /^pi\/([^\s()]+)(?: \([^;()]+(?:;\s*[^;()]+(?:;\s*[^()]+)?)?\))?$/iu;
const MODEL_TYPE_RE = /^[A-Za-z0-9][A-Za-z0-9._-]*$/u;

export type ModelCatalogArtifact = "models.json" | "models.all.json" | "providers.json";

export type ModelCatalogRepresentation = "legacy" | "typed";

export type ModelCatalogIndexEntry = {
  minimumPiVersion: string;
  revision: string;
};

export type ModelCatalogIndex = {
  schemaVersion: number;
  defaultRevision: string;
  catalogs: ModelCatalogIndexEntry[];
};

export type ModelCatalogRequest =
  | { kind: "catalog"; piVersion: string | undefined; representation: ModelCatalogRepresentation }
  | { kind: "redirect"; location: string }
  | { kind: "invalid"; error: string };

export const getModelCatalogArtifactKey: {
  (artifact: ModelCatalogArtifact): (revision: string) => string;
  (revision: string, artifact: ModelCatalogArtifact): string;
} = Function.dual(
  2,
  (revision: string, artifact: ModelCatalogArtifact): string =>
    `${MODEL_CATALOG_PREFIX}/revisions/${revision}/${artifact}`,
);

export const getModelCatalogProviderKey: {
  (provider: string, representation: ModelCatalogRepresentation): (revision: string) => string;
  (revision: string, provider: string, representation: ModelCatalogRepresentation): string;
} = Function.dual(
  3,
  (revision: string, provider: string, representation: ModelCatalogRepresentation): string => {
    const suffix = representation === "typed" ? ".all.json" : ".json";
    return `${MODEL_CATALOG_PREFIX}/revisions/${revision}/providers/${provider}${suffix}`;
  },
);

export function isValidModelCatalogPiVersion(version: string): boolean {
  return parsePiVersion(version) !== undefined;
}

export const compareModelCatalogPiVersions: {
  (right: string): (left: string) => number;
  (left: string, right: string): number;
} = Function.dual(2, (left: string, right: string): number =>
  comparePiVersions(requirePiVersion(left), requirePiVersion(right)),
);

function isValidTypeList(types: string): boolean {
  return types !== "" && types.split(",").every((type) => MODEL_TYPE_RE.test(type));
}

export function parseModelCatalogRepresentation(
  types: string | null | undefined,
): ModelCatalogRepresentation | undefined {
  if (types === undefined || types === null) {
    return "legacy";
  }
  return isValidTypeList(types) ? "typed" : undefined;
}

const userAgentVersion = (userAgent: string | null | undefined): string | undefined =>
  PI_USER_AGENT_RE.exec(userAgent ?? "")?.[1];

const validPiVersion = (version: string | undefined): string | undefined =>
  version !== undefined && isValidModelCatalogPiVersion(version) ? version : undefined;

const requestWithoutPiVersion = (options: {
  readonly representation: ModelCatalogRepresentation;
  readonly requestUrl: URL;
  readonly userAgent: string | null | undefined;
}): ModelCatalogRequest => {
  const { representation, requestUrl } = options;
  const version = validPiVersion(userAgentVersion(options.userAgent));
  if (version === undefined) {
    return { kind: "catalog", piVersion: undefined, representation };
  }
  requestUrl.searchParams.set("pi-version", version);
  return { kind: "redirect", location: requestUrl.toString() };
};

const requestWithPiVersion = (
  piVersion: string,
  representation: ModelCatalogRepresentation,
): ModelCatalogRequest =>
  isValidModelCatalogPiVersion(piVersion)
    ? { kind: "catalog", piVersion, representation }
    : { kind: "invalid", error: "Invalid Pi version." };

const parseRequest = (
  url: string | URL,
  userAgent: string | null | undefined,
): ModelCatalogRequest => {
  const requestUrl = new URL(url);
  const representation = parseModelCatalogRepresentation(requestUrl.searchParams.get("types"));
  if (representation === undefined) {
    return { kind: "invalid", error: "Invalid model types." };
  }
  const piVersion = requestUrl.searchParams.get("pi-version");
  return piVersion === null
    ? requestWithoutPiVersion({ representation, requestUrl, userAgent })
    : requestWithPiVersion(piVersion, representation);
};

export const parseModelCatalogRequest: {
  (userAgent: string | null | undefined): (url: string | URL) => ModelCatalogRequest;
  (url: string | URL, userAgent: string | null | undefined): ModelCatalogRequest;
} = Function.dual(2, parseRequest);

const selectCatalog = (
  index: ModelCatalogIndex,
  piVersion: string | undefined,
): ModelCatalogIndexEntry | undefined => {
  if (piVersion === undefined) {
    return index.catalogs.find((catalog) => catalog.revision === index.defaultRevision);
  }

  const requestedVersion = parsePiVersion(piVersion);
  return requestedVersion === undefined
    ? undefined
    : newestCompatibleCatalog(index.catalogs, requestedVersion);
};

export const selectModelCatalog: {
  (piVersion: string | undefined): (index: ModelCatalogIndex) => ModelCatalogIndexEntry | undefined;
  (index: ModelCatalogIndex, piVersion: string | undefined): ModelCatalogIndexEntry | undefined;
} = Function.dual(2, selectCatalog);

function isObjectValue(value: unknown): value is object {
  return typeof value === "object" && value !== null;
}

function isPlainObject(value: unknown): value is object {
  return isObjectValue(value) && !Array.isArray(value);
}

function isRevision(value: unknown): value is string {
  return typeof value === "string" && MODEL_CATALOG_REVISION_RE.test(value);
}

function isPiVersion(value: unknown): value is string {
  return typeof value === "string" && parsePiVersion(value) !== undefined;
}

function hasEntryFields(catalog: object): catalog is ModelCatalogIndexEntry {
  return (
    "minimumPiVersion" in catalog &&
    isPiVersion(catalog.minimumPiVersion) &&
    "revision" in catalog &&
    isRevision(catalog.revision)
  );
}

function isIndexEntry(catalog: unknown): catalog is ModelCatalogIndexEntry {
  return isObjectValue(catalog) && hasEntryFields(catalog);
}

function isCatalogList(catalogs: unknown): catalogs is ModelCatalogIndexEntry[] {
  return Array.isArray(catalogs) && catalogs.length > 0 && catalogs.every(isIndexEntry);
}

function hasSchemaVersion(value: object): value is { readonly schemaVersion: number } {
  return "schemaVersion" in value && value.schemaVersion === MODEL_CATALOG_SCHEMA_VERSION;
}

function hasDefaultRevision(value: object): value is { readonly defaultRevision: string } {
  return "defaultRevision" in value && isRevision(value.defaultRevision);
}

function hasCatalogs(value: { readonly defaultRevision: string }): value is {
  readonly catalogs: ModelCatalogIndexEntry[];
  readonly defaultRevision: string;
} {
  return (
    "catalogs" in value &&
    isCatalogList(value.catalogs) &&
    value.catalogs.some((catalog) => catalog.revision === value.defaultRevision)
  );
}

function isModelCatalogIndex(value: unknown): value is ModelCatalogIndex {
  return (
    isPlainObject(value) &&
    hasSchemaVersion(value) &&
    hasDefaultRevision(value) &&
    hasCatalogs(value)
  );
}

export function parseModelCatalogIndex(value: unknown): ModelCatalogIndex {
  if (!isModelCatalogIndex(value)) {
    throw new Error(`Model catalog index is invalid: ${MODEL_CATALOG_INDEX_KEY}`);
  }

  return {
    schemaVersion: value.schemaVersion,
    defaultRevision: value.defaultRevision,
    catalogs: value.catalogs.map(({ minimumPiVersion, revision }) => ({
      minimumPiVersion,
      revision,
    })),
  };
}

function isBetterCandidate(
  minimumVersion: ParsedPiVersion,
  requestedVersion: ParsedPiVersion,
  selectedVersion: ParsedPiVersion | undefined,
): boolean {
  return (
    comparePiVersions(minimumVersion, requestedVersion) <= 0 &&
    (selectedVersion === undefined || comparePiVersions(minimumVersion, selectedVersion) > 0)
  );
}

function newestCompatibleCatalog(
  catalogs: ReadonlyArray<ModelCatalogIndexEntry>,
  requestedVersion: ParsedPiVersion,
): ModelCatalogIndexEntry | undefined {
  let selected: ModelCatalogIndexEntry | undefined;
  let selectedVersion: ParsedPiVersion | undefined;
  for (const catalog of catalogs) {
    const minimumVersion = requirePiVersion(catalog.minimumPiVersion);
    if (isBetterCandidate(minimumVersion, requestedVersion, selectedVersion)) {
      selected = catalog;
      selectedVersion = minimumVersion;
    }
  }
  return selected;
}
