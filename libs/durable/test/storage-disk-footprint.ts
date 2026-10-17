import { readdir, stat } from "node:fs/promises";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";

export type DiskFootprint =
  | {
      readonly kind: "sqlite";
      readonly mainBytes: number;
      readonly auxiliaryBytes: number;
      readonly fileCount: number;
      readonly pageCount: number;
      readonly freelistCount: number;
    }
  | {
      readonly kind: "jsonl";
      readonly mainBytes: number;
      readonly auxiliaryBytes: number;
      readonly fileCount: number;
      readonly documentFiles: number;
      readonly taskFiles: number;
    };

async function fileSize(path: string): Promise<number> {
  try {
    return (await stat(path)).size;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return 0;
    throw error;
  }
}

function sqliteMetrics(path: string): Extract<DiskFootprint, { readonly kind: "sqlite" }> {
  const database = new DatabaseSync(path, { readOnly: true });
  try {
    const pageCount = database
      .prepare("SELECT page_count AS value FROM pragma_page_count()")
      .get() as {
      readonly value: number;
    };
    const freelistCount = database
      .prepare("SELECT freelist_count AS value FROM pragma_freelist_count()")
      .get() as {
      readonly value: number;
    };
    return {
      kind: "sqlite",
      mainBytes: 0,
      auxiliaryBytes: 0,
      fileCount: 0,
      pageCount: pageCount.value,
      freelistCount: freelistCount.value,
    };
  } finally {
    database.close();
  }
}

async function jsonlMetrics(
  directory: string,
): Promise<Extract<DiskFootprint, { readonly kind: "jsonl" }>> {
  const entries = await readdir(directory, { withFileTypes: true });
  let mainBytes = 0;
  let auxiliaryBytes = 0;
  let fileCount = 0;
  let documentFiles = 0;
  let taskFiles = 0;
  for await (const entry of entries) {
    if (!entry.isFile()) continue;
    const bytes = await fileSize(join(directory, entry.name));
    fileCount++;
    if (entry.name === "main.jsonl") mainBytes += bytes;
    else auxiliaryBytes += bytes;
    if (entry.name.startsWith("doc-") && entry.name.endsWith(".jsonl")) documentFiles++;
    if (entry.name.startsWith("task-") && entry.name.endsWith(".jsonl")) taskFiles++;
  }
  return { kind: "jsonl", mainBytes, auxiliaryBytes, fileCount, documentFiles, taskFiles };
}

export async function diskFootprint(
  backend: "memory" | "sqlite" | "jsonl",
  path: string | undefined,
): Promise<DiskFootprint | undefined> {
  let disk: DiskFootprint | undefined;
  if (path !== undefined && backend === "sqlite") {
    disk = {
      ...sqliteMetrics(path),
      mainBytes: await fileSize(path),
      auxiliaryBytes: (await fileSize(`${path}-wal`)) + (await fileSize(`${path}-shm`)),
      fileCount: 3,
    };
  } else if (path !== undefined) {
    disk = await jsonlMetrics(path);
  }
  return disk;
}
