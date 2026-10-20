import { Function } from "effect";

import type modelCatalogProtocolTypes from "./model-catalog-protocol.types.ts";
import piVersionModule from "./pi-version.ts";
import type piVersionTypes from "./pi-version.types.ts";

const { comparePiVersions, parsePiVersion, requirePiVersion } = piVersionModule;

const MODEL_CATALOG_SCHEMA_VERSION = 1;
const MODEL_CATALOG_PREFIX = `models/v${MODEL_CATALOG_SCHEMA_VERSION}`;
const MODEL_CATALOG_INDEX_KEY = `${MODEL_CATALOG_PREFIX}/index.json`;
const MODEL_CATALOG_REVISION_RE = /^sha256-[0-9a-f]{64}$/u;

const PI_USER_AGENT_RE = /^pi\/([^\s()]+)(?: \([^;()]+(?:;\s*[^;()]+(?:;\s*[^()]+)?)?\))?$/iu;
const MODEL_TYPE_RE = /^[A-Za-z0-9][A-Za-z0-9._-]*$/u;

const getModelCatalogArtifactKey: {
  (artifact: modelCatalogProtocolTypes.ModelCatalogArtifact): (revision: string) => string;
  (revision: string, artifact: modelCatalogProtocolTypes.ModelCatalogArtifact): string;
} = Function.dual(
  2,
  (revision: string, artifact: modelCatalogProtocolTypes.ModelCatalogArtifact): string =>
    `${MODEL_CATALOG_PREFIX}/revisions/${revision}/${artifact}`,
);

const getModelCatalogProviderKey: {
  (
    provider: string,
    representation: modelCatalogProtocolTypes.ModelCatalogRepresentation,
  ): (revision: string) => string;
  (
    revision: string,
    provider: string,
    representation: modelCatalogProtocolTypes.ModelCatalogRepresentation,
  ): string;
} = Function.dual(
  3,
  (
    revision: string,
    provider: string,
    representation: modelCatalogProtocolTypes.ModelCatalogRepresentation,
  ): string => {
    const suffix = representation === "typed" ? ".all.json" : ".json";
    return `${MODEL_CATALOG_PREFIX}/revisions/${revision}/providers/${provider}${suffix}`;
  },
);

function isValidModelCatalogPiVersion(version: string): boolean {
  return parsePiVersion(version) !== undefined;
}

const compareModelCatalogPiVersions: {
  (right: string): (left: string) => number;
  (left: string, right: string): number;
} = Function.dual(2, (left: string, right: string): number =>
  comparePiVersions(requirePiVersion(left), requirePiVersion(right)),
);

function isValidTypeList(types: string): boolean {
  return types !== "" && types.split(",").every((type) => MODEL_TYPE_RE.test(type));
}

function parseModelCatalogRepresentation(
  types: string | null | undefined,
): modelCatalogProtocolTypes.ModelCatalogRepresentation | undefined {
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
  readonly representation: modelCatalogProtocolTypes.ModelCatalogRepresentation;
  readonly requestUrl: URL;
  readonly userAgent: string | null | undefined;
}): modelCatalogProtocolTypes.ModelCatalogRequest => {
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
  representation: modelCatalogProtocolTypes.ModelCatalogRepresentation,
): modelCatalogProtocolTypes.ModelCatalogRequest =>
  isValidModelCatalogPiVersion(piVersion)
    ? { kind: "catalog", piVersion, representation }
    : { error: "Invalid Pi version.", kind: "invalid" };

const parseRequest = (
  url: string | URL,
  userAgent: string | null | undefined,
): modelCatalogProtocolTypes.ModelCatalogRequest => {
  const requestUrl = new URL(url);
  const representation = parseModelCatalogRepresentation(requestUrl.searchParams.get("types"));
  if (representation === undefined) {
    return { error: "Invalid model types.", kind: "invalid" };
  }
  const piVersion = requestUrl.searchParams.get("pi-version");
  return piVersion === null
    ? requestWithoutPiVersion({ representation, requestUrl, userAgent })
    : requestWithPiVersion(piVersion, representation);
};

const parseModelCatalogRequest: {
  (
    userAgent: string | null | undefined,
  ): (url: string | URL) => modelCatalogProtocolTypes.ModelCatalogRequest;
  (
    url: string | URL,
    userAgent: string | null | undefined,
  ): modelCatalogProtocolTypes.ModelCatalogRequest;
} = Function.dual(2, parseRequest);

const selectCatalog = (
  index: modelCatalogProtocolTypes.ModelCatalogIndex,
  piVersion: string | undefined,
): modelCatalogProtocolTypes.ModelCatalogIndexEntry | undefined => {
  if (piVersion === undefined) {
    return index.catalogs.find((catalog) => catalog.revision === index.defaultRevision);
  }

  const requestedVersion = parsePiVersion(piVersion);
  return requestedVersion === undefined
    ? undefined
    : newestCompatibleCatalog(index.catalogs, requestedVersion);
};

const selectModelCatalog: {
  (
    piVersion: string | undefined,
  ): (
    index: modelCatalogProtocolTypes.ModelCatalogIndex,
  ) => modelCatalogProtocolTypes.ModelCatalogIndexEntry | undefined;
  (
    index: modelCatalogProtocolTypes.ModelCatalogIndex,
    piVersion: string | undefined,
  ): modelCatalogProtocolTypes.ModelCatalogIndexEntry | undefined;
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

function hasEntryFields(
  catalog: object,
): catalog is modelCatalogProtocolTypes.ModelCatalogIndexEntry {
  return (
    "minimumPiVersion" in catalog &&
    isPiVersion(catalog.minimumPiVersion) &&
    "revision" in catalog &&
    isRevision(catalog.revision)
  );
}

function isIndexEntry(
  catalog: unknown,
): catalog is modelCatalogProtocolTypes.ModelCatalogIndexEntry {
  return isObjectValue(catalog) && hasEntryFields(catalog);
}

function isCatalogList(
  catalogs: unknown,
): catalogs is modelCatalogProtocolTypes.ModelCatalogIndexEntry[] {
  return Array.isArray(catalogs) && catalogs.length > 0 && catalogs.every(isIndexEntry);
}

function hasSchemaVersion(value: object): value is { readonly schemaVersion: number } {
  return "schemaVersion" in value && value.schemaVersion === MODEL_CATALOG_SCHEMA_VERSION;
}

function hasDefaultRevision(value: object): value is { readonly defaultRevision: string } {
  return "defaultRevision" in value && isRevision(value.defaultRevision);
}

function hasCatalogs(value: { readonly defaultRevision: string }): value is {
  readonly catalogs: modelCatalogProtocolTypes.ModelCatalogIndexEntry[];
  readonly defaultRevision: string;
} {
  return (
    "catalogs" in value &&
    isCatalogList(value.catalogs) &&
    value.catalogs.some((catalog) => catalog.revision === value.defaultRevision)
  );
}

function isModelCatalogIndex(value: unknown): value is modelCatalogProtocolTypes.ModelCatalogIndex {
  return (
    isPlainObject(value) &&
    hasSchemaVersion(value) &&
    hasDefaultRevision(value) &&
    hasCatalogs(value)
  );
}

function parseModelCatalogIndex(value: unknown): modelCatalogProtocolTypes.ModelCatalogIndex {
  if (!isModelCatalogIndex(value)) {
    throw new Error(`Model catalog index is invalid: ${MODEL_CATALOG_INDEX_KEY}`);
  }

  return {
    catalogs: value.catalogs.map(({ minimumPiVersion, revision }) => ({
      minimumPiVersion,
      revision,
    })),
    defaultRevision: value.defaultRevision,
    schemaVersion: value.schemaVersion,
  };
}

function isBetterCandidate(
  minimumVersion: piVersionTypes.ParsedPiVersion,
  requestedVersion: piVersionTypes.ParsedPiVersion,
  selectedVersion: piVersionTypes.ParsedPiVersion | undefined,
): boolean {
  return (
    comparePiVersions(minimumVersion, requestedVersion) <= 0 &&
    (selectedVersion === undefined || comparePiVersions(minimumVersion, selectedVersion) > 0)
  );
}

function newestCompatibleCatalog(
  catalogs: ReadonlyArray<modelCatalogProtocolTypes.ModelCatalogIndexEntry>,
  requestedVersion: piVersionTypes.ParsedPiVersion,
): modelCatalogProtocolTypes.ModelCatalogIndexEntry | undefined {
  let selected: modelCatalogProtocolTypes.ModelCatalogIndexEntry | undefined;
  let selectedVersion: piVersionTypes.ParsedPiVersion | undefined;
  for (const catalog of catalogs) {
    const minimumVersion = requirePiVersion(catalog.minimumPiVersion);
    if (isBetterCandidate(minimumVersion, requestedVersion, selectedVersion)) {
      selected = catalog;
      selectedVersion = minimumVersion;
    }
  }
  return selected;
}

const modelCatalogProtocol = {
  MODEL_CATALOG_INDEX_KEY,
  MODEL_CATALOG_PREFIX,
  MODEL_CATALOG_REVISION_RE,
  MODEL_CATALOG_SCHEMA_VERSION,
  compareModelCatalogPiVersions,
  getModelCatalogArtifactKey,
  getModelCatalogProviderKey,
  isValidModelCatalogPiVersion,
  parseModelCatalogIndex,
  parseModelCatalogRepresentation,
  parseModelCatalogRequest,
  selectModelCatalog,
};

export default modelCatalogProtocol;
