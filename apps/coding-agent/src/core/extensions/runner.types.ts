import type ExtensionRunnerClass from "./extension-runner.ts";
import type runnerTypesTypes from "./runner-types.ts";

declare namespace runnerTypes {
  type ExtensionRunner = (typeof ExtensionRunnerClass)["prototype"];

  type BeforeAgentStartTrigger = runnerTypesTypes.BeforeAgentStartTrigger;

  type ExtensionErrorListener = runnerTypesTypes.ExtensionErrorListener;

  type ForkHandler = runnerTypesTypes.ForkHandler;

  type NavigateTreeHandler = runnerTypesTypes.NavigateTreeHandler;

  type NewSessionHandler = runnerTypesTypes.NewSessionHandler;

  type ReloadHandler = runnerTypesTypes.ReloadHandler;

  type ShutdownHandler = runnerTypesTypes.ShutdownHandler;

  type SwitchSessionHandler = runnerTypesTypes.SwitchSessionHandler;
}

export type { runnerTypes as default };
