import type harnessTypes from "./harness.types.ts";

const harnesses: harnessTypes.Harness[] = [];

const tempDirs: string[] = [];

const agentSessionPromptSupport = {
  harnesses,
  tempDirs,
};

export default agentSessionPromptSupport;
