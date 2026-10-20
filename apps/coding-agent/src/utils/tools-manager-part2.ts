import * as Effect from "effect/Effect";

import configModule from "../config.ts";
import awaitingModule from "../core/awaiting.ts";
import platformNode from "../core/platform-node.ts";
import nodeFs from "../core/platform/node/fs.ts";
import nodeStreamPromises from "../core/platform/node/stream-promises.ts";
import nodeStream from "../core/platform/node/stream.ts";
import managementHttp from "./management-http.ts";
import toolsManagerPart1 from "./tools-manager-part1.ts";

const { awaited, awaiting } = awaitingModule;
const { fetchWithRetry } = managementHttp;
const { APP_NAME } = configModule;
const { createWriteStream, readdirSync } = nodeFs;
const { pipeline } = nodeStreamPromises;
const { Readable } = nodeStream;
const { join } = platformNode;
const { DOWNLOAD_TIMEOUT_MS, NETWORK_TIMEOUT_MS } = toolsManagerPart1;

function getLatestVersion(repo: string): Promise<string> {
  return Effect.runPromise(
    awaiting(function* () {
      const response = yield* awaited(
        fetchWithRetry(
          `https://github.com/${repo}/releases/latest`,
          {
            headers: { "User-Agent": `${APP_NAME}-coding-agent` },
            redirect: "manual",
          },
          { timeoutMs: NETWORK_TIMEOUT_MS },
        ),
      );

      try {
        yield* awaited(response.body?.cancel());
      } catch {}

      const location =
        response.status >= 300 && response.status < 400 ? response.headers.get("location") : null;
      if (location === null || location === "") {
        throw new Error(
          `Failed to resolve latest ${repo} release: HTTP ${response.status} without redirect`,
        );
      }

      const tag = new URL(location, "https://github.com").pathname.split("/").pop();
      if (tag === undefined || tag === "" || !location.includes("/releases/tag/")) {
        throw new Error(
          `Failed to resolve latest ${repo} release: unexpected redirect to ${location}`,
        );
      }
      return decodeURIComponent(tag).replace(/^v/u, "");
    }),
  );
}

function downloadFile(url: string, dest: string): Promise<void> {
  return Effect.runPromise(
    awaiting(function* () {
      const response = yield* awaited(
        fetchWithRetry(url, undefined, { timeoutMs: DOWNLOAD_TIMEOUT_MS }),
      );

      if (!response.ok) {
        throw new Error(`Download failed with HTTP ${response.status}: ${url}`);
      }

      if (response.body === null) {
        throw new Error("No response body");
      }

      const fileStream = createWriteStream(dest);
      yield* awaited(pipeline(Readable.fromWeb(response.body as any), fileStream));
    }),
  );
}

function findBinaryRecursively(rootDir: string, binaryFileName: string): string | null {
  const stack: string[] = [rootDir];

  while (stack.length > 0) {
    const currentDir = stack.pop();
    if (currentDir === undefined || currentDir === "") continue;

    const entries = readdirSync(currentDir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = join(currentDir, entry.name);
      if (entry.isFile() && entry.name === binaryFileName) {
        return fullPath;
      }
      if (entry.isDirectory()) {
        stack.push(fullPath);
      }
    }
  }

  return null;
}

const toolsManagerPart2 = {
  downloadFile,
  findBinaryRecursively,
  getLatestVersion,
};

export default toolsManagerPart2;
