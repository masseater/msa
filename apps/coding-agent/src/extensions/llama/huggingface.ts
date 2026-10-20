import { homedir } from "node:os";

import * as Effect from "effect/Effect";

import awaitingModule from "../../core/awaiting.ts";
import platformNode from "../../core/platform-node.ts";
import nodeFs from "../../utils/node-fs.ts";

const { awaited, awaiting } = awaitingModule;
const { readText } = nodeFs;
const { join } = platformNode;

function readToken(path: string): Promise<string | undefined> {
  return Effect.runPromise(
    awaiting(function* () {
      try {
        const token = (yield* awaited(readText(path))).trim();
        return token || undefined;
      } catch {
        return undefined;
      }
    }),
  );
}
function findHuggingFaceToken(env: NodeJS.ProcessEnv = process.env): Promise<string | undefined> {
  return Effect.runPromise(
    awaiting(function* () {
      const fromEnvironment = env["HF_TOKEN"]?.trim();
      if (fromEnvironment !== undefined && fromEnvironment !== "") return fromEnvironment;

      const paths = [
        env["HF_TOKEN_PATH"],
        env["HF_HOME"] !== undefined && env["HF_HOME"] !== ""
          ? join(env["HF_HOME"], "token")
          : undefined,
        env["XDG_CACHE_HOME"] !== undefined && env["XDG_CACHE_HOME"] !== ""
          ? join(env["XDG_CACHE_HOME"], "huggingface", "token")
          : undefined,
        join(homedir(), ".cache", "huggingface", "token"),
      ].filter((path): path is string => Boolean(path));
      for (const path of new Set(paths)) {
        const token = yield* awaited(readToken(path));
        if (token !== undefined && token !== "") return token;
      }
      return undefined;
    }),
  );
}

const huggingface = {
  findHuggingFaceToken,
};

export default huggingface;
