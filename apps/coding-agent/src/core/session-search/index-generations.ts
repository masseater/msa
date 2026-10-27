import { Cause, Effect, Exit, Schema } from "effect";

import ForeignError from "../platform/foreign-error.ts";
import type DatabaseSync from "../platform/node/sqlite.ts";
import platformRuntime from "../platform/runtime.ts";
import indexFiles from "./index-files.ts";
import IndexLocked from "./index-locked.ts";
import indexOpen from "./index-open.ts";
import indexStore from "./index-store.ts";
import indexer from "./indexer.ts";
import type sessionSearchTypes from "./session-search.types.ts";

const { causeOf, foreign } = indexOpen;
const { whileLocked } = indexStore;

type Locations = sessionSearchTypes.Locations;
type IndexUpdate = sessionSearchTypes.IndexUpdate;

interface Generation {
  readonly name: string;
  readonly path: string;
  readonly database: DatabaseSync;
}

interface Refreshed {
  readonly generation: Generation;
  readonly update: IndexUpdate;
}

interface Current {
  readonly generation: Generation;
  readonly update: IndexUpdate | undefined;
}

type Opened = Map<string, Generation>;

const directoryOf = (locations: Locations): string =>
  indexFiles.versionDirectory(locations.indexDirectory, indexStore.SCHEMA_VERSION);

const promised = <A>(run: () => Promise<A>) =>
  Effect.tryPromise({
    catch: (cause) =>
      Schema.is(IndexLocked)(cause) ? cause : ForeignError.make({ cause, message: causeOf(cause) }),
    try: run,
  });

function adopt(opened: Opened, directory: string, next: Generation): Generation {
  const previous = opened.get(directory);
  opened.set(directory, next);
  if (previous !== undefined && previous.database !== next.database) previous.database.close();
  return next;
}

const openCurrent = (path: string) =>
  whileLocked(path, () => indexStore.openCurrent(path)).pipe(
    Effect.orElseSucceed((): DatabaseSync | undefined => undefined),
  );

const buildGeneration = Effect.fnUntraced(function* (
  opened: Opened,
  locations: Locations,
  directory: string,
) {
  const name = yield* promised(() => indexFiles.newGenerationName());
  const path = indexFiles.generationPath(directory, name);
  const database = yield* foreign(() => indexStore.openIndex(path));
  const built = yield* Effect.exit(
    foreign(() => indexStore.createSchema(database)).pipe(
      Effect.andThen(promised(() => indexer.updateIndex(database, locations.roots, path))),
    ),
  );
  if (Exit.isFailure(built)) {
    database.close();
    yield* promised(() => indexFiles.removeGeneration(directory, name));
    return yield* Effect.failCause(built.cause);
  }
  yield* promised(() => indexFiles.switchPointer(directory, name));
  const generation = adopt(opened, directory, { database, name, path });
  yield* promised(() => indexFiles.removeOtherGenerations(directory, name));
  const done: Refreshed = { generation, update: built.value };
  return done;
});

const buildLocked = (opened: Opened, locations: Locations, directory: string) =>
  buildGeneration(opened, locations, directory).pipe(
    Effect.ensuring(promised(() => indexFiles.releaseLock(directory)).pipe(Effect.ignore)),
  );

const build = Effect.fnUntraced(function* (
  opened: Opened,
  locations: Locations,
  directory: string,
) {
  if (!(yield* promised(() => indexFiles.tryLock(directory)))) {
    yield* promised(() => indexFiles.waitForLock(directory));
    return undefined;
  }
  return yield* buildLocked(opened, locations, directory);
});

const current = Effect.fnUntraced(function* (
  opened: Opened,
  locations: Locations,
  directory: string,
) {
  for (;;) {
    const name = yield* promised(() => indexFiles.readPointer(directory));
    const open = opened.get(directory);
    if (name !== undefined && open?.name === name) {
      const same: Current = { generation: open, update: undefined };
      return same;
    }
    if (name !== undefined) {
      const path = indexFiles.generationPath(directory, name);
      const database = yield* openCurrent(path);
      if (database !== undefined) {
        const adopted: Current = {
          generation: adopt(opened, directory, { database, name, path }),
          update: undefined,
        };
        return adopted;
      }
    }
    if (yield* promised(() => indexFiles.tryLock(directory))) {
      return yield* buildLocked(opened, locations, directory);
    }
    if (open !== undefined) {
      const previous: Current = { generation: open, update: undefined };
      return previous;
    }
    yield* promised(() => indexFiles.waitForLock(directory));
  }
});

const failure = (message: string, cause: unknown): ForeignError =>
  ForeignError.make({ cause, message });

const rebuilt = Effect.fnUntraced(function* (
  opened: Opened,
  locations: Locations,
  directory: string,
) {
  const built = yield* build(opened, locations, directory);
  if (built !== undefined) return built;
  const next = yield* current(opened, locations, directory);
  if (next.update !== undefined) return { generation: next.generation, update: next.update };
  const { database, path } = next.generation;
  const update = yield* promised(() => indexer.updateIndex(database, locations.roots, path));
  const caughtUp: Refreshed = { generation: next.generation, update };
  return caughtUp;
});

const updated = Effect.fnUntraced(function* (
  opened: Opened,
  locations: Locations,
  directory: string,
) {
  const found = yield* current(opened, locations, directory).pipe(
    Effect.mapError((cause) =>
      failure(
        `The session index ${locations.indexDirectory} could not be built (${causeOf(cause)})`,
        cause,
      ),
    ),
  );
  if (found.update !== undefined) return { generation: found.generation, update: found.update };
  const { database, path } = found.generation;
  const result = yield* Effect.exit(
    promised(() => indexer.updateIndex(database, locations.roots, path)),
  );
  if (Exit.isSuccess(result)) {
    const caughtUp: Refreshed = { generation: found.generation, update: result.value };
    return caughtUp;
  }
  const reason = Cause.squash(result.cause);
  return yield* rebuilt(opened, locations, directory).pipe(
    Effect.mapError((cause) =>
      failure(
        `The session index ${locations.indexDirectory} could not be updated (${causeOf(reason)}) or rebuilt (${causeOf(cause)})`,
        cause,
      ),
    ),
  );
});

const refreshed = Effect.fnUntraced(function* (opened: Opened, locations: Locations) {
  const directory = directoryOf(locations);
  yield* promised(() => indexFiles.makeDirectory(directory)).pipe(
    Effect.mapError((cause) =>
      ForeignError.make({
        cause,
        message: `The session index ${locations.indexDirectory} could not be opened (${causeOf(cause)})`,
      }),
    ),
  );
  return yield* updated(opened, locations, directory);
});

const refresh = (opened: Opened, locations: Locations): Promise<Refreshed> =>
  platformRuntime.runPromise(refreshed(opened, locations));

const replace = (opened: Opened, locations: Locations, reason: unknown): Promise<Refreshed> =>
  platformRuntime.runPromise(
    rebuilt(opened, locations, directoryOf(locations)).pipe(
      Effect.mapError((cause) =>
        failure(
          `The session index ${locations.indexDirectory} could not be read (${causeOf(reason)}) or rebuilt (${causeOf(cause)})`,
          cause,
        ),
      ),
    ),
  );

const indexGenerations = { directoryOf, refresh, replace };

export default indexGenerations;
