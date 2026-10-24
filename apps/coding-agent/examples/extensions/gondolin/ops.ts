import type { VM } from "@earendil-works/gondolin";
import type codingAgentTypes from "@msa/coding-agent/index.types";
import { Effect, Option } from "effect";

import platform from "../../../src/core/platform/index.ts";
import GondolinAborted from "./gondolin-aborted.ts";
import paths from "./paths.ts";

const { matchesToolGlob, signalOption, toGuestPath } = paths;

const IMAGE_MIME_TYPES: Readonly<Record<string, string>> = {
  ".gif": "image/gif",
  ".jpeg": "image/jpeg",
  ".jpg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
};
type Visit = (guestPath: string, relativePath: string) => Effect.Effect<boolean, GondolinAborted>;
const failIfAborted = (signal: AbortSignal | undefined) =>
  signal?.aborted === true
    ? Effect.fail(GondolinAborted.make({ message: "Operation aborted" }))
    : Effect.void;
const guestExists = (vm: VM, guestPath: string): Promise<boolean> =>
  vm.fs.access(guestPath).then(
    () => true,
    () => false,
  );
function createGondolinReadOps(vm: VM, localCwd: string): codingAgentTypes.ReadOperations {
  return {
    access: (filePath) => vm.fs.access(toGuestPath(localCwd, filePath)),
    detectImageMimeType: (filePath) =>
      Promise.resolve(
        IMAGE_MIME_TYPES[platform.posix.extname(toGuestPath(localCwd, filePath)).toLowerCase()] ??
          null,
      ),
    readFile: (filePath) => vm.fs.readFile(toGuestPath(localCwd, filePath)),
  };
}
function createGondolinWriteOps(vm: VM, localCwd: string): codingAgentTypes.WriteOperations {
  return {
    mkdir: (dirPath) =>
      vm.fs.mkdir(toGuestPath(localCwd, dirPath), { recursive: true }).then(() => undefined),
    writeFile: (filePath, content) =>
      vm.fs.writeFile(toGuestPath(localCwd, filePath), content, { encoding: "utf8" }),
  };
}
function createGondolinEditOps(vm: VM, localCwd: string): codingAgentTypes.EditOperations {
  const readOps = createGondolinReadOps(vm, localCwd);
  const writeOps = createGondolinWriteOps(vm, localCwd);
  return {
    access: readOps.access,
    readFile: readOps.readFile,
    writeFile: writeOps.writeFile,
  };
}
function createGondolinLsOps(vm: VM, localCwd: string): codingAgentTypes.LsOperations {
  return {
    exists: (filePath) => guestExists(vm, toGuestPath(localCwd, filePath)),
    readdir: (dirPath) => vm.fs.listDir(toGuestPath(localCwd, dirPath)),
    stat: (filePath) => vm.fs.stat(toGuestPath(localCwd, filePath)),
  };
}
const walkDirectory = (
  request: { vm: VM; visit: Visit; signal: AbortSignal | undefined },
  dir: string,
  relativeDir: string,
): Effect.Effect<boolean, GondolinAborted> =>
  Effect.gen(function* () {
    const { vm, visit, signal } = request;
    yield* failIfAborted(signal);
    const entries = yield* Effect.promise(() => vm.fs.listDir(dir, signalOption(signal)));
    for (const entry of entries) {
      if (entry === ".git" || entry === "node_modules") continue;
      const guestPath = platform.posix.join(dir, entry);
      const relativePath = relativeDir === "" ? entry : platform.posix.join(relativeDir, entry);
      const entryStat = yield* Effect.option(
        Effect.tryPromise(() => vm.fs.stat(guestPath, signalOption(signal))),
      );
      if (Option.isNone(entryStat)) continue;
      const keepGoing = entryStat.value.isDirectory()
        ? yield* walkDirectory(request, guestPath, relativePath)
        : yield* visit(guestPath, relativePath);
      if (!keepGoing) return false;
    }
    return true;
  });
const walkGuestFiles = (
  vm: VM,
  root: string,
  visit: Visit,
  signal?: AbortSignal,
): Effect.Effect<boolean, GondolinAborted> =>
  Effect.gen(function* () {
    yield* failIfAborted(signal);
    const stat = yield* Effect.promise(() => vm.fs.stat(root, signalOption(signal)));
    if (!stat.isDirectory()) return yield* visit(root, platform.posix.basename(root));
    return yield* walkDirectory({ signal, visit, vm }, root, "");
  });
function createGondolinFindOps(vm: VM, localCwd: string): codingAgentTypes.FindOperations {
  return {
    exists: (filePath) => guestExists(vm, toGuestPath(localCwd, filePath)),
    glob: (pattern, cwd, options) => {
      const results: string[] = [];
      return Effect.runPromise(
        walkGuestFiles(vm, toGuestPath(localCwd, cwd), (guestPath, relativePath) =>
          Effect.sync(() => {
            if (results.length >= options.limit) return false;
            if (matchesToolGlob(relativePath, pattern)) results.push(guestPath);
            return results.length < options.limit;
          }),
        ).pipe(Effect.as(results)),
      );
    },
  };
}

const ops = {
  createGondolinEditOps,
  createGondolinFindOps,
  createGondolinLsOps,
  createGondolinReadOps,
  createGondolinWriteOps,
  failIfAborted,
  walkGuestFiles,
};

export default ops;
