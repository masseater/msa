import { documentsAtomicCases } from "./storage-conformance-documents-atomic.ts";
import { documentsCopyCases } from "./storage-conformance-documents-copy.ts";
import { documentsHistoryCases } from "./storage-conformance-documents-history.ts";
import { documentsIndexCases } from "./storage-conformance-documents-index.ts";
import type { StorageCaseSpec } from "./storage-conformance-support.ts";

export const documentCases: readonly StorageCaseSpec[] = [
  ...documentsHistoryCases,
  ...documentsCopyCases,
  ...documentsIndexCases,
  ...documentsAtomicCases,
];
