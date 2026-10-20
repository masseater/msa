import sessionManagerSupportPart1 from "./session-manager-support-part1.ts";
import sessionManagerSupportPart2 from "./session-manager-support-part2.ts";
import sessionManagerSupportPart3 from "./session-manager-support-part3.ts";

const {
  CURRENT_SESSION_VERSION,
  assertValidSessionId,
  buildContextEntries,
  generateId,
  getLatestCompactionEntry,
  migrateSessionEntries,
  migrateToCurrentVersion,
  parseSessionEntries,
  sessionEntryToContextMessages,
} = sessionManagerSupportPart1;
const {
  buildSessionContext,
  buildSessionProjection,
  getDefaultSessionDir,
  getDefaultSessionDirPath,
  loadEntriesFromFile,
  parseSessionEntryLine,
} = sessionManagerSupportPart2;
const {
  findMostRecentSession,
  getSessionHeaderCwd,
  readSessionHeader,
  readSessionHeaderForDiscovery,
  sessionCwdMatches,
} = sessionManagerSupportPart3;

const sessionManagerSupport = {
  CURRENT_SESSION_VERSION,
  assertValidSessionId,
  buildContextEntries,
  buildSessionContext,
  buildSessionProjection,
  findMostRecentSession,
  generateId,
  getDefaultSessionDir,
  getDefaultSessionDirPath,
  getLatestCompactionEntry,
  getSessionHeaderCwd,
  loadEntriesFromFile,
  migrateSessionEntries,
  migrateToCurrentVersion,
  parseSessionEntries,
  parseSessionEntryLine,
  readSessionHeader,
  readSessionHeaderForDiscovery,
  sessionCwdMatches,
  sessionEntryToContextMessages,
};

export default sessionManagerSupport;
