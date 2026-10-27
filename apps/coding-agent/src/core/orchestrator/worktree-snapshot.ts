import { Effect } from "effect";

import exec from "../exec.ts";
import platform from "../platform/index.ts";
import platformPath from "../platform/path.ts";
import type worktreeSnapshotTypes from "./worktree-snapshot.types.ts";

const { execCommand } = exec;
const { files, randomHex, sha256Hex } = platform;

const GIT_TIMEOUT_MS = 60_000;
const DIFF_LIMIT = 6000;
const SKIPPED_DIRECTORIES: ReadonlySet<string> = new Set([".git", "node_modules"]);

type Snapshot = worktreeSnapshotTypes.Snapshot;

interface GitRun {
  ok: boolean;
  output: string;
}

function git(
  cwd: string,
  args: readonly string[],
  env?: Readonly<Record<string, string>>,
): Effect.Effect<GitRun> {
  return Effect.tryPromise(() =>
    execCommand("git", [...args], cwd, {
      timeout: GIT_TIMEOUT_MS,
      ...(env === undefined ? {} : { env }),
    }),
  ).pipe(
    Effect.map((result) => ({
      ok: result.code === 0,
      output: (result.code === 0 ? result.stdout : result.stderr).trim(),
    })),
    Effect.orElseSucceed(() => ({ ok: false, output: "" })),
  );
}

function promised<A>(run: () => Promise<A>): Effect.Effect<A | undefined> {
  return Effect.tryPromise(run).pipe(Effect.orElseSucceed(() => undefined));
}

function gitSnapshot(cwd: string): Effect.Effect<Snapshot | undefined> {
  return Effect.gen(function* () {
    const located = yield* git(cwd, [
      "rev-parse",
      "--show-toplevel",
      "--absolute-git-dir",
      "--path-format=absolute",
      "--git-path",
      "index",
    ]);
    const [root, gitDirectory, index] = located.output.split("\n");
    if (!located.ok || root === undefined || gitDirectory === undefined || index === undefined) {
      return undefined;
    }
    const temporary = platformPath.join(gitDirectory, `msa-snapshot-${randomHex(6)}`);
    if ((yield* promised(() => files.exists(index))) === true) {
      yield* promised(() => files.copyFile({ from: index, to: temporary }));
    }
    const env = { GIT_INDEX_FILE: temporary };
    const added = yield* git(root, ["add", "--all"], env);
    const written = added.ok ? yield* git(root, ["write-tree"], env) : added;
    yield* promised(() => files.remove({ force: true, path: temporary }));
    if (!written.ok || written.output === "") return undefined;
    return { id: `tree:${written.output}`, root, tree: written.output };
  });
}

function listFiles(root: string): Effect.Effect<string[] | undefined> {
  return Effect.gen(function* () {
    const found: string[] = [];
    const pending = [""];
    while (pending.length > 0) {
      const relative = pending.pop() ?? "";
      const names = yield* promised(() => files.readDirectory(platformPath.join(root, relative)));
      if (names === undefined) return relative === "" ? undefined : found;
      for (const name of names) {
        if (SKIPPED_DIRECTORIES.has(name)) continue;
        const path = relative === "" ? name : `${relative}/${name}`;
        const info = yield* promised(() => files.stat(platformPath.join(root, path)));
        if (info?.isDirectory === true) pending.push(path);
        else if (info?.isFile === true) found.push(path);
      }
    }
    return found.sort();
  });
}

function fileSnapshot(cwd: string): Effect.Effect<Snapshot | undefined> {
  return Effect.gen(function* () {
    const paths = yield* listFiles(cwd);
    if (paths === undefined) return undefined;
    const entries: string[] = [];
    for (const path of paths) {
      const text = yield* promised(() => files.readText(platformPath.join(cwd, path)));
      entries.push(`${path}\0${text === undefined ? "-" : sha256Hex(text)}`);
    }
    return { id: `files:${sha256Hex(entries.join("\n"))}`, root: cwd, tree: undefined };
  });
}

function take(cwd: string): Effect.Effect<Snapshot | undefined> {
  return Effect.gen(function* () {
    return (yield* gitSnapshot(cwd)) ?? (yield* fileSnapshot(cwd));
  });
}

function same(before: Snapshot | undefined, after: Snapshot | undefined): boolean {
  return before !== undefined && after !== undefined && before.id === after.id;
}

function clip(text: string): string {
  return text.length <= DIFF_LIMIT ? text : `${text.slice(0, DIFF_LIMIT)}\n[…]`;
}

function diff(before: Snapshot | undefined, after: Snapshot | undefined): Effect.Effect<string> {
  if (before === undefined || after === undefined) {
    return Effect.succeed("(unknown: the working tree could not be read)");
  }
  if (before.id === after.id) return Effect.succeed("(no change to the working tree)");
  if (before.tree === undefined || after.tree === undefined || before.root !== after.root) {
    return Effect.succeed("(the files changed; there is no git repository to show the diff)");
  }
  return Effect.map(
    git(after.root, ["diff", "--no-color", "--stat", "--patch", before.tree, after.tree]),
    (result) => (result.ok ? clip(result.output) : "(the files changed; the diff failed)"),
  );
}

function commitOf(snapshot: Snapshot): Effect.Effect<string | undefined> {
  return Effect.gen(function* () {
    if (snapshot.tree === undefined) return undefined;
    const head = yield* git(snapshot.root, ["rev-parse", "--verify", "--quiet", "HEAD"]);
    const parent = head.ok ? ["-p", head.output] : [];
    const commit = yield* git(snapshot.root, [
      "-c",
      "user.name=msa",
      "-c",
      "user.email=msa@localhost.invalid",
      "commit-tree",
      snapshot.tree,
      ...parent,
      "-m",
      "msa: working tree snapshot",
    ]);
    return commit.ok ? commit.output : undefined;
  });
}

const worktreeSnapshot = { commitOf, diff, listFiles, same, take };

export default worktreeSnapshot;
