import type { Cell } from "./cell.ts";
import type { StagedListeners } from "./core.ts";
import type { Run } from "./decls.ts";
import { isChordError } from "./errors.ts";
import type { ObjectImpl } from "./object.ts";
import type { ResourceImpl } from "./resource.ts";
import { assertValid } from "./schema.ts";
import { memberSchemas, type Service } from "./service.ts";
import type { Readable } from "./types.ts";

export interface ReloadOptions {
  readonly remove?: readonly string[];
  readonly gateDeadline?: number;
  readonly retireDeadline?: number;
  readonly remote?: Readonly<Record<string, readonly string[]>>;
  readonly remoteRemove?: Readonly<Record<string, readonly string[]>>;
  readonly voteDeadline?: number;
}

export interface ReloadReport {
  readonly codeVersion: number;
  readonly previous: number;
  readonly changed: readonly string[];
  readonly removed: readonly string[];
  readonly prepared: readonly string[];
  readonly gated: readonly string[];
  readonly children?: Readonly<Record<string, ReloadReport>>;
}

export interface Candidate {
  readonly object: ObjectImpl;
  readonly service: Service;
  readonly run: Run;
  readonly reasons: string[];
  readonly atGate: ResourceImpl[];
  readonly replaced: ResourceImpl[];
  readonly migrated: Map<Cell<unknown>, unknown>;
  derived: Map<unknown, unknown>;
  staged: StagedListeners | undefined;
}

const candidateValue = (source: Readable<unknown>): unknown => {
  try {
    return source.value;
  } catch (error) {
    if (isChordError(error, "not_ready") || isChordError(error, "not_in_variant")) return undefined;
    throw error;
  }
};

export const dryRun = (candidate: Candidate): void => {
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
