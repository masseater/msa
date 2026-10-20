import type imageTypes from "../tools/image.types.ts";
import type nodeThread from "./node-thread.ts";

declare namespace nodeThreadTypes {
  type PhotonThread = {
    prepare(
      bytes: Uint8Array,
      mimeType: string,
      limits: imageTypes.ImageLimits,
    ): Promise<imageTypes.PreparedImage | undefined>;
  };

  type PhotonThreadOptions = {
    readonly wasm: Uint8Array;
    readonly idleMs: number;
    readonly onExit: () => void;
  };

  type WorkerUnavailable = (typeof nodeThread.WorkerUnavailable)["prototype"];
}

export type { nodeThreadTypes as default };
