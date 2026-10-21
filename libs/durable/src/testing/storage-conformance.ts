import { Effect } from "effect";

import storageConformanceDocuments from "./storage-conformance-documents.ts";
import storageConformanceForks from "./storage-conformance-forks.ts";
import storageConformanceIdentities from "./storage-conformance-identities.ts";
import storageConformanceRecords from "./storage-conformance-records.ts";
import storageConformanceScans from "./storage-conformance-scans.ts";
import storageConformanceSupport from "./storage-conformance-support.ts";
import storageConformanceTasks from "./storage-conformance-tasks.ts";
import type typesModule from "./types.ts";

const { assertionFacade } = storageConformanceSupport;
const { namespaceCases, recordsCases } = storageConformanceRecords;
const { scansCases, tableOrderCases } = storageConformanceScans;
const { forksCases } = storageConformanceForks;
const { tasksCases } = storageConformanceTasks;
const { documentCases } = storageConformanceDocuments;
const { identityCases } = storageConformanceIdentities;

function createStorageConformance(
  options: typesModule.StorageConformanceOptions,
): readonly typesModule.StorageConformanceCase[] {
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

const storageConformance = {
  createStorageConformance,
};

export default storageConformance;
