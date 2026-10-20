import { DateTime, Effect } from "effect";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

import paths from "../../utils/paths.ts";
import awaitingModule from "../awaiting.ts";
import nodeCrypto from "../platform/node/crypto.ts";
import nodeFsPromises from "../platform/node/fs-promises.ts";
import nodePath from "../platform/node/path.ts";
import type handoffFilesTypes from "./handoff-files.types.ts";

const { awaited, awaiting } = awaitingModule;

const { randomUUID } = nodeCrypto;
const { mkdir, readFile, readdir, stat, writeFile } = nodeFsPromises;
const { basename, dirname, join, resolve } = nodePath;

const { resolvePath } = paths;

const CONSUMED_FILE = "consumed.json";

const Marker = Schema.Struct({ createdAt: Schema.Finite, tasks: Schema.Finite }).pipe(
  Schema.fromJsonString,
);
const Consumed = Schema.String.pipe(Schema.Array, Schema.fromJsonString);

const MARKER_LINE = /^<!-- msa-handoff (.+) -->$/mu;

function pad(value: number): string {
  return String(value).padStart(2, "0");
}

function handoffFileName(createdAt: number): string {
  const parts = DateTime.toPartsUtc(DateTime.makeUnsafe(createdAt));
  const day = `${parts.year}${pad(parts.month)}${pad(parts.day)}`;
  const time = `${pad(parts.hour)}${pad(parts.minute)}${pad(parts.second)}`;
  return `${day}T${time}Z-${randomUUID().slice(0, 6)}.md`;
}

function isDirectory(path: string): Promise<boolean> {
  return Effect.runPromise(
    awaiting(function* () {
      return yield* awaited(
        stat(path).then(
          (info) => info.isDirectory(),
          () => false,
        ),
      );
    }),
  );
}

function handoffPath(
  directory: string,
  cwd: string,
  createdAt: number,
  requested: string | undefined,
): Promise<string> {
  return Effect.runPromise(
    awaiting(function* () {
      if (requested === undefined || requested.trim() === "") {
        return yield* awaited(join(directory, handoffFileName(createdAt)));
      }
      const path = resolvePath(requested.trim(), cwd);
      return yield* awaited(
        (yield* awaited(isDirectory(path))) ? join(path, handoffFileName(createdAt)) : path,
      );
    }),
  );
}

function saveHandoff(path: string, content: string): Promise<void> {
  return Effect.runPromise(
    awaiting(function* () {
      yield* awaited(mkdir(dirname(path), { recursive: true }));
      yield* awaited(writeFile(path, content, "utf8"));
    }),
  );
}

function consumedNames(directory: string): Promise<readonly string[]> {
  return Effect.runPromise(
    awaiting(function* () {
      const text = yield* awaited(
        readFile(join(directory, CONSUMED_FILE), "utf8").catch(() => undefined),
      );
      if (text === undefined) return yield* awaited([]);
      const decoded = Schema.decodeOption(Consumed)(text);
      return yield* awaited(Option.isSome(decoded) ? decoded.value : []);
    }),
  );
}

function recordConsumed(directory: string, name: string): Promise<void> {
  return Effect.runPromise(
    awaiting(function* () {
      const names = yield* awaited(consumedNames(directory));
      if (names.includes(name)) return;
      yield* awaited(
        writeFile(
          join(directory, CONSUMED_FILE),
          `${JSON.stringify([...names, name], null, 2)}\n`,
          "utf8",
        ),
      );
    }),
  );
}

function describeFile(
  directory: string,
  name: string,
): Promise<handoffFilesTypes.PendingHandoff | undefined> {
  return Effect.runPromise(
    awaiting(function* () {
      const path = join(directory, name);
      const text = yield* awaited(readFile(path, "utf8").catch(() => undefined));
      const json = text === undefined ? undefined : MARKER_LINE.exec(text)?.[1];
      if (json === undefined) return yield* awaited(undefined);
      const marker = Schema.decodeOption(Marker)(json);
      return yield* awaited(Option.isSome(marker) ? { name, path, ...marker.value } : undefined);
    }),
  );
}

function pendingHandoffs(directory: string): Promise<handoffFilesTypes.PendingHandoff[]> {
  return Effect.runPromise(
    awaiting(function* () {
      const [entries, consumed] = yield* awaited(
        Promise.all([readdir(directory).catch(() => [] as string[]), consumedNames(directory)]),
      );
      const names = entries.filter((name) => name.endsWith(".md") && !consumed.includes(name));
      const described = yield* awaited(
        Promise.all(names.map((name) => describeFile(directory, name))),
      );
      return yield* awaited(
        described
          .filter((handoff) => handoff !== undefined)
          .toSorted((a, b) => b.createdAt - a.createdAt || b.name.localeCompare(a.name)),
      );
    }),
  );
}

function takeHandoff(directory: string, name: string): Promise<string> {
  return Effect.runPromise(
    awaiting(function* () {
      const path = resolve(directory, basename(name));
      const content = yield* awaited(readFile(path, "utf8"));
      yield* awaited(recordConsumed(directory, basename(name)));
      return yield* awaited(
        `${path} を読んで再開する。\n\n<handoff path="${path}">\n${content}\n</handoff>`,
      );
    }),
  );
}

const handoffFiles = {
  CONSUMED_FILE,
  handoffFileName,
  handoffPath,
  pendingHandoffs,
  saveHandoff,
  takeHandoff,
};

export default handoffFiles;
