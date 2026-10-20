import type managerTypesModule from "./manager-types.types.ts";

const LOCK_ENV = "CHORD2_LOCK";

const CHANNEL_FDS = { toChild: 3, toParent: 4 } as const;

const ignoreSendError = (): void => {};

const controlOf = (message: unknown): managerTypesModule.ControlMessage | undefined =>
  (message as { chord2control?: managerTypesModule.ControlMessage } | null)?.chord2control;

const managerTypes = {
  CHANNEL_FDS,
  LOCK_ENV,
  controlOf,
  ignoreSendError,
};

export default managerTypes;
