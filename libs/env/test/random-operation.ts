import type { ExecutionEnv } from "@msa/durable/env";
import { Effect } from "effect";

import { context } from "./differential-support.ts";

const NAMES = ["a.txt", "b", "dir", "dir/c.txt", "dir/sub", "dir/sub/d.bin", "missing", "a.txt/x"];
const CONTENTS: (string | Uint8Array)[] = [
  "",
  "hello\n",
  "\ufeffbom\r\nline",
  Uint8Array.from([0xe2, 0x82, 0x0a, 0xff, 0xef, 0xbb, 0xbf]),
  "x".repeat(70_000),
  "é".repeat(300_001),
];

type Operation = (env: ExecutionEnv) => Promise<unknown>;

interface Picker {
  readonly name: () => string;
  readonly content: () => string | Uint8Array;
  readonly flag: () => boolean;
  readonly small: (limit: number) => number;
}

const readRange = (pick: Picker): Operation => {
  const name = pick.name();
  const noFollow = pick.flag();
  const offset = pick.small(8);
  const length = pick.small(8);
  return (env) =>
    Effect.runPromise(
      Effect.gen(function* () {
        const reader = yield* Effect.promise(() =>
          env.openBinaryReader(name, { noFollow }, context),
        );
        if (!reader.ok) return reader;
        return yield* Effect.all([
          Effect.promise(() => reader.value.read(offset, length, context)),
          Effect.promise(() => reader.value.scanLines({ startLine: 0 }, context)),
        ]).pipe(Effect.ensuring(Effect.promise(() => reader.value.close(context))));
      }),
    );
};

const CHOICES: readonly (readonly [string, (pick: Picker) => Operation])[] = [
  [
    "writeFile",
    (pick) => {
      const n = pick.name();
      const c = pick.content();
      return (env) => env.writeFile(n, c, context);
    },
  ],
  [
    "appendFile",
    (pick) => {
      const n = pick.name();
      const c = pick.content();
      return (env) => env.appendFile(n, c, context);
    },
  ],
  [
    "readTextFile",
    (pick) => {
      const n = pick.name();
      return (env) => env.readTextFile(n, context);
    },
  ],
  [
    "readBinaryFile",
    (pick) => {
      const n = pick.name();
      return (env) => env.readBinaryFile(n, context);
    },
  ],
  [
    "readTextLines",
    (pick) => {
      const n = pick.name();
      const m = pick.small(4);
      return (env) => env.readTextLines(n, { maxLines: m }, context);
    },
  ],
  [
    "fileInfo",
    (pick) => {
      const n = pick.name();
      return (env) => env.fileInfo(n, context);
    },
  ],
  [
    "exists",
    (pick) => {
      const n = pick.name();
      return (env) => env.exists(n, context);
    },
  ],
  [
    "listDir",
    (pick) => {
      const n = pick.name();
      return (env) => env.listDir(n, context);
    },
  ],
  [
    "createDir",
    (pick) => {
      const n = pick.name();
      const r = pick.flag();
      return (env) => env.createDir(n, { recursive: r }, context);
    },
  ],
  [
    "remove",
    (pick) => {
      const n = pick.name();
      const r = pick.flag();
      const f = pick.flag();
      return (env) => env.remove(n, { recursive: r, force: f }, context);
    },
  ],
  [
    "renameFile",
    (pick) => {
      const a = pick.name();
      const b = pick.name();
      return (env) => env.renameFile(a, b, context);
    },
  ],
  [
    "truncateFile",
    (pick) => {
      const n = pick.name();
      const size = pick.small(10);
      return (env) => env.truncateFile(n, size, context);
    },
  ],
  [
    "flushFile",
    (pick) => {
      const n = pick.name();
      return (env) => env.flushFile(n, context);
    },
  ],
  [
    "canonicalPath",
    (pick) => {
      const n = pick.name();
      return (env) => env.canonicalPath(n, context);
    },
  ],
  ["openBinaryReader", readRange],
];

function picker(next: () => number, args: unknown[]): Picker {
  const pick = <T>(value: T): T => {
    args.push(
      value instanceof Uint8Array
        ? "<bytes>"
        : typeof value === "string" && value.length > 20
          ? `<${value.length} chars>`
          : value,
    );
    return value;
  };
  return {
    name: () => pick(NAMES[Math.floor(next() * NAMES.length)]!),
    content: () => pick(CONTENTS[Math.floor(next() * CONTENTS.length)]!),
    flag: () => pick(next() < 0.5),
    small: (limit) => pick(Math.floor(next() * limit)),
  };
}

export function randomOperation(next: () => number): { label: string; run: Operation } {
  const args: unknown[] = [];
  const [label, make] = CHOICES[Math.floor(next() * CHOICES.length)]!;
  const run = make(picker(next, args));
  return { label: `${label}(${args.map((arg) => JSON.stringify(arg)).join(", ")})`, run };
}
