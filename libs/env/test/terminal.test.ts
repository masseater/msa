import { Effect } from "effect";
import { afterAll, describe, expect, it } from "vite-plus/test";

import { Connection, RemoteError } from "../src/connection.ts";
import { openTerminal, type TerminalForeground } from "../src/terminal.ts";
import { daemon } from "./daemon.ts";
import { windows } from "./environment.ts";
import { localPath, makeTempDirectory, readText, removePath } from "./platform.ts";

const connections: Connection[] = [];
const dirs: string[] = [];
afterAll(() =>
  Effect.runPromise(
    Effect.gen(function* () {
      for (const connection of connections) connection.close();
      for (const dir of dirs) yield* removePath(dir);
    }),
  ),
);

const connect: Effect.Effect<{ connection: Connection; cwd: string }> = Effect.map(
  makeTempDirectory("msa-env-terminal-"),
  (cwd) => {
    dirs.push(cwd);
    const connection = new Connection({ command: [daemon] });
    connections.push(connection);
    return { connection, cwd };
  },
);

function collector(): {
  onData: (bytes: Uint8Array) => void;
  bytes: () => Buffer;
  waitFor: (text: string) => Effect.Effect<void>;
} {
  const chunks: Buffer[] = [];
  const waiting: { text: string; resolve: () => void }[] = [];
  const bytes = (): Buffer => Buffer.concat(chunks);
  return {
    bytes,
    onData: (data) => {
      chunks.push(Buffer.from(data));
      const all = bytes().toString("latin1");
      for (const wait of waiting.splice(0)) {
        if (all.includes(wait.text)) wait.resolve();
        else waiting.push(wait);
      }
    },
    waitFor: (text) =>
      bytes().toString("latin1").includes(text)
        ? Effect.void
        : Effect.callback<void>((resume) => {
            waiting.push({
              text,
              resolve: () => {
                resume(Effect.void);
              },
            });
          }),
  };
}

const run = (effect: Effect.Effect<void>): Promise<void> => Effect.runPromise(effect);

const ignoreData = (): void => undefined;

const ttyProgram = Effect.gen(function* () {
  const { connection, cwd } = yield* connect;
  const output = collector();
  const terminal = yield* Effect.promise(() =>
    openTerminal(connection, {
      cwd,
      argv: ["/bin/sh"],
      env: { PS1: "$ ", TERM: "xterm-256color" },
      cols: 80,
      rows: 24,
      onData: output.onData,
    }),
  );
  expect(terminal.pid).toBeGreaterThan(0);
  terminal.write("test -t 0 && echo IS-A-TTY; stty size; echo $TERM\n");
  yield* output.waitFor("IS-A-TTY");
  yield* output.waitFor("24 80");
  yield* output.waitFor("xterm-256color");
  terminal.resize(100, 30);
  terminal.write("stty size\n");
  yield* output.waitFor("30 100");
  terminal.write("exit 3\n");
  expect(yield* Effect.promise(() => terminal.exited)).toBe(3);
});

const named = process.platform === "darwin" || process.platform === "linux";

const isCommand = (foreground: TerminalForeground | undefined): boolean =>
  foreground !== undefined && (!named || foreground.name === "sleep");

const foregroundJob = Effect.gen(function* () {
  const { connection, cwd } = yield* connect;
  const output = collector();
  const terminal = yield* Effect.promise(() =>
    openTerminal(connection, {
      cwd,
      argv: ["/bin/sh", "-i"],
      env: { PS1: "$ ", TERM: "xterm-256color" },
      cols: 80,
      rows: 24,
      onData: output.onData,
    }),
  );
  terminal.write("echo READY\n");
  yield* output.waitFor("READY");
  expect(yield* Effect.promise(() => terminal.foreground())).toBeUndefined();
  terminal.write("sleep 100\n");
  let foreground = yield* Effect.promise(() => terminal.foreground());
  for (let tries = 0; !isCommand(foreground) && tries < 100; tries++) {
    yield* Effect.sleep(20);
    foreground = yield* Effect.promise(() => terminal.foreground());
  }
  expect(foreground?.pid).toBeGreaterThan(0);
  expect(foreground?.pid).not.toBe(terminal.pid);
  if (named) expect(foreground?.name).toBe("sleep");
  terminal.close();
  yield* Effect.promise(() => expect(terminal.exited).rejects.toMatchObject({ code: "aborted" }));
  yield* Effect.promise(() =>
    expect(terminal.foreground()).rejects.toMatchObject({ code: "EBADF" }),
  );
});

const rawBytes = Effect.gen(function* () {
  const { connection, cwd } = yield* connect;
  const output = collector();
  const terminal = yield* Effect.promise(() =>
    openTerminal(connection, {
      cwd,
      argv: ["sh", "-c", "printf 'a\\377b'"],
      cols: 80,
      rows: 24,
      onData: output.onData,
    }),
  );
  expect(yield* Effect.promise(() => terminal.exited)).toBe(0);
  expect([...output.bytes()]).toEqual([0x61, 0xff, 0x62]);
});

const inputOrder = Effect.gen(function* () {
  const { connection, cwd } = yield* connect;
  const terminal = yield* Effect.promise(() =>
    openTerminal(connection, {
      cwd,
      argv: ["sh", "-c", "head -c 40000 > input.txt"],
      cols: 80,
      rows: 24,
      onData: ignoreData,
    }),
  );
  let text = "";
  for (let index = 0; index < 4000; index++) {
    const piece = `${String(index).padStart(9, "0")}\n`;
    text += piece;
    terminal.write(piece);
  }
  expect(yield* Effect.promise(() => terminal.exited)).toBe(0);
  expect(yield* readText(localPath.join(cwd, "input.txt"))).toBe(text);
});

const killOnClose = Effect.gen(function* () {
  const { connection, cwd } = yield* connect;
  const terminal = yield* Effect.promise(() =>
    openTerminal(connection, {
      cwd,
      argv: ["sleep", "100"],
      cols: 80,
      rows: 24,
      onData: ignoreData,
    }),
  );
  terminal.close();
  yield* Effect.promise(() => expect(terminal.exited).rejects.toMatchObject({ code: "aborted" }));
});

const missingDirectory = Effect.flatMap(connect, ({ connection, cwd }) =>
  Effect.promise(() =>
    expect(
      openTerminal(connection, {
        cwd: localPath.join(cwd, "missing"),
        cols: 80,
        rows: 24,
        onData: ignoreData,
      }),
    ).rejects.toBeInstanceOf(RemoteError),
  ),
);

const missingTerminal = Effect.flatMap(connect, ({ connection }) =>
  Effect.promise(() =>
    expect(connection.request("ptyWrite", { target: 999 })).rejects.toMatchObject({
      code: "EBADF",
    }),
  ),
);

describe.skipIf(windows)("openTerminal", () => {
  it(
    "runs a program in a terminal with input, resizing and its exit code",
    () => run(ttyProgram),
    20_000,
  );
  it(
    "reports the job in the foreground, not the shell at its prompt",
    () => run(foregroundJob),
    20_000,
  );
  it("delivers raw bytes, not decoded text", () => run(rawBytes));
  it("keeps input in order", () => run(inputOrder), 20_000);
  it("kills the program on close", () => run(killOnClose));
  it("fails to open in a missing directory", () => run(missingDirectory));
  it("rejects writes to a terminal that does not exist", () => run(missingTerminal));
});
