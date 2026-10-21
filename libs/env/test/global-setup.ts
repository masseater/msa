import { Effect } from "effect";
import type { TestProject } from "vite-plus/test/node";

import daemon from "./daemon.ts";
import platform from "./platform.ts";

declare module "vitest" {
  interface ProvidedContext {
    readonly deployedName: string;
    readonly sshd: string;
  }
}

const { fileExists, readBytes, runText, sha256Hex } = platform;

const which = (program: string): Effect.Effect<string | undefined> =>
  Effect.map(runText(["sh", "-c", `command -v ${program}`]), (found) =>
    found.trim() === "" ? undefined : found.trim(),
  );

const findSshd = Effect.gen(function* () {
  if (process.platform === "win32") return undefined;
  const found = yield* which("sshd");
  if (found !== undefined) return found;
  return (yield* fileExists("/usr/sbin/sshd")) ? "/usr/sbin/sshd" : undefined;
});

const prepare = (project: TestProject) =>
  Effect.gen(function* () {
    if (!(yield* fileExists(daemon)))
      return yield* Effect.die(
        new Error(`Build the daemon first: npm run build:daemon in libs/env (missing ${daemon})`),
      );
    const hash = yield* Effect.flatMap(readBytes(daemon), sha256Hex);
    project.provide("deployedName", `msa-env-${hash.slice(0, 32)}`);
    project.provide("sshd", (yield* findSshd) ?? "");
  });

const setup = (project: TestProject): Promise<void> => Effect.runPromise(prepare(project));

export default setup;
