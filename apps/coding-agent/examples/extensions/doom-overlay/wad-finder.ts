import { fileURLToPath } from "node:url";
import { gunzipSync } from "node:zlib";

import { NodeServices } from "@effect/platform-node";
import { readProcessEnv } from "@msa/ai/utils/env";
import { Data, Effect, FileSystem, Layer, ManagedRuntime, Path } from "effect";
import { FetchHttpClient, HttpClient } from "effect/http";

const runtime = ManagedRuntime.make(Layer.mergeAll(NodeServices.layer, FetchHttpClient.layer));
const pathService = runtime.runSync(Path.Path);
const fsService = runtime.runSync(FileSystem.FileSystem);

const here = fileURLToPath(new URL(".", import.meta.url));
const BUNDLED_WAD = pathService.join(here, "doom1.wad");
const WAD_URL = "https://www.gamers.org/pub/idgames/idstuff/doom/doom-1.8.wad.gz";

const DEFAULT_WAD_PATHS = ["./doom1.wad", "./DOOM1.WAD", "~/doom1.wad", "~/.doom/doom1.wad"];

class WadDownloadError extends Data.TaggedError("WadDownloadError")<{
  readonly message: string;
}> {}

const expandHome = (path: string): string =>
  pathService.resolve(path.replace(/^~/u, readProcessEnv("HOME") || ""));

const exists = (path: string): boolean => runtime.runSync(fsService.exists(path));

export function findWadFile(customPath?: string): string | null {
  if (customPath !== undefined && customPath.length > 0) {
    const resolved = expandHome(customPath);
    return exists(resolved) ? resolved : null;
  }

  if (exists(BUNDLED_WAD)) {
    return BUNDLED_WAD;
  }

  for (const candidate of DEFAULT_WAD_PATHS) {
    const resolved = expandHome(candidate);
    if (exists(resolved)) return resolved;
  }

  return null;
}

const downloadWad = Effect.gen(function* () {
  const client = yield* HttpClient.HttpClient;
  const response = yield* client.get(WAD_URL);
  if (response.status !== 200) {
    return yield* new WadDownloadError({ message: `HTTP ${response.status}` });
  }

  const bytes = yield* response.arrayBuffer;
  const wad = gunzipSync(Buffer.from(bytes));
  if (wad.subarray(0, 4).toString("ascii") !== "IWAD") {
    return yield* new WadDownloadError({ message: "Downloaded file is not a valid IWAD" });
  }

  const fs = yield* FileSystem.FileSystem;
  yield* fs.writeFile(BUNDLED_WAD, wad);
  return BUNDLED_WAD;
});

export const ensureWadFile = (): Promise<string | null> => {
  const existing = findWadFile();
  if (existing !== null && existing.length > 0) {
    return Promise.resolve(existing);
  }
  return runtime.runPromise(downloadWad.pipe(Effect.orElseSucceed(() => null)));
};
