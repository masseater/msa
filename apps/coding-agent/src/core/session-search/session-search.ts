import sqliteFile from "../platform/node/sqlite-file.ts";
import type DatabaseSync from "../platform/node/sqlite.ts";
import entryRead from "./entry-read.ts";
import indexStore from "./index-store.ts";
import indexer from "./indexer.ts";
import reading from "./reading.ts";
import search from "./search.ts";
import type sessionSearchTypes from "./session-search.types.ts";
import threadLinksModule from "./thread-links.ts";

const { readEntry } = entryRead;

type Locations = sessionSearchTypes.Locations;

const READ_BUDGET = 50_000;

const connections = new Map<string, DatabaseSync>();
const updates = new Map<string, Promise<sessionSearchTypes.IndexUpdate>>();

const causeOf = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

function openOrReplace(indexPath: string): DatabaseSync {
  try {
    return indexStore.openIndex(indexPath);
  } catch (failure) {
    try {
      sqliteFile.removeSqliteFile(indexPath);
      return indexStore.openIndex(indexPath);
    } catch (error) {
      throw new Error(
        `The session index ${indexPath} could not be opened (${causeOf(failure)}) or replaced (${causeOf(error)})`,
        { cause: error },
      );
    }
  }
}

function connection(indexPath: string): DatabaseSync {
  const existing = connections.get(indexPath);
  if (existing !== undefined) return existing;
  const opened = openOrReplace(indexPath);
  connections.set(indexPath, opened);
  return opened;
}

const SQLITE_BUSY = 5;
const SQLITE_LOCKED = 6;

const isLockWait = (error: unknown): boolean => {
  if (typeof error !== "object" || error === null || !("errcode" in error)) return false;
  const code = typeof error.errcode === "number" ? error.errcode & 0xff : -1;
  return code === SQLITE_BUSY || code === SQLITE_LOCKED;
};

function rebuild(
  database: DatabaseSync,
  locations: Locations,
  failure: unknown,
): Promise<sessionSearchTypes.IndexUpdate> {
  if (isLockWait(failure)) {
    return Promise.reject(
      new Error(
        `The session index ${locations.indexPath} stayed locked by another process (${causeOf(failure)}); search again once it finishes`,
        { cause: failure },
      ),
    );
  }
  return Promise.resolve()
    .then(() => {
      indexStore.resetIndex(database);
      return indexer.updateIndex(database, locations.roots);
    })
    .catch((error: unknown) => {
      throw new Error(
        `The session index ${locations.indexPath} could not be updated (${causeOf(failure)}) or rebuilt (${causeOf(error)})`,
        { cause: error },
      );
    });
}

function refresh(locations: Locations): Promise<sessionSearchTypes.IndexUpdate> {
  const previous = updates.get(locations.indexPath) ?? Promise.resolve(undefined);
  const next = previous
    .catch(() => undefined)
    .then(() => {
      const database = connection(locations.indexPath);
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
