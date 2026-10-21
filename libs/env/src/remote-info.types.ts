import type remoteErrorTypes from "./remote-error.types.ts";

declare namespace remoteInfoTypes {
  interface RemoteInfo {
    protocol: number;
    version: string;
    os: string;
    arch: string;
    home: string;
    tmpdir: string;
    separator: string;
    cwd: string;
    driveCwds: Record<string, string>;
    pid: number;
    features?: string[];
  }

  interface ConnectionOptions {
    command: readonly string[] | (() => Promise<readonly string[]>);
    onLog?: (text: string) => void;
  }

  interface RequestOptions {
    payload?: Uint8Array;
    signal?: AbortSignal;
    onEvent?: (json: remoteErrorTypes.Json, payload: Uint8Array) => void;
    onStart?: (id: number, session: number) => void;
    session?: number;
  }
}

export type { remoteInfoTypes as default };
