import type nodeTypes from "../src/env/node.types.ts";
import type imageTypes from "../src/tools/image.types.ts";

declare namespace toolsImagesSupportTypes {
  type ImageProcessor = imageTypes.ImageProcessor;

  type NodeExecutionEnv = nodeTypes.NodeExecutionEnv;
}

export type { toolsImagesSupportTypes as default };
