import { vi } from "vite-plus/test";

import closeAgentSessionModule from "../close-agent-session.ts";
import agentSessionCompactionSupport from "./agent-session-compaction-support.ts";

const { cleanupAll } = closeAgentSessionModule;

const { harnesses } = agentSessionCompactionSupport;

const afterEachHook5 = () => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  return cleanupAll(harnesses);
};

const agentSessionCompaction5Support = {
  afterEachHook5,
};

export default agentSessionCompaction5Support;
