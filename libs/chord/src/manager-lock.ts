import { connect, createServer, type Server } from "node:net";
import { tmpdir } from "node:os";

import { Effect } from "effect";

import { ChordError } from "./errors.ts";
import {
  entryInfo,
  isSymbolicLink,
  joinPath,
  makePrivateDirectory,
  removeForce,
  sha256Hex,
} from "./platform.ts";

const MAX_SOCKET_PATH_BYTES = 103;

const usesSocketFile = (): boolean =>
  process.platform !== "win32" && process.platform !== "linux" && process.platform !== "android";

const lockDirectoryError = (directory: string): ChordError =>
  new ChordError(
    "unavailable",
    `lock directory ${directory} must be a directory only its owner can access`,
  );

const privateLockDirectory = Effect.fn(function* (uid: number) {
  const directory = `/tmp/chord2-${uid}`;
  yield* makePrivateDirectory(directory);
  if (yield* isSymbolicLink(directory)) return yield* Effect.die(lockDirectoryError(directory));
  const stats = yield* entryInfo(directory);
  if (!stats.directory || stats.uid !== uid || (stats.mode & 0o077) !== 0)
    return yield* Effect.die(lockDirectoryError(directory));
  return directory;
});

const lockSocketPath = Effect.fn(function* (file: string) {
  const preferred = yield* joinPath(tmpdir(), file);
  if (Buffer.byteLength(preferred) <= MAX_SOCKET_PATH_BYTES) return preferred;
  const directory = yield* privateLockDirectory(process.getuid?.() ?? 0);
  return yield* joinPath(directory, file);
});

const lockAddress = Effect.fn(function* (name: string) {
  const key = (yield* sha256Hex(name)).slice(0, 32);
  if (process.platform === "win32") return `\\\\.\\pipe\\chord2-${key}`;
  return usesSocketFile() ? yield* lockSocketPath(`chord2-${key}.sock`) : `\0chord2-${key}`;
});

const listen = (server: Server, address: string): Effect.Effect<void, NodeJS.ErrnoException> =>
  Effect.callback<void, NodeJS.ErrnoException>((resume) => {
    const onError = (error: NodeJS.ErrnoException): void => resume(Effect.fail(error));
    server.once("error", onError);
    server.listen(address, () => {
      server.removeListener("error", onError);
      resume(Effect.void);
    });
  });

const accepting = (address: string): Effect.Effect<boolean> =>
  Effect.callback<boolean>((resume) => {
    const socket = connect(address);
    socket.once("connect", () => {
      socket.destroy();
      resume(Effect.succeed(true));
    });
    socket.once("error", (error: NodeJS.ErrnoException) =>
      resume(Effect.succeed(error.code !== "ECONNREFUSED" && error.code !== "ENOENT")),
    );
  });

const bind = (server: Server, address: string, name: string): Effect.Effect<void> =>
  listen(server, address).pipe(
    Effect.catchIf(
      (error) => error.code === "EADDRINUSE",
      () =>
        Effect.flatMap(usesSocketFile() ? accepting(address) : Effect.succeed(true), (held) =>
          held
            ? Effect.die(
                new ChordError("unavailable", `lock ${name} is held by another process`, {
                  reason: "locked",
                }),
              )
            : Effect.andThen(removeForce(address), bind(server, address, name)),
        ),
    ),
    Effect.orDie,
  );

const closeServer = (server: Server): Effect.Effect<void> =>
  Effect.callback<void>((resume) => {
    server.close((error) => resume(error === undefined ? Effect.void : Effect.die(error)));
  });

const releaser = (server: Server) => (): Promise<void> => Effect.runPromise(closeServer(server));

export const acquireProcessLock = Effect.fn(function* (name: string) {
  const address = yield* lockAddress(name);
  const server = createServer((socket) => socket.end());
  yield* bind(server, address, name);
  return server;
});

export const processLock = (name: string): Promise<() => Promise<void>> =>
  Effect.runPromise(acquireProcessLock(name)).then(releaser);
