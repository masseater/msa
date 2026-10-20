import contextModule from "@msa/chord/context";
import type envTypes from "@msa/durable/env.types";
import node from "@msa/durable/env/node";
import { Effect } from "effect";
import { dual } from "effect/Function";

import connectionModule from "../src/connection.ts";
import RemoteExecutionEnv from "../src/remote-env.ts";
import daemon from "./daemon.ts";
import type differentialSupportTypes from "./differential-support.types.ts";
import platform from "./platform.ts";

const { BACKGROUND_CONTEXT } = contextModule;

const { NodeExecutionEnv } = node;

const { Connection } = connectionModule;

const { makeTempDirectory, realPath, removePath } = platform;

const context = BACKGROUND_CONTEXT;

const makeRoot = (prefix: string, dirs: string[]): Effect.Effect<differentialSupportTypes.Root> =>
  Effect.gen(function* () {
    const path = yield* makeTempDirectory(prefix);
    dirs.push(path);
    return { path, real: yield* realPath(path) };
  });

function pairs(): differentialSupportTypes.Pairs {
  const connection = new Connection({ command: [daemon] });
  const dirs: string[] = [];
  return {
    close: () =>
      Effect.runPromise(
        Effect.gen(function* () {
          connection.close();
          for (const dir of dirs) yield* removePath(dir);
        }),
      ),
    pair: Effect.gen(function* () {
      const localRoot = yield* makeRoot("msa-env-local-", dirs);
      const remoteRoot = yield* makeRoot("msa-env-remote-", dirs);
      return {
        local: new NodeExecutionEnv({ cwd: localRoot.path }),
        remote: new RemoteExecutionEnv({ connection, cwd: remoteRoot.path, id: "msa-env:test" }),
        roots: [localRoot, remoteRoot],
      };
    }),
  };
}

function random(seed: number): () => number {
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
    return { code: (field as { ok: unknown; error: envTypes.FileError }).error.code, ok: false };
  }
  return field;
}

const escaped = (path: string): string => JSON.stringify(path).slice(1, -1);

function normalizeIn(value: unknown, root: differentialSupportTypes.Root): unknown {
  const json = JSON.stringify(value, comparable);
  if (json === undefined) return undefined;
  return JSON.parse(
    json.replaceAll(escaped(root.real), "<root>").replaceAll(escaped(root.path), "<root>"),
  );
}

const normalize: {
  (root: differentialSupportTypes.Root): (value: unknown) => unknown;
  (value: unknown, root: differentialSupportTypes.Root): unknown;
} = dual(2, normalizeIn);

const differentialSupport = {
  context,
  normalize,
  pairs,
  random,
};

export default differentialSupport;
