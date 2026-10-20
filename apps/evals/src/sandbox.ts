import { tmpdir } from "node:os";

import { Effect, Option } from "effect";
import { dual } from "effect/Function";

import platform from "./platform.ts";
import type sandboxTypes from "./sandbox.types.ts";

const { files, pathOperations, readEnv } = platform;

function parseSandboxId(name: "MSA_EVAL_SANDBOX_UID" | "MSA_EVAL_SANDBOX_GID"): number | undefined {
  const value = readEnv(name);
  if (value === undefined) return undefined;
  const id = Number(value);
  if (!Number.isSafeInteger(id) || id < 1) throw new Error(`${name} must be a positive integer.`);
  return id;
}

function resolveSandboxIdentity(): sandboxTypes.SandboxIdentity | undefined {
  const uid = parseSandboxId("MSA_EVAL_SANDBOX_UID");
  const gid = parseSandboxId("MSA_EVAL_SANDBOX_GID");
  if (uid === undefined && gid === undefined) return undefined;
  if (uid === undefined || gid === undefined) {
    throw new Error("Set both MSA_EVAL_SANDBOX_UID and MSA_EVAL_SANDBOX_GID, or neither.");
  }
  return { gid, uid };
}

const chownTree: {
  (identity: sandboxTypes.SandboxIdentity): (path: string) => Effect.Effect<void>;
  (path: string, identity: sandboxTypes.SandboxIdentity): Effect.Effect<void>;
} = dual(2, (path: string, identity: sandboxTypes.SandboxIdentity): Effect.Effect<void> =>
  Effect.gen(function* () {
    if ((yield* files.kind(path)) === "directory") {
      const entries = yield* files.readDirectory(path);
      yield* Effect.forEach(
        entries,
        (entry) => chownTree(pathOperations.join(path, entry), identity),
        { concurrency: "unbounded", discard: true },
      );
    }
    yield* files.chown(path, identity.uid, identity.gid);
  }),
);

const protectCache = (directoryName: string): Effect.Effect<string[]> =>
  Effect.gen(function* () {
    const cacheRoot = pathOperations.join(tmpdir(), directoryName);
    if ((yield* files.kind(cacheRoot)) !== "directory") return [];
    const ssrRoot = pathOperations.join(cacheRoot, "ssr");
    const entries = yield* files.readDirectoryIfPresent(ssrRoot);
    if (Option.isNone(entries)) return [];
    yield* Effect.all([files.chmod(cacheRoot, 0o755), files.chmod(ssrRoot, 0o755)]);
    const protectedPaths: string[] = [];
    for (const name of entries.value) {
      const path = pathOperations.join(ssrRoot, name);
      if ((yield* files.kind(path)) !== "file") continue;
      yield* files.chmod(path, 0o600);
      protectedPaths.push(path);
    }
    return protectedPaths;
  });

const protectTransformedModules: Effect.Effect<string[]> = Effect.gen(function* () {
  const names = yield* files.readDirectory(tmpdir());
  const protectedPaths = yield* Effect.forEach(names, protectCache);
  return protectedPaths.flat();
});

function requirePosixRoot(): void {
  if (
    typeof process.getuid !== "function" ||
    typeof process.geteuid !== "function" ||
    typeof process.setuid !== "function" ||
    typeof process.setgid !== "function" ||
    typeof process.setgroups !== "function"
  ) {
    throw new Error("The eval filesystem sandbox requires POSIX user APIs.");
  }
  if (process.getuid() !== 0 || process.geteuid() !== 0) {
    throw new Error(
      "The eval runner must start as root before entering the unprivileged tool sandbox.",
    );
  }
}

function dropPrivileges(identity: sandboxTypes.SandboxIdentity): void {
  process.setgroups?.([]);
  process.setgid?.(identity.gid);
  process.setuid?.(identity.uid);
  if (process.getuid?.() !== identity.uid || process.geteuid?.() !== identity.uid) {
    throw new Error("Failed to enter the unprivileged eval tool sandbox.");
  }
}

const assertUnreadable = (path: string): Effect.Effect<void> =>
  Effect.flatMap(files.probeRead(path), (probe) =>
    probe === "readable"
      ? Effect.die(
          new Error(`The unprivileged eval process can read a transformed eval module: ${path}`),
        )
      : Effect.void,
  );

const enter = (root: string, identity: sandboxTypes.SandboxIdentity): Effect.Effect<void> =>
  Effect.gen(function* () {
    yield* Effect.sync(requirePosixRoot);
    const protectedPaths = yield* protectTransformedModules;
    yield* chownTree(root, identity);
    yield* Effect.sync(() => dropPrivileges(identity));
    yield* Effect.forEach(protectedPaths, assertUnreadable, { discard: true });
  });

const enterToolSandbox: {
  (identity: sandboxTypes.SandboxIdentity | undefined): (root: string) => Effect.Effect<void>;
  (root: string, identity: sandboxTypes.SandboxIdentity | undefined): Effect.Effect<void>;
} = dual(
  2,
  (root: string, identity: sandboxTypes.SandboxIdentity | undefined): Effect.Effect<void> =>
    identity === undefined ? Effect.void : enter(root, identity),
);

const sandbox = {
  chownTree,
  enterToolSandbox,
  resolveSandboxIdentity,
};

export default sandbox;
