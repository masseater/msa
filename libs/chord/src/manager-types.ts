import type { IpcLink } from "./link.ts";

export type ControlMessage =
  | { readonly type: "init"; readonly value: unknown }
  | { readonly type: "ready" }
  | { readonly type: "fatal"; readonly message: string; readonly reason?: string }
  | { readonly type: "shutdown" }
  | {
      readonly type: "status";
      readonly activeCalls?: number;
      readonly viewers?: number;
      readonly durableTasks?: number;
    };

export interface Liveness {
  readonly booting: boolean;
  readonly activeCalls: number;
  readonly viewers: number;
  readonly durableTasks: number;
  readonly idleFor: number;
}

export interface Exit {
  readonly code: number | null;
  readonly signal: string | null;
}

export interface Instance {
  readonly pid: number;
  readonly link: IpcLink;
  readonly exited: Promise<Exit>;
  send(message: ControlMessage): void;
  killTree(): void;
  onControl(listener: (message: ControlMessage) => void): void;
}

export interface Driver {
  spawn(): Promise<Instance>;
}

export interface ForkDriverOptions {
  readonly entry: string;
  readonly args?: readonly string[];
  readonly env?: Readonly<Record<string, string>>;
  readonly execArgv?: readonly string[];
  readonly init?: unknown;
  readonly lock?: string | undefined;
  readonly onOutput?: (stream: "stdout" | "stderr", chunk: Uint8Array) => void;
  readonly onMessage?: (message: unknown) => void;
}

export interface HostManagerOptions {
  readonly driver: Driver;
  readonly keepAlive?: (liveness: Liveness) => boolean;
  readonly checkInterval?: number;
  readonly grace?: number;
  readonly readyTimeout?: number;
  readonly onExit?: (exit: Exit) => void;
}

export interface HostManager {
  readonly status: "stopped" | "starting" | "running" | "stopping";
  readonly instance: Instance | undefined;
  readonly liveness: Liveness;
  start(): Promise<Instance>;
  stop(): Promise<void>;
  replace(): Promise<Instance>;
}

export const LOCK_ENV = "CHORD2_LOCK";

export const CHANNEL_FDS = { toChild: 3, toParent: 4 } as const;

export const ignoreSendError = (): void => {};

export const controlOf = (message: unknown): ControlMessage | undefined =>
  (message as { chord2control?: ControlMessage } | null)?.chord2control;
