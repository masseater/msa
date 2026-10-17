import { type StorageWrite } from "@msa/durable";

export function documentCopies(writes: readonly StorageWrite[]) {
  return writes.filter((write) => write.type === "document.copy");
}
