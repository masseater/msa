import { describe, expect, it } from "vite-plus/test";

import SessionManager from "../../../src/core/session-manager.ts";
import type sessionManagerTypes from "../../../src/core/session-manager.types.ts";
import utilities from "../../utilities.ts";
const { userMsg } = utilities;

const preservesCompactionContextWhenAFork = () => {
  const session = SessionManager.inMemory();
  const oldId = session.appendMessage(userMsg("old"));

  const labelId = session.appendLabelChange(oldId, "checkpoint");
  const keptId = session.appendMessage(userMsg("kept"));
  const compactionId = session.appendCompaction("summary", labelId, 100);
  const leafId = session.appendMessage(userMsg("after"));

  session.createBranchedSession(leafId);

  expect(
    (session.getEntry(compactionId) as sessionManagerTypes.CompactionEntry).firstKeptEntryId,
  ).toBe(keptId);
  expect(session.buildSessionContext().messages).toMatchObject([
    { role: "compactionSummary", summary: "summary" },
    { content: "kept", role: "user" },
    { content: "after", role: "user" },
  ]);
};

describe("regression #8989", () => {
  it(
    "preserves compaction context when a fork removes the boundary label",
    preservesCompactionContextWhenAFork,
  );
});
