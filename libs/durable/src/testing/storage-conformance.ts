import { Effect } from "effect";

import { documentCases } from "./storage-conformance-documents.ts";
import { forksCases } from "./storage-conformance-forks.ts";
import { identityCases } from "./storage-conformance-identities.ts";
import { namespaceCases, recordsCases } from "./storage-conformance-records.ts";
import { scansCases, tableOrderCases } from "./storage-conformance-scans.ts";
import { assertionFacade } from "./storage-conformance-support.ts";
import { tasksCases } from "./storage-conformance-tasks.ts";
import type { StorageConformanceCase, StorageConformanceOptions } from "./types.ts";

export function createStorageConformance(
  options: StorageConformanceOptions,
): readonly StorageConformanceCase[] {
  const expect = assertionFacade(options.assertions);
  return [
    ...recordsCases,
    ...scansCases,
    ...forksCases,
    ...tableOrderCases,
    ...tasksCases,
    ...documentCases,
    ...identityCases,
    ...namespaceCases,
  ].map(({ name, test }) => ({
    name,
    run: () => options.withStorage((storage) => Effect.runPromise(test(storage, expect))),
  }));
}
