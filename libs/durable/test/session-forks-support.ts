import type durableTypes from "@msa/durable/index.types";

function documentCopies(writes: readonly durableTypes.StorageWrite[]) {
  return writes.filter((write) => write.type === "document.copy");
}

export default documentCopies;
