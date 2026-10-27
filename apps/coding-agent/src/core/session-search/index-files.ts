import { Clock, Duration, Effect, FileSystem, Predicate, Schedule } from "effect";

import platform from "../platform/index.ts";
import processAliveModule from "../platform/node/process-alive.ts";
import platformRuntime from "../platform/runtime.ts";

const { join } = platform;
const { currentPid, processAlive } = processAliveModule;

const POINTER = "current";
const LOCK = "build.lock";
const SQLITE_SUFFIXES = ["", "-wal", "-shm"];
const LOCK_POLL = Schedule.spaced(Duration.millis(100));
const UNREADABLE_POLLS = 50;

const versionDirectory = (indexDirectory: string, version: number): string =>
  join(indexDirectory, `v${version}`);

const generationPath = (directory: string, name: string): string => join(directory, name);

const staged = (directory: string): string => join(directory, `${POINTER}.${currentPid()}.tmp`);

const newGenerationName = Clock.currentTimeMillis.pipe(
  Effect.map((now) => `${String(now).padStart(15, "0")}-${currentPid()}.db`),
);

const makeDirectory = (directory: string) =>
  FileSystem.FileSystem.use((fileSystem) =>
    fileSystem.makeDirectory(directory, { mode: 0o700, recursive: true }),
  );

const readPointer = (directory: string) =>
  FileSystem.FileSystem.use((fileSystem) =>
    fileSystem.readFileString(join(directory, POINTER)).pipe(
      Effect.map((text): string | undefined => text.trim() || undefined),
      Effect.orElseSucceed((): string | undefined => undefined),
    ),
  );

const switchPointer = (directory: string, name: string) =>
  FileSystem.FileSystem.use(
    Effect.fnUntraced(function* (fileSystem) {
      const next = staged(directory);
      yield* fileSystem.writeFileString(next, `${name}\n`, { mode: 0o600 });
      yield* fileSystem.rename(next, join(directory, POINTER));
    }),
  );

const lockHolder = (fileSystem: FileSystem.FileSystem, lock: string) =>
  fileSystem.readFileString(lock).pipe(
    Effect.map((text) => Number.parseInt(text.trim(), 10)),
    Effect.orElseSucceed(() => Number.NaN),
  );

const holderGone = (pid: number): boolean => !Number.isNaN(pid) && !processAlive(pid);

const tryLock = (directory: string) =>
  FileSystem.FileSystem.use((fileSystem) =>
    fileSystem
      .writeFileString(join(directory, LOCK), `${currentPid()}\n`, { flag: "wx", mode: 0o600 })
      .pipe(
        Effect.as(true),
        Effect.catchIf(
          (error) => Predicate.isTagged(error.reason, "AlreadyExists"),
          () => Effect.succeed(false),
        ),
      ),
  );

const waitForLock = (directory: string) =>
  FileSystem.FileSystem.use((fileSystem) => {
    const lock = join(directory, LOCK);
    let unreadable = 0;
    return Effect.gen(function* () {
      if (!(yield* fileSystem.exists(lock).pipe(Effect.orElseSucceed(() => false)))) return true;
      const holder = yield* lockHolder(fileSystem, lock);
      unreadable = Number.isNaN(holder) ? unreadable + 1 : 0;
      if (!holderGone(holder) && unreadable < UNREADABLE_POLLS) return false;
      yield* fileSystem.remove(lock, { force: true }).pipe(Effect.ignore);
      return true;
    }).pipe(Effect.repeat({ schedule: LOCK_POLL, until: (released) => released }));
  });

const releaseLock = (directory: string) =>
  FileSystem.FileSystem.use(
    Effect.fnUntraced(function* (fileSystem) {
      const lock = join(directory, LOCK);
      if ((yield* lockHolder(fileSystem, lock)) === currentPid()) {
        yield* fileSystem.remove(lock, { force: true });
      }
    }),
  ).pipe(Effect.ignore);

const generationFiles = (name: string): string[] =>
  SQLITE_SUFFIXES.map((suffix) => `${name}${suffix}`);

const removeOtherGenerations = (directory: string, kept: string) =>
  FileSystem.FileSystem.use(
    Effect.fnUntraced(function* (fileSystem) {
      const keep = new Set([POINTER, LOCK, ...generationFiles(kept)]);
      const names = yield* fileSystem
        .readDirectory(directory)
        .pipe(Effect.orElseSucceed((): readonly string[] => []));
      const others = names.filter((name) => !keep.has(name));
      yield* Effect.forEach(
        others,
        (name) => fileSystem.remove(join(directory, name), { force: true }).pipe(Effect.ignore),
        { discard: true },
      );
    }),
  );

const removeGeneration = (directory: string, name: string) =>
  FileSystem.FileSystem.use((fileSystem) =>
    Effect.forEach(
      generationFiles(name),
      (file) => fileSystem.remove(join(directory, file), { force: true }).pipe(Effect.ignore),
      { discard: true },
    ),
  );

const run = <A, E>(effect: Effect.Effect<A, E, FileSystem.FileSystem>): Promise<A> =>
  platformRuntime.runPromise(effect);

const indexFiles = {
  generationPath,
  makeDirectory: (directory: string) => run(makeDirectory(directory)),
  newGenerationName: () => run(newGenerationName),
  readPointer: (directory: string) => run(readPointer(directory)),
  releaseLock: (directory: string) => run(releaseLock(directory)),
  removeGeneration: (directory: string, name: string) => run(removeGeneration(directory, name)),
  removeOtherGenerations: (directory: string, kept: string) =>
    run(removeOtherGenerations(directory, kept)),
  switchPointer: (directory: string, name: string) => run(switchPointer(directory, name)),
  tryLock: (directory: string) => run(tryLock(directory)),
  versionDirectory,
  waitForLock: (directory: string) => run(waitForLock(directory)),
};

export default indexFiles;
