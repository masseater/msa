import { mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { BACKGROUND_CONTEXT } from "@msa/chord/context";
import type { ExecutionEnv, FileError } from "@msa/durable/env";
import { NodeExecutionEnv } from "@msa/durable/env/node";
import { dual } from "effect/Function";

import { Connection } from "../src/connection.ts";
import { RemoteExecutionEnv } from "../src/remote-env.ts";
import { daemon } from "./daemon.ts";

export const context = BACKGROUND_CONTEXT;

export interface Pair {
  readonly local: ExecutionEnv;
  readonly remote: ExecutionEnv;
  readonly roots: [string, string];
}

export interface Pairs {
  readonly pair: () => Pair;
  readonly close: () => void;
}

export function pairs(): Pairs {
  const connection = new Connection({ command: [daemon] });
  const dirs: string[] = [];
  return {
    pair: () => {
      const localRoot = mkdtempSync(join(tmpdir(), "msa-env-local-"));
      const remoteRoot = mkdtempSync(join(tmpdir(), "msa-env-remote-"));
      dirs.push(localRoot, remoteRoot);
      return {
        local: new NodeExecutionEnv({ cwd: localRoot }),
        remote: new RemoteExecutionEnv({ connection, id: "msa-env:test", cwd: remoteRoot }),
        roots: [localRoot, remoteRoot],
      };
    },
    close: () => {
      connection.close();
      for (const dir of dirs) {
        rmSync(dir, { recursive: true, force: true, maxRetries: 50, retryDelay: 100 });
      }
    },
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

function normalizeIn(value: unknown, root: string): unknown {
  const json = JSON.stringify(value, comparable);
  if (json === undefined) return undefined;
  return JSON.parse(
    json
      .replaceAll(escaped(realpathSync.native(root)), "<root>")
      .replaceAll(escaped(root), "<root>"),
  );
}

export const normalize: {
  (root: string): (value: unknown) => unknown;
  (value: unknown, root: string): unknown;
} = dual(2, normalizeIn);
