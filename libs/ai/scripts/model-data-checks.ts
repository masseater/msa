import type modelDataChecksTypes from "./model-data-checks.types.ts";
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function sortedRecord<T>(entries: Iterable<readonly [string, T]>): Record<string, T> {
  return Object.fromEntries(Array.from(entries).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));
}

function sameStrings({ expected, actual }: modelDataChecksTypes.StringListComparison): boolean {
  return (
    expected.length === actual.length && expected.every((value, index) => value === actual[index])
  );
}

function describeSetDifference({
  expected,
  actual,
}: modelDataChecksTypes.StringListComparison): string {
  const expectedSet = new Set(expected);
  const actualSet = new Set(actual);
  const missing = expected.filter((value) => !actualSet.has(value));
  const extra = actual.filter((value) => !expectedSet.has(value));
  return [
    missing.length > 0 ? `missing: ${missing.join(", ")}` : "",
    extra.length > 0 ? `extra: ${extra.join(", ")}` : "",
  ]
    .filter(Boolean)
    .join("; ");
}

function listMismatch(
  label: string,
): (comparison: modelDataChecksTypes.StringListComparison) => string[] {
  return (comparison) =>
    sameStrings(comparison) ? [] : [`${label} (${describeSetDifference(comparison)})`];
}

type ModelRecord = Record<string, unknown>;

function isModalityList(value: unknown): value is ("text" | "image")[] {
  return (
    Array.isArray(value) &&
    value.length > 0 &&
    value.every((entry) => entry === "text" || entry === "image")
  );
}

function isPositiveNumber(value: unknown): boolean {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

function mismatch(label: string, field: string, actual: unknown, expected: string): string[] {
  return actual === expected
    ? []
    : [`${label} has ${field} ${JSON.stringify(actual)}, expected ${JSON.stringify(expected)}`];
}

function identityErrors(
  model: ModelRecord,
  expectation: modelDataChecksTypes.ModelValueExpectation,
): string[] {
  const label = `${expectation.providerId}/${expectation.modelId}`;
  return [
    ...mismatch(label, "id", model["id"], expectation.modelId),
    ...mismatch(label, "provider", model["provider"], expectation.providerId),
    ...mismatch(label, "api", model["api"], expectation.api),
    ...(typeof model["name"] !== "string" || model["name"].length === 0
      ? [`${label} has no model name`]
      : []),
    ...(typeof model["baseUrl"] === "string" ? [] : [`${label} has no baseUrl string`]),
  ];
}

function modalityErrors(model: ModelRecord, label: string): string[] {
  const output = model["output"];
  const outputErrors =
    model["type"] === "image"
      ? isModalityList(output) && output.includes("image")
        ? []
        : [`${label} has invalid output modalities`]
      : output === undefined
        ? []
        : [`${label} has unsupported output modalities`];
  return [
    ...(isModalityList(model["input"]) ? [] : [`${label} has invalid input modalities`]),
    ...outputErrors,
  ];
}

function typeErrors(model: ModelRecord, label: string): string[] {
  const contextWindow = isPositiveNumber(model["contextWindow"])
    ? []
    : [`${label} has invalid contextWindow`];
  switch (model["type"]) {
    case "chat":
      return [
        ...(typeof model["reasoning"] === "boolean" ? [] : [`${label} has no reasoning boolean`]),
        ...contextWindow,
        ...(isPositiveNumber(model["maxTokens"]) ? [] : [`${label} has invalid maxTokens`]),
      ];
    case "classifier":
      return contextWindow;
    case "image":
      return [];
    default:
      return [
        `${label} has type ${JSON.stringify(model["type"])}, expected "chat", "image", or "classifier"`,
      ];
  }
}

function costErrors(model: ModelRecord, label: string): string[] {
  const cost = model["cost"];
  if (!isRecord(cost)) return [`${label} has invalid cost metadata`];
  return (["input", "output", "cacheRead", "cacheWrite"] as const).flatMap((field) => {
    const value = cost[field];
    return typeof value === "number" && Number.isFinite(value)
      ? []
      : [`${label} has invalid cost.${field}`];
  });
}

function modelValueErrors(expectation: modelDataChecksTypes.ModelValueExpectation): string[] {
  const label = `${expectation.providerId}/${expectation.modelId}`;
  const model = expectation.value;
  if (!isRecord(model)) return [`${label} must be an object`];
  return [
    ...identityErrors(model, expectation),
    ...modalityErrors(model, label),
    ...typeErrors(model, label),
    ...costErrors(model, label),
  ];
}

function manifestErrors({
  manifest,
  schemaVersion,
  structureHash,
  expectedFiles,
}: modelDataChecksTypes.ManifestExpectation): string[] {
  const generatedAt = manifest?.["generatedAt"];
  const files = manifest?.["files"];
  return [
    ...(manifest?.["schemaVersion"] === schemaVersion
      ? []
      : [
          `model data schema is ${JSON.stringify(manifest?.["schemaVersion"])}, expected ${schemaVersion}`,
        ]),
    ...(typeof generatedAt === "string" && !Number.isNaN(Date.parse(generatedAt))
      ? []
      : ["model data manifest has an invalid generation timestamp"]),
    ...(manifest?.["structureHash"] === structureHash
      ? []
      : ["model data generation stamp does not match the generated catalog"]),
    ...(isRecord(files)
      ? listMismatch("manifest file hashes do not match provider data files")({
          actual: Object.keys(files).sort(),
          expected: expectedFiles,
        })
      : ["model data manifest has no file hashes"]),
  ];
}

function structureFromGroups({
  path,
  groups,
}: modelDataChecksTypes.StoredGroups):
  | { readonly structure: Record<string, string> }
  | { readonly error: string } {
  const models = new Map<string, string>();
  for (const [api, value] of Object.entries(groups)) {
    if (!isRecord(value))
      return { error: `${path} API group ${JSON.stringify(api)} must be an object` };
    for (const modelKey of Object.keys(value)) {
      if (models.has(modelKey))
        return { error: `${path} contains ${modelKey} in more than one API group` };
      models.set(modelKey, api);
    }
  }
  if (models.size === 0) return { error: `${path} contains no generated model data` };
  return { structure: sortedRecord(models) };
}

function groupedModelErrors({
  providerId,
  filename,
  groups,
}: modelDataChecksTypes.ProviderGroups): {
  readonly errors: string[];
  readonly actualModels: Map<string, string>;
} {
  const errors: string[] = [];
  const actualModels = new Map<string, string>();
  for (const [api, value] of Object.entries(groups)) {
    if (!isRecord(value)) {
      errors.push(`${filename} API group ${JSON.stringify(api)} must be an object`);
      continue;
    }
    for (const [modelKey, model] of Object.entries(value)) {
      if (actualModels.has(modelKey)) {
        errors.push(`${providerId}/${modelKey} appears in more than one API group`);
        continue;
      }
      actualModels.set(modelKey, api);
      const modelId = modelKey.slice(modelKey.indexOf(":") + 1);
      errors.push(...modelValueErrors({ api, modelId, providerId, value: model }));
      if (isRecord(model) && modelKey !== `${String(model["type"])}:${String(model["id"])}`)
        errors.push(`${providerId}/${modelKey} has mismatched type/id identity`);
    }
  }
  return { actualModels, errors };
}

function apiPlacementErrors({
  providerId,
  expectedModels,
  actualModels,
}: modelDataChecksTypes.ApiPlacement): string[] {
  return Object.entries(expectedModels).flatMap(([modelId, expectedApi]) => {
    const actualApi = actualModels.get(modelId);
    return actualApi === undefined || actualApi === expectedApi
      ? []
      : [
          `${providerId}/${modelId} is grouped under API ${JSON.stringify(actualApi)}, expected ${JSON.stringify(expectedApi)}`,
        ];
  });
}

const modelDataChecks = {
  apiPlacementErrors,
  describeSetDifference,
  groupedModelErrors,
  isRecord,
  listMismatch,
  manifestErrors,
  modelValueErrors,
  sameStrings,
  sortedRecord,
  structureFromGroups,
};

export default modelDataChecks;
