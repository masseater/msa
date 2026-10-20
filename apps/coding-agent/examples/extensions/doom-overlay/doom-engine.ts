import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

import { NodeServices } from "@effect/platform-node";
import { Effect, FileSystem, ManagedRuntime, Path } from "effect";

export interface DoomModule {
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

type DoomFactory = (config: unknown) => Promise<DoomModule>;

const runtime = ManagedRuntime.make(NodeServices.layer);
const pathService = runtime.runSync(Path.Path);
const fsService = runtime.runSync(FileSystem.FileSystem);

const loadDoomFactory = (buildDir: string, doomJsPath: string, doomJsCode: string): DoomFactory => {
  const moduleExports: { exports: unknown } = { exports: {} };
  const moduleFunc = new Function(
    "module",
    "exports",
    "__dirname",
    "__filename",
    "require",
    doomJsCode,
  );
  moduleFunc(moduleExports, moduleExports.exports, buildDir, doomJsPath, createRequire(doomJsPath));
  return moduleExports.exports as DoomFactory;
};

const moduleConfig = (buildDir: string, wadArray: number[]) => ({
  locateFile: (path: string) => (path.endsWith(".wasm") ? pathService.join(buildDir, path) : path),
  preRun: [
    (module: DoomModule) => {
      module.FS_createPath("/", "doom", true, true);
      module.FS_createDataFile("/doom", "doom1.wad", wadArray, true, false);
    },
  ],
  print: () => {},
  printErr: () => {},
});

export class DoomEngine {
  private module: DoomModule | null = null;
  private frameBufferPtr = 0;
  private initialized = false;
  private wadPath: string;
  private frameWidth = 640;
  private frameHeight = 400;

  constructor(wadPath: string) {
    this.wadPath = wadPath;
  }

  get width(): number {
    return this.frameWidth;
  }

  get height(): number {
    return this.frameHeight;
  }

  init(): Promise<void> {
    const here = fileURLToPath(new URL(".", import.meta.url));
    const buildDir = pathService.join(here, "doom", "build");
    const doomJsPath = pathService.join(buildDir, "doom.js");

    const wadPath = this.wadPath;
    return runtime
      .runPromise(
        Effect.gen(function* () {
          if (!(yield* fsService.exists(doomJsPath).pipe(Effect.orElseSucceed(() => false)))) {
            return yield* Effect.fail(
              new Error(`WASM not found at ${doomJsPath}. Run ./doom/build.sh first`),
            );
          }
          const doomJsCode = yield* fsService.readFileString(doomJsPath);
          const wad = yield* fsService.readFile(wadPath);
          return { doomJsCode, wadArray: Array.from(wad) };
        }),
      )
      .then(({ doomJsCode, wadArray }) =>
        loadDoomFactory(buildDir, doomJsPath, doomJsCode)(moduleConfig(buildDir, wadArray)),
      )
      .then((module) => {
        this.module = module;
        this.initDoom();
        this.frameBufferPtr = module["_DG_GetFrameBuffer"]();
        this.frameWidth = module["_DG_GetScreenWidth"]();
        this.frameHeight = module["_DG_GetScreenHeight"]();
        this.initialized = true;
        return undefined;
      });
  }

  private initDoom(): void {
    const module = this.module;
    if (module === null) return;

    const args = ["doom", "-iwad", "/doom/doom1.wad"];
    const argPtrs = args.map((arg) => {
      const ptr = module["_malloc"](arg.length + 1);
      for (let i = 0; i < arg.length; i++) {
        module.setValue(ptr + i, arg.charCodeAt(i), "i8");
      }
      module.setValue(ptr + arg.length, 0, "i8");
      return ptr;
    });

    const argvPtr = module["_malloc"](argPtrs.length * 4);
    for (let i = 0; i < argPtrs.length; i++) {
      module.setValue(argvPtr + i * 4, argPtrs[i]!, "i32");
    }

    module["_doomgeneric_Create"](args.length, argvPtr);

    for (const ptr of argPtrs) {
      module["_free"](ptr);
    }
    module["_free"](argvPtr);
  }

  tick(): void {
    if (this.module === null || !this.initialized) return;
    this.module["_doomgeneric_Tick"]();
  }

  getFrameRGBA(): Uint8Array {
    if (this.module === null || !this.initialized) {
      return new Uint8Array(this.frameWidth * this.frameHeight * 4);
    }

    const pixels = this.frameWidth * this.frameHeight;
    const buffer = new Uint8Array(pixels * 4);
    const module = this.module;

    for (let i = 0; i < pixels; i++) {
      const argb = module.getValue(this.frameBufferPtr + i * 4, "i32");
      const offset = i * 4;
      buffer[offset + 0] = (argb >> 16) & 0xff;
      buffer[offset + 1] = (argb >> 8) & 0xff;
      buffer[offset + 2] = argb & 0xff;
      buffer[offset + 3] = 255;
    }

    return buffer;
  }

  pushKey(pressed: boolean, key: number): void {
    if (this.module === null || !this.initialized) return;
    this.module["_DG_PushKeyEvent"](pressed ? 1 : 0, key);
  }

  isInitialized(): boolean {
    return this.initialized;
  }
}
