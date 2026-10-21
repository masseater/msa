import type durableTypes from "@msa/durable/index.types";

function documentWrites(
  writes: readonly durableTypes.StorageWrite[],
): readonly durableTypes.StorageWrite[] {
  return writes.filter(
    (write) =>
      write.type === "document.create" ||
      write.type === "document.change" ||
      write.type === "document.retire",
  );
}

export default documentWrites;
