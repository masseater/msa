import type DoomEngineClass from "./doom-engine.ts";

declare namespace doomEngineTypes {
  interface DoomModule {
    _doomgeneric_Create: (argc: number, argv: number) => void;
    _doomgeneric_Tick: () => void;
    _DG_GetFrameBuffer: () => number;
    _DG_GetScreenWidth: () => number;
    _DG_GetScreenHeight: () => number;
    _DG_PushKeyEvent: (pressed: number, key: number) => void;
    _malloc: (size: number) => number;
    _free: (ptr: number) => void;
    HEAPU8: Uint8Array;
    HEAPU32: Uint32Array;
    FS_createDataFile: (
      parent: string,
      name: string,
      data: number[],
      canRead: boolean,
      canWrite: boolean,
    ) => void;
    FS_createPath: (parent: string, path: string, canRead: boolean, canWrite: boolean) => string;
    setValue: (ptr: number, value: number, type: string) => void;
    getValue: (ptr: number, type: string) => number;
  }

  type DoomEngine = (typeof DoomEngineClass)["prototype"];
}

export type { doomEngineTypes as default };
