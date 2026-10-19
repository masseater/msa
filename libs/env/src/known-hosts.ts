import { Effect } from "effect";
import { dual } from "effect/Function";

import { HostKeyChangedError } from "./host-key-changed-error.ts";
import {
  fileExists,
  localPath,
  makeDirectories,
  randomHex,
  readText,
  removePath,
  renamePath,
  writeText,
} from "./platform.ts";
import type { SshTarget } from "./ssh-args.ts";

const WHITESPACE_RUN = /\s+/u;

function parseHostKeyLine(alias: string, line: string): { type: string; key: string } {
  const [host, type, key] = line.trim().split(WHITESPACE_RUN);
  if (
    host !== alias ||
    type === undefined ||
    key === undefined ||
    !/^(ssh-[a-z0-9-]+|ecdsa-sha2-[a-z0-9-]+|sk-[a-z0-9@.-]+)$/u.test(type) ||
    !/^[A-Za-z0-9+/]+={0,2}$/u.test(key)
  ) {
    throw new Error(`Not a host key line for ${alias}: ${JSON.stringify(line)}`);
  }
  return { type, key };
}

const knownHostsChanges = new Map<string, Promise<unknown>>();

const rewriteKnownHosts = (
  file: string,
  change: (lines: string[]) => string[],
): Effect.Effect<void> =>
  Effect.gen(function* () {
    yield* makeDirectories({ path: localPath.dirname(file), mode: 0o700 });
    const existing = (yield* fileExists(file))
      ? (yield* readText(file)).split("\n").filter((line) => line !== "")
      : [];
    const lines = change(existing);
    const temporary = `${file}.${yield* randomHex(6)}.tmp`;
    yield* writeText({
      path: temporary,
      text: lines.length === 0 ? "" : `${lines.join("\n")}\n`,
      mode: 0o600,
      exclusive: true,
    });
    yield* renamePath({ from: temporary, to: file }).pipe(
      Effect.onError(() => removePath(temporary)),
    );
  });

function changeKnownHosts(file: string, change: (lines: string[]) => string[]): Promise<void> {
  const previous = knownHostsChanges.get(file) ?? Promise.resolve();
  const next = previous
    .catch(() => undefined)
    .then(() => Effect.runPromise(rewriteKnownHosts(file, change)));
  knownHostsChanges.set(file, next);
  return next.finally(() => {
    if (knownHostsChanges.get(file) === next) knownHostsChanges.delete(file);
  });
}

function addAccepted(
  target: SshTarget,
  accepted: readonly { line: string; type: string; key: string }[],
  existing: string[],
): string[] {
  const alias = target.hostKeyAlias;
  const trusted = new Map<string, string>();
  for (const line of existing) {
    const [host, type, key] = line.trim().split(WHITESPACE_RUN);
    if (host === alias && type !== undefined && key !== undefined) trusted.set(type, key);
  }
  const added: string[] = [];
  for (const { line, type, key } of accepted) {
    const known = trusted.get(type);
    if (known === key) continue;
    if (known !== undefined) {
      throw new HostKeyChangedError(
        `The ${type} host key of ${target.host} changed; forget the old key first`,
      );
    }
    trusted.set(type, key);
    added.push(line);
  }
  return [...existing, ...added];
}

export const acceptHostKey: {
  (lines: readonly string[]): (target: SshTarget) => Promise<void>;
  (target: SshTarget, lines: readonly string[]): Promise<void>;
} = dual(2, (target: SshTarget, lines: readonly string[]): Promise<void> =>
  Effect.runPromise(
    Effect.gen(function* () {
      const accepted = lines.map((line) => ({
        line: line.trim(),
        ...parseHostKeyLine(target.hostKeyAlias, line),
      }));
      yield* Effect.promise(() =>
        changeKnownHosts(target.knownHostsFile, (existing) =>
          addAccepted(target, accepted, existing),
        ),
      );
    }),
  ),
);

export function forgetHostKey(target: SshTarget): Promise<void> {
  return changeKnownHosts(target.knownHostsFile, (existing) =>
    existing.filter((line) => line.trim().split(WHITESPACE_RUN)[0] !== target.hostKeyAlias),
  );
}
