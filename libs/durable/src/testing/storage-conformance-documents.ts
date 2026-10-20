import storageConformanceDocumentsAtomic from "./storage-conformance-documents-atomic.ts";
import storageConformanceDocumentsCopy from "./storage-conformance-documents-copy.ts";
import storageConformanceDocumentsHistory from "./storage-conformance-documents-history.ts";
import storageConformanceDocumentsIndex from "./storage-conformance-documents-index.ts";
import type storageConformanceSupportTypes from "./storage-conformance-support.types.ts";

const { documentsHistoryCases } = storageConformanceDocumentsHistory;
const { documentsCopyCases } = storageConformanceDocumentsCopy;
const { documentsIndexCases } = storageConformanceDocumentsIndex;
const { documentsAtomicCases } = storageConformanceDocumentsAtomic;

const documentCases: readonly storageConformanceSupportTypes.StorageCaseSpec[] = [
  ...documentsHistoryCases,
  ...documentsCopyCases,
  ...documentsIndexCases,
  ...documentsAtomicCases,
];

const storageConformanceDocuments = {
  documentCases,
};

export default storageConformanceDocuments;
