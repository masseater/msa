import type DatabaseSync from "../platform/node/sqlite.ts";
import platformRuntime from "../platform/runtime.ts";
import entryRead from "./entry-read.ts";
import indexGenerations from "./index-generations.ts";
import indexStore from "./index-store.ts";
import reading from "./reading.ts";
import search from "./search.ts";
import type sessionSearchTypes from "./session-search.types.ts";
import threadLinksModule from "./thread-links.ts";

const { readEntry } = entryRead;
const { whileLocked } = indexStore;

type Locations = sessionSearchTypes.Locations;
type Refreshed = Awaited<ReturnType<typeof indexGenerations.refresh>>;

const READ_BUDGET = 50_000;

const updates = new Map<string, Promise<Refreshed>>();
const generations: Parameters<typeof indexGenerations.refresh>[0] = new Map();

function queued(locations: Locations, run: () => Promise<Refreshed>): Promise<Refreshed> {
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

function withIndex<A>(locations: Locations, body: (database: DatabaseSync) => A): Promise<A> {
  return refreshed(locations).then(({ generation }) =>
    reads(generation.path, () => body(generation.database)).catch((reason: unknown) =>
      queued(locations, () => indexGenerations.replace(generations, locations, reason)).then(
        ({ generation: next }) => reads(next.path, () => body(next.database)),
      ),
    ),
  );
}

function searchSessions(
  locations: Locations,
  request: sessionSearchTypes.SearchRequest,
): Promise<sessionSearchTypes.SearchResult> {
  const links = threadLinksModule.threadLinks(locations.orchestratorDatabase);
  return withIndex(locations, (database) => ({
    located: search.locate(database, links, request),
    skipped: indexStore.skippedFiles(database),
  })).then(({ located, skipped }) =>
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
  return withIndex(locations, (database) => reading.entryWindow(database, request)).then(
    (window) => {
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
    },
  );
}

const sessionSearch = { readSession, refresh, searchSessions };

export default sessionSearch;
