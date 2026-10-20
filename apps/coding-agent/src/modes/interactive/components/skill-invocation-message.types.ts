import type SkillInvocationMessageComponentClass from "./skill-invocation-message.ts";

declare namespace skillInvocationMessageTypes {
  type SkillInvocationMessageComponent = (typeof SkillInvocationMessageComponentClass)["prototype"];
}

export type { skillInvocationMessageTypes as default };
