import type { ToolResultMessage } from "@msa/ai/compat";
import { describe, expect, it } from "vite-plus/test";

import {
  computeFileLists,
  createFileOps,
  extractFileOpsFromMessage,
} from "../src/core/compaction/utils.ts";

const includeFilesTouchedByNestedCallsRecorded = () => {
  const result: ToolResultMessage = {
    content: [],
    isError: false,
    nestedCalls: {
      calls: [
        { arguments: { path: "a.ts" }, id: "codemode-1/1", name: "read", status: "ok" },
        {
          arguments: { edits: [], path: "b.ts" },
          id: "codemode-1/2",
          name: "edit",
          status: "ok",
        },
        { argumentsBytes: 40000, id: "codemode-1/3", name: "write", status: "ok" },
      ],
      complete: false,
    },
    role: "toolResult",
    timestamp: 0,
    toolCallId: "codemode-1",
    toolName: "codemode",
  };
  const fileOps = createFileOps();
  extractFileOpsFromMessage(result, fileOps);
  expect(computeFileLists(fileOps)).toEqual({ modifiedFiles: ["b.ts"], readFiles: ["a.ts"] });
};

describe("compaction file operations", () => {
  it(
    "include files touched by nested calls recorded on tool results",
    includeFilesTouchedByNestedCallsRecorded,
  );
});
