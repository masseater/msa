import { type StorageWrite } from "@msa/durable";

function documentWrites(writes: readonly StorageWrite[]): readonly StorageWrite[] {
  return writes.filter(
    (write) =>
      write.type === "document.create" ||
      write.type === "document.change" ||
      write.type === "document.retire",
  );
}

export default documentWrites;
