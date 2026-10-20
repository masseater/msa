import type sessionSupport from "./session-support.ts";

declare namespace sessionForksCasesTypes {
  type TestSession = ReturnType<typeof sessionSupport.openTestSession>;
}

export type { sessionForksCasesTypes as default };
