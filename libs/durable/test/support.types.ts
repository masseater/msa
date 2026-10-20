import type chatSupportTypes from "./chat-support.types.ts";
import type harnessSupportTypes from "./harness-support.types.ts";
import type platformSupportTypes from "./platform-support.types.ts";
import type sessionSupportTypes from "./session-support.types.ts";
import type taskSupportTypes from "./task-support.types.ts";

declare namespace supportTypes {
  type ChatSetup = chatSupportTypes.ChatSetup;

  type Check = chatSupportTypes.Check;

  type Installed = harnessSupportTypes.Installed;

  type TempFile = platformSupportTypes.TempFile;

  type CommandResult = platformSupportTypes.CommandResult;

  type CommandOptions = platformSupportTypes.CommandOptions;

  type Gate = sessionSupportTypes.Gate;

  type ControlledStorage = sessionSupportTypes.ControlledStorage;

  type Deferred<T = void> = taskSupportTypes.Deferred<T>;
}

export type { supportTypes as default };
