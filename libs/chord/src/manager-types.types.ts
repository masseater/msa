import type linkTypes from "./link.types.ts";

declare namespace managerTypesModule {
  type ControlMessage =
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

  interface Liveness {
    readonly booting: boolean;
    readonly activeCalls: number;
    readonly viewers: number;
    readonly durableTasks: number;
    readonly idleFor: number;
  }

  interface Exit {
    readonly code: number | null;
    readonly signal: string | null;
  }

  interface Instance {
    readonly pid: number;
    readonly link: linkTypes.IpcLink;
    readonly exited: Promise<Exit>;
    send(message: ControlMessage): void;
    killTree(): void;
    onControl(listener: (message: ControlMessage) => void): void;
  }

  interface Driver {
    spawn(): Promise<Instance>;
  }

  interface ForkDriverOptions {
    readonly entry: string;
    readonly args?: readonly string[];
    readonly env?: Readonly<Record<string, string>>;
    readonly execArgv?: readonly string[];
    readonly init?: unknown;
    readonly lock?: string | undefined;
    readonly onOutput?: (stream: "stdout" | "stderr", chunk: Uint8Array) => void;
    readonly onMessage?: (message: unknown) => void;
  }

  interface HostManagerOptions {
    readonly driver: Driver;
    readonly keepAlive?: (liveness: Liveness) => boolean;
    readonly checkInterval?: number;
    readonly grace?: number;
    readonly readyTimeout?: number;
    readonly onExit?: (exit: Exit) => void;
  }

  interface HostManager {
    readonly status: "stopped" | "starting" | "running" | "stopping";
    readonly instance: Instance | undefined;
    readonly liveness: Liveness;
    start(): Promise<Instance>;
    stop(): Promise<void>;
    replace(): Promise<Instance>;
  }
}

export type { managerTypesModule as default };
