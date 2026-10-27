import type DatabaseSync from "../platform/node/sqlite.ts";
import entryRead from "./entry-read.ts";
import indexOpen from "./index-open.ts";
import indexStore from "./index-store.ts";
import indexer from "./indexer.ts";
import reading from "./reading.ts";
import search from "./search.ts";
import type sessionSearchTypes from "./session-search.types.ts";
import threadLinksModule from "./thread-links.ts";

const { readEntry } = entryRead;
const { isLockWait, lockedError } = indexOpen;

type Locations = sessionSearchTypes.Locations;

const READ_BUDGET = 50_000;

const connections = new Map<string, DatabaseSync>();
const updates = new Map<string, Promise<sessionSearchTypes.IndexUpdate>>();

const { causeOf } = indexOpen;

function openConnection(
  indexPath: string,
): Promise<{ database: DatabaseSync; state: sessionSearchTypes.IndexState }> {
  const existing = connections.get(indexPath);
  if (existing !== undefined) return Promise.resolve({ database: existing, state: "intact" });
  return indexOpen.openIndexWaiting(indexPath).then((database) => {
    const state = indexStore.indexState(database);
    if (state === "newer") {
      database.close();
      throw new Error(`The session index ${indexPath} was written by a newer msa`);
    }
    connections.set(indexPath, database);
    return { database, state };
  });
}

function connection(indexPath: string): DatabaseSync {
  const existing = connections.get(indexPath);
  if (existing === undefined) throw new Error(`The session index ${indexPath} is not open`);
  return existing;
}

function rebuild(
  database: DatabaseSync,
  locations: Locations,
  failure: unknown,
): Promise<sessionSearchTypes.IndexUpdate> {
  if (isLockWait(failure)) return Promise.reject(lockedError(locations.indexPath, failure));
  return indexStore
    .rebuildIndex(database, true, () => indexer.updateIndex(database, locations.roots))
    .catch((error: unknown) => {
      throw new Error(
        `The session index ${locations.indexPath} could not be updated (${causeOf(failure)}) or rebuilt (${causeOf(error)})`,
        { cause: error },
      );
    });
}

function build(
  database: DatabaseSync,
  locations: Locations,
): Promise<sessionSearchTypes.IndexUpdate> {
  return indexStore
    .rebuildIndex(database, false, () => indexer.updateIndex(database, locations.roots))
    .catch((error: unknown) => {
      throw new Error(
        `The session index ${locations.indexPath} could not be built (${causeOf(error)})`,
        { cause: error },
      );
    });
}

function refresh(locations: Locations): Promise<sessionSearchTypes.IndexUpdate> {
  const previous = updates.get(locations.indexPath) ?? Promise.resolve(undefined);
  const next = previous
    .catch(() => undefined)
    .then(() => openConnection(locations.indexPath))
    .then(({ database, state }) => {
      if (state === "stale") return build(database, locations);
      return indexer
        .updateIndex(database, locations.roots)
        .catch((failure: unknown) => rebuild(database, locations, failure));
    });
  updates.set(locations.indexPath, next);
  return next;
}

function searchSessions(
  locations: Locations,
  request: sessionSearchTypes.SearchRequest,
): Promise<sessionSearchTypes.Hit[]> {
  return refresh(locations).then(() => {
    const links = threadLinksModule.threadLinks(locations.orchestratorDatabase);
    const located = search.locate(connection(locations.indexPath), links, request);
    return Promise.all(
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
    );
  });
}

function readSession(
  locations: Locations,
  request: sessionSearchTypes.ReadRequest,
): Promise<sessionSearchTypes.Page | undefined> {
  return refresh(locations).then(() => {
    const window = reading.entryWindow(connection(locations.indexPath), request);
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
