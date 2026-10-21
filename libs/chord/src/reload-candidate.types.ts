import type cellTypes from "./cell.types.ts";
import type coreTypes from "./core.types.ts";
import type declsTypes from "./decls.types.ts";
import type objectTypes from "./object.types.ts";
import type resourceTypes from "./resource.types.ts";
import type serviceTypes from "./service.types.ts";

declare namespace reloadCandidateTypes {
  interface ReloadOptions {
    readonly remove?: readonly string[];
    readonly gateDeadline?: number;
    readonly retireDeadline?: number;
    readonly remote?: Readonly<Record<string, readonly string[]>>;
    readonly remoteRemove?: Readonly<Record<string, readonly string[]>>;
    readonly voteDeadline?: number;
  }

  interface ReloadReport {
    readonly codeVersion: number;
    readonly previous: number;
    readonly changed: readonly string[];
    readonly removed: readonly string[];
    readonly prepared: readonly string[];
    readonly gated: readonly string[];
    readonly children?: Readonly<Record<string, ReloadReport>>;
  }

  interface Candidate {
    readonly object: objectTypes.ObjectImpl;
    readonly service: serviceTypes.Service;
    readonly run: declsTypes.Run;
    readonly reasons: string[];
    readonly atGate: resourceTypes.ResourceImpl[];
    readonly replaced: resourceTypes.ResourceImpl[];
    readonly migrated: Map<cellTypes.Cell<unknown>, unknown>;
    derived: Map<unknown, unknown>;
    staged: coreTypes.StagedListeners | undefined;
  }
}

export type { reloadCandidateTypes as default };
