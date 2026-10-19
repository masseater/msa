import { BACKGROUND_CONTEXT } from "@msa/chord/context";
import type { ExecutionEnv, FileError } from "@msa/durable/env";
import { NodeExecutionEnv } from "@msa/durable/env/node";
import { Effect } from "effect";
import { dual } from "effect/Function";

import { Connection } from "../src/connection.ts";
import { RemoteExecutionEnv } from "../src/remote-env.ts";
import { daemon } from "./daemon.ts";
import { makeTempDirectory, realPath, removePath } from "./platform.ts";

export const context = BACKGROUND_CONTEXT;

export interface Root {
  readonly path: string;
  readonly real: string;
}

export interface Pair {
  readonly local: ExecutionEnv;
  readonly remote: ExecutionEnv;
  readonly roots: [Root, Root];
}

export interface Pairs {
  readonly pair: Effect.Effect<Pair>;
  readonly close: () => Promise<void>;
}

const makeRoot = (prefix: string, dirs: string[]): Effect.Effect<Root> =>
  Effect.gen(function* () {
    const path = yield* makeTempDirectory(prefix);
    dirs.push(path);
    return { path, real: yield* realPath(path) };
  });

export function pairs(): Pairs {
  const connection = new Connection({ command: [daemon] });
  const dirs: string[] = [];
  return {
    pair: Effect.gen(function* () {
      const localRoot = yield* makeRoot("msa-env-local-", dirs);
      const remoteRoot = yield* makeRoot("msa-env-remote-", dirs);
      return {
        local: new NodeExecutionEnv({ cwd: localRoot.path }),
        remote: new RemoteExecutionEnv({ connection, id: "msa-env:test", cwd: remoteRoot.path }),
        roots: [localRoot, remoteRoot],
      };
    }),
    close: () =>
      Effect.runPromise(
        Effect.gen(function* () {
          connection.close();
          for (const dir of dirs) yield* removePath(dir);
        }),
      ),
  };
}

export function random(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function comparable(key: string, field: unknown): unknown {
  if (field instanceof Uint8Array) return { bytes: Buffer.from(field).toString("hex") };
  if (key === "mtimeMs") return "mtime";
  if (typeof field === "object" && field !== null && "ok" in field && field.ok === false) {
    return { ok: false, code: (field as { ok: unknown; error: FileError }).error.code };
  }
  return field;
}

const escaped = (path: string): string => JSON.stringify(path).slice(1, -1);

function normalizeIn(value: unknown, root: Root): unknown {
  const json = JSON.stringify(value, comparable);
  if (json === undefined) return undefined;
  return JSON.parse(
    json.replaceAll(escaped(root.real), "<root>").replaceAll(escaped(root.path), "<root>"),
  );
}

export const normalize: {
  (root: Root): (value: unknown) => unknown;
  (value: unknown, root: Root): unknown;
} = dual(2, normalizeIn);
