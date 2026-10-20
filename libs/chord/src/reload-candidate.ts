import errorsModule from "./errors.ts";
import type reloadCandidateTypes from "./reload-candidate.types.ts";
import schemaModule from "./schema.ts";
import serviceModule from "./service.ts";
import type typesModule from "./types.types.ts";

const { isChordError } = errorsModule;
const { memberSchemas } = serviceModule;
const { assertValid } = schemaModule;

const candidateValue = (source: typesModule.Readable<unknown>): unknown => {
  try {
    return source.value;
  } catch (error) {
    if (isChordError(error, "not_ready") || isChordError(error, "not_in_variant")) return undefined;
    throw error;
  }
};

const dryRun = (candidate: reloadCandidateTypes.Candidate): void => {
  const { run, migrated, service, object } = candidate;
  const exposed = memberSchemas(service, run.implementation);
  for (const [cell, value] of migrated) {
    for (const schema of exposed.get(cell) ?? [])
      assertValid("state", `${object.address}: migrated state ${cell.key}`, schema, value);
  }
  const values = new Map<unknown, unknown>(migrated);
  const derives = [...run.decls.derives].sort(([, a], [, b]) => a.seq - b.seq);
  for (const [name, derived] of derives) {
    const value = derived.compute((source) =>
      values.has(source) ? values.get(source) : candidateValue(source),
    );
    for (const schema of exposed.get(derived) ?? [])
      assertValid("state", `${object.address}: derivation ${name}`, schema, value);
    values.set(derived, value);
  }
  candidate.derived = values;
};

const reloadCandidate = {
  dryRun,
};

export default reloadCandidate;
