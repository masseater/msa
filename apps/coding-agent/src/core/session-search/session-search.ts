import type DatabaseSync from "../platform/node/sqlite.ts";
import platformRuntime from "../platform/runtime.ts";
import entryRead from "./entry-read.ts";
import indexGenerations from "./index-generations.ts";
import indexStore from "./index-store.ts";
import indexer from "./indexer.ts";
import reading from "./reading.ts";
import search from "./search.ts";
import type sessionSearchTypes from "./session-search.types.ts";
import threadLinksModule from "./thread-links.ts";

const { readEntry } = entryRead;
const { whileLocked } = indexStore;

type Locations = sessionSearchTypes.Locations;
type Refreshed = Awaited<ReturnType<typeof indexGenerations.refresh>>;

const READ_BUDGET = 50_000;

const updates = new Map<string, Promise<unknown>>();
const generations: Parameters<typeof indexGenerations.refresh>[0] = new Map();

function queued<A>(locations: Locations, run: () => Promise<A>): Promise<A> {
  const directory = indexGenerations.directoryOf(locations);
  const previous = updates.get(directory) ?? Promise.resolve(undefined);
  const next = previous.catch(() => undefined).then(run);
  updates.set(directory, next);
  return next;
}

const refreshed = (locations: Locations): Promise<Refreshed> =>
  queued(locations, () => indexGenerations.refresh(generations, locations));

const refresh = (locations: Locations): Promise<sessionSearchTypes.IndexUpdate> =>
  refreshed(locations).then(({ update }) => update);

const reads = <A>(path: string, body: () => A): Promise<A> =>
  platformRuntime.runPromise(whileLocked(path, body));

type Generation = Refreshed["generation"];

function withGeneration<A>(
  locations: Locations,
  body: (database: DatabaseSync) => A,
): Promise<{ generation: Generation; value: A }> {
  return refreshed(locations).then(({ generation }) =>
    reads(generation.path, () => body(generation.database)).then(
      (value) => ({ generation, value }),
      (reason: unknown) =>
        queued(locations, () => indexGenerations.replace(generations, locations, reason)).then(
          ({ generation: next }) =>
            reads(next.path, () => body(next.database)).then((value) => ({
              generation: next,
              value,
            })),
        ),
    ),
  );
}

const MAX_RECHECKS = 3;

function checked<A>(
  locations: Locations,
  body: (database: DatabaseSync) => A,
  pathsOf: (value: A) => readonly string[],
): Promise<A> {
  const recheck = (generation: Generation, value: A, left: number): Promise<A> => {
    const paths = pathsOf(value);
    if (left === 0 || paths.length === 0) return Promise.resolve(value);
    return queued(locations, () =>
      indexer.updatePaths(generation.database, paths, generation.path),
    ).then((changed) => {
      if (changed === 0) return value;
      return reads(generation.path, () => body(generation.database)).then((next) =>
        recheck(generation, next, left - 1),
      );
    });
  };
  return withGeneration(locations, body).then(({ generation, value }) =>
    recheck(generation, value, MAX_RECHECKS),
  );
}

function searchSessions(
  locations: Locations,
  request: sessionSearchTypes.SearchRequest,
): Promise<sessionSearchTypes.SearchResult> {
  const links = threadLinksModule.threadLinks(locations.orchestratorDatabase);
  return checked(
    locations,
    (database) => ({
      located: search.locate(database, links, request),
      skipped: indexStore.skippedFiles(database),
    }),
    ({ located, skipped }) => [
      ...located.map((hit) => hit.session.path),
      ...skipped.map((file) => file.path),
    ],
  ).then(({ located, skipped }) =>
    Promise.all(
      located.map((hit) =>
        readEntry(hit.session.path, hit.offset, hit.length).then((entry) => ({
          at: hit.at,
          entryId: hit.entryId,
          kind: hit.kind,
          part: hit.part,
          session: hit.session,
          snippet: search.snippet(entry.parts[hit.part]?.text ?? "", request.query),
          tool: hit.tool,
        })),
      ),
    ).then((hits) => ({ hits, skipped })),
  );
}

function readSession(
  locations: Locations,
  request: sessionSearchTypes.ReadRequest,
): Promise<sessionSearchTypes.Page | undefined> {
  return checked(
    locations,
    (database) => reading.entryWindow(database, request),
    () => [request.path],
  ).then((window) => {
    if (window === undefined) return undefined;
    return Promise.all(window.map((row) => readEntry(request.path, row.offset, row.length))).then(
      (entries) =>
        reading.render(
          entries.map((entry) => ({
            entryId: entry.entryId,
            text: reading.blockText(
              entry.entryId,
              entry.at,
              entry.parts.filter((part) => part.text.trim() !== ""),
            ),
          })),
          request.from,
          READ_BUDGET,
        ),
    );
  });
}

const sessionSearch = { readSession, refresh, searchSessions };

export default sessionSearch;
