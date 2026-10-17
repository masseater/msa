import { Effect } from "effect";

import type { AuthContext } from "./types.ts";

interface NodeFsModule {
  access(path: string): Promise<void>;
}

interface NodeOsModule {
  homedir(): string;
}

const importNodeModule = (specifier: string): Promise<unknown> => import(specifier);

const getProcessEnv = (): Record<string, string | undefined> | undefined => {
  const proc = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process;
  return proc?.env;
};

const expandHome = (path: string): Effect.Effect<string> =>
  Effect.gen(function* () {
    if (!path.startsWith("~")) return path;
    const os = (yield* Effect.promise(() => importNodeModule("node:os"))) as NodeOsModule;
    return os.homedir() + path.slice(1);
  });

export const defaultProviderAuthContext = (): AuthContext => ({
  env(name: string): Promise<string | undefined> {
    const value = getProcessEnv()?.[name];
    return Promise.resolve(
      typeof value === "string" && value.trim().length > 0 ? value : undefined,
    );
  },

  fileExists(path: string): Promise<boolean> {
    return Effect.runPromise(
      Effect.gen(function* () {
        const fs = (yield* Effect.promise(() =>
          importNodeModule("node:fs/promises"),
        )) as NodeFsModule;
        const resolved = yield* expandHome(path);
        yield* Effect.promise(() => fs.access(resolved));
        return true;
      }).pipe(Effect.catchDefect(() => Effect.succeed(false))),
    );
  },
});
