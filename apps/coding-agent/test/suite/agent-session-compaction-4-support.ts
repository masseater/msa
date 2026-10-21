import { vi } from "vite-plus/test";

import agentSessionCompactionSupport from "./agent-session-compaction-support.ts";

const { harnesses } = agentSessionCompactionSupport;

const afterEachHook4 = () => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  while (harnesses.length > 0) {
    harnesses.pop()?.cleanup();
  }
};

const agentSessionCompaction4Support = {
  afterEachHook4,
};

export default agentSessionCompaction4Support;
