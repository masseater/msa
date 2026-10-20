import { type StorageWrite } from "@msa/durable";

function documentCopies(writes: readonly StorageWrite[]) {
  return writes.filter((write) => write.type === "document.copy");
}

export default documentCopies;
