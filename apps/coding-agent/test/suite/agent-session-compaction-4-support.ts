import { vi } from "vite-plus/test";

import closeAgentSessionModule from "../close-agent-session.ts";
import agentSessionCompactionSupport from "./agent-session-compaction-support.ts";

const { cleanupAll } = closeAgentSessionModule;

const { harnesses } = agentSessionCompactionSupport;

const afterEachHook4 = () => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  return cleanupAll(harnesses);
};

const agentSessionCompaction4Support = {
  afterEachHook4,
};

export default agentSessionCompaction4Support;
