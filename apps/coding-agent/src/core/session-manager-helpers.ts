import sessionManagerHelpersPart1 from "./session-manager-helpers-part1.ts";
import sessionManagerHelpersPart2 from "./session-manager-helpers-part2.ts";
import sessionManagerHelpersPart3 from "./session-manager-helpers-part3.ts";

const {
  ALL_SESSION_LIST_PUBLISH_INTERVAL,
  CURRENT_SESSION_LIST_PUBLISH_INTERVAL,
  MAX_CONCURRENT_SESSION_DISCOVERY_LOADS,
  MAX_CONCURRENT_SESSION_INFO_LOADS,
  buildSessionInfo,
  buildSessionInfosWithConcurrency,
  mapWithConcurrency,
  sortSessionInfos,
} = sessionManagerHelpersPart2;
const {
  buildSessionInfoPart1,
  buildSessionInfoPart2,
  createSessionId,
  extractTextContent,
  getMessageActivityTime,
  isMessageWithContent,
} = sessionManagerHelpersPart1;
const { listSessionsFromDir } = sessionManagerHelpersPart3;

const sessionManagerHelpers = {
  ALL_SESSION_LIST_PUBLISH_INTERVAL,
  CURRENT_SESSION_LIST_PUBLISH_INTERVAL,
  MAX_CONCURRENT_SESSION_DISCOVERY_LOADS,
  MAX_CONCURRENT_SESSION_INFO_LOADS,
  buildSessionInfo,
  buildSessionInfoPart1,
  buildSessionInfoPart2,
  buildSessionInfosWithConcurrency,
  createSessionId,
  extractTextContent,
  getMessageActivityTime,
  isMessageWithContent,
  listSessionsFromDir,
  mapWithConcurrency,
  sortSessionInfos,
};

export default sessionManagerHelpers;
