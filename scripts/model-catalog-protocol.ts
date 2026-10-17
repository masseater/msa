import { Function } from "effect";

export const MODEL_CATALOG_SCHEMA_VERSION = 1;
export const MODEL_CATALOG_PREFIX = `models/v${MODEL_CATALOG_SCHEMA_VERSION}`;
export const MODEL_CATALOG_INDEX_KEY = `${MODEL_CATALOG_PREFIX}/index.json`;
export const MODEL_CATALOG_REVISION_RE = /^sha256-[0-9a-f]{64}$/u;

const PI_VERSION_RE = /^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/u;
const PI_USER_AGENT_RE = /^pi\/([^\s()]+)(?: \([^;()]+(?:;\s*[^;()]+(?:;\s*[^()]+)?)?\))?$/iu;
const MODEL_TYPE_RE = /^[A-Za-z0-9][A-Za-z0-9._-]*$/u;

type ParsedPiVersion = readonly [major: number, minor: number, patch: number, prerelease: string];

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

export function parseModelCatalogRepresentation(
  types: string | null | undefined,
): ModelCatalogRepresentation | undefined {
  if (types === undefined || types === null) {
    return "legacy";
  }
  if (types === "" || types.split(",").some((type) => !MODEL_TYPE_RE.test(type))) {
    return undefined;
  }
  return "typed";
}

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
  if (piVersion === null) {
    const userAgentVersion = PI_USER_AGENT_RE.exec(userAgent ?? "")?.[1];
    if (userAgentVersion !== undefined && isValidModelCatalogPiVersion(userAgentVersion)) {
      requestUrl.searchParams.set("pi-version", userAgentVersion);
      return { kind: "redirect", location: requestUrl.toString() };
    }
    return { kind: "catalog", piVersion: undefined, representation };
  }
  if (!isValidModelCatalogPiVersion(piVersion)) {
    return { kind: "invalid", error: "Invalid Pi version." };
  }
  return { kind: "catalog", piVersion, representation };
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
  if (requestedVersion === undefined) {
    return undefined;
  }

  let selected: ModelCatalogIndexEntry | undefined;
  let selectedVersion: ParsedPiVersion | undefined;
  for (const catalog of index.catalogs) {
    const minimumVersion = requirePiVersion(catalog.minimumPiVersion);
    if (
      comparePiVersions(minimumVersion, requestedVersion) <= 0 &&
      (selectedVersion === undefined || comparePiVersions(minimumVersion, selectedVersion) > 0)
    ) {
      selected = catalog;
      selectedVersion = minimumVersion;
    }
  }
  return selected;
};

export const selectModelCatalog: {
  (piVersion: string | undefined): (index: ModelCatalogIndex) => ModelCatalogIndexEntry | undefined;
  (index: ModelCatalogIndex, piVersion: string | undefined): ModelCatalogIndexEntry | undefined;
} = Function.dual(2, selectCatalog);

export function parseModelCatalogIndex(value: unknown): ModelCatalogIndex {
  if (
    typeof value !== "object" ||
    value === null ||
    Array.isArray(value) ||
    !("schemaVersion" in value) ||
    value.schemaVersion !== MODEL_CATALOG_SCHEMA_VERSION ||
    !("defaultRevision" in value) ||
    typeof value.defaultRevision !== "string" ||
    !MODEL_CATALOG_REVISION_RE.test(value.defaultRevision) ||
    !("catalogs" in value) ||
    !Array.isArray(value.catalogs) ||
    value.catalogs.length === 0 ||
    value.catalogs.some(
      (catalog) =>
        typeof catalog !== "object" ||
        catalog === null ||
        typeof catalog.minimumPiVersion !== "string" ||
        parsePiVersion(catalog.minimumPiVersion) === undefined ||
        typeof catalog.revision !== "string" ||
        !MODEL_CATALOG_REVISION_RE.test(catalog.revision),
    ) ||
    !value.catalogs.some((catalog) => catalog.revision === value.defaultRevision)
  ) {
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

function requirePiVersion(version: string): ParsedPiVersion {
  const parsed = parsePiVersion(version);
  if (parsed === undefined) {
    throw new Error(`Invalid Pi version: ${version}`);
  }
  return parsed;
}

function parsePiVersion(version: string): ParsedPiVersion | undefined {
  const match = PI_VERSION_RE.exec(version.trim());
  if (match === null) {
    return undefined;
  }
  const parsed = [Number(match[1]), Number(match[2]), Number(match[3])] as const;
  if (parsed.some((part) => !Number.isSafeInteger(part))) {
    return undefined;
  }
  return [parsed[0], parsed[1], parsed[2], match[4] ?? ""];
}

function comparePiVersions(left: ParsedPiVersion, right: ParsedPiVersion): number {
  for (const index of [0, 1, 2] as const) {
    const difference = left[index] - right[index];
    if (difference !== 0) {
      return difference;
    }
  }

  const leftPrerelease = left[3];
  const rightPrerelease = right[3];
  if (leftPrerelease === rightPrerelease) {
    return 0;
  }
  if (leftPrerelease === "") {
    return 1;
  }
  if (rightPrerelease === "") {
    return -1;
  }

  const leftParts = leftPrerelease.split(".");
  const rightParts = rightPrerelease.split(".");
  for (let index = 0; index < Math.max(leftParts.length, rightParts.length); index += 1) {
    const leftPart = leftParts[index];
    const rightPart = rightParts[index];
    if (leftPart === undefined) return -1;
    if (rightPart === undefined) return 1;
    if (leftPart === rightPart) continue;

    const leftNumber = /^\d+$/u.test(leftPart) ? Number(leftPart) : undefined;
    const rightNumber = /^\d+$/u.test(rightPart) ? Number(rightPart) : undefined;
    if (leftNumber !== undefined && rightNumber !== undefined) {
      return leftNumber - rightNumber;
    }
    if (leftNumber !== undefined) return -1;
    if (rightNumber !== undefined) return 1;
    return leftPart.localeCompare(rightPart);
  }
  return 0;
}
