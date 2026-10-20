import { vi } from "vite-plus/test";

import agentSessionCompactionSupport from "./agent-session-compaction-support.ts";

const { harnesses } = agentSessionCompactionSupport;

const afterEachHook5 = () => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  while (harnesses.length > 0) {
    harnesses.pop()?.cleanup();
  }
};

const agentSessionCompaction5Support = {
  afterEachHook5,
};

export default agentSessionCompaction5Support;
