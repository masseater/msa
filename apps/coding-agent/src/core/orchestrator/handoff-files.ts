import { randomUUID } from "node:crypto";
import { mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";

import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

import { resolvePath } from "../../utils/paths.ts";

export const CONSUMED_FILE = "consumed.json";

const Marker = Schema.Struct({ createdAt: Schema.Finite, tasks: Schema.Finite }).pipe(
  Schema.fromJsonString,
);
const Consumed = Schema.String.pipe(Schema.Array, Schema.fromJsonString);

const MARKER_LINE = /^<!-- msa-handoff (.+) -->$/mu;

export interface PendingHandoff {
  name: string;
  path: string;
  createdAt: number;
  tasks: number;
}

function pad(value: number): string {
  return String(value).padStart(2, "0");
}

export function handoffFileName(createdAt: number): string {
  const date = new Date(createdAt);
  const day = `${date.getUTCFullYear()}${pad(date.getUTCMonth() + 1)}${pad(date.getUTCDate())}`;
  const time = `${pad(date.getUTCHours())}${pad(date.getUTCMinutes())}${pad(date.getUTCSeconds())}`;
  return `${day}T${time}Z-${randomUUID().slice(0, 6)}.md`;
}

async function isDirectory(path: string): Promise<boolean> {
  return stat(path).then(
    (info) => info.isDirectory(),
    () => false,
  );
}

export async function handoffPath(
  directory: string,
  cwd: string,
  createdAt: number,
  requested: string | undefined,
): Promise<string> {
  if (requested === undefined || requested.trim() === "") {
    return join(directory, handoffFileName(createdAt));
  }
  const path = resolvePath(requested.trim(), cwd);
  return (await isDirectory(path)) ? join(path, handoffFileName(createdAt)) : path;
}

export async function saveHandoff(path: string, content: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, content, "utf8");
}

async function consumedNames(directory: string): Promise<readonly string[]> {
  const text = await readFile(join(directory, CONSUMED_FILE), "utf8").catch(() => undefined);
  if (text === undefined) return [];
  const decoded = Schema.decodeOption(Consumed)(text);
  return Option.isSome(decoded) ? decoded.value : [];
}

async function recordConsumed(directory: string, name: string): Promise<void> {
  const names = await consumedNames(directory);
  if (names.includes(name)) return;
  await writeFile(
    join(directory, CONSUMED_FILE),
    `${JSON.stringify([...names, name], null, 2)}\n`,
    "utf8",
  );
}

async function describeFile(directory: string, name: string): Promise<PendingHandoff | undefined> {
  const path = join(directory, name);
  const text = await readFile(path, "utf8").catch(() => undefined);
  const json = text === undefined ? undefined : MARKER_LINE.exec(text)?.[1];
  if (json === undefined) return undefined;
  const marker = Schema.decodeOption(Marker)(json);
  return Option.isSome(marker) ? { name, path, ...marker.value } : undefined;
}

export async function pendingHandoffs(directory: string): Promise<PendingHandoff[]> {
  const [entries, consumed] = await Promise.all([
    readdir(directory).catch(() => [] as string[]),
    consumedNames(directory),
  ]);
  const names = entries.filter((name) => name.endsWith(".md") && !consumed.includes(name));
  const described = await Promise.all(names.map((name) => describeFile(directory, name)));
  return described
    .filter((handoff) => handoff !== undefined)
    .toSorted((a, b) => b.createdAt - a.createdAt || b.name.localeCompare(a.name));
}

export async function takeHandoff(directory: string, name: string): Promise<string> {
  const path = resolve(directory, basename(name));
  const content = await readFile(path, "utf8");
  await recordConsumed(directory, basename(name));
  return `${path} を読んで再開する。\n\n<handoff path="${path}">\n${content}\n</handoff>`;
}
