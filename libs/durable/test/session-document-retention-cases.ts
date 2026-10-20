import { defineDoc } from "@msa/durable";

import type sessionDocumentRetentionSupportTypes from "./session-document-retention-support.types.ts";

const SessionCounterDoc = defineDoc<sessionDocumentRetentionSupportTypes.Counter>({
  initial: () => ({ count: 0 }),
  kind: "test.retention.session-counter",
  scope: "session",
  version: 1,
});

export default SessionCounterDoc;
