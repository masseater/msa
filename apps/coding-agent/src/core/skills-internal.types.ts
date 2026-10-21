import type ignore from "ignore";

declare namespace skillsInternalTypes {
  type IgnoreMatcher = ReturnType<typeof ignore>;
}

export type { skillsInternalTypes as default };
