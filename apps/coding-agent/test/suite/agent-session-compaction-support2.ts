import { vi } from "vite-plus/test";

import agentSessionCompactionSupport from "./agent-session-compaction-support.ts";

const { harnesses } = agentSessionCompactionSupport;

const afterEachHook = () => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  while (harnesses.length > 0) {
    harnesses.pop()?.cleanup();
  }
};

const agentSessionCompactionSupport2 = {
  afterEachHook,
};

export default agentSessionCompactionSupport2;
