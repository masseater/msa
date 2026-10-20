import type bashTypes from "./bash.types.ts";
import type editDisplayTypes from "./edit-display.types.ts";
import type editTypes from "./edit.types.ts";
import type imageTypes from "./image.types.ts";
import type readTextTypes from "./read-text.types.ts";
import type readTypes from "./read.types.ts";
import type writeTypes from "./write.types.ts";

declare namespace toolsTypes {
  type BashExecution = bashTypes.BashExecution;

  type BashPrepare = bashTypes.BashPrepare;

  type BashToolInput = bashTypes.BashToolInput;

  type BashToolOptions = bashTypes.BashToolOptions;

  type PowerShellToolInput = bashTypes.PowerShellToolInput;

  type PowerShellToolOptions = bashTypes.PowerShellToolOptions;

  type EditToolDetails = editDisplayTypes.EditToolDetails;

  type EditToolInput = editTypes.EditToolInput;

  type ImageLimits = imageTypes.ImageLimits;

  type ImageProcessor = imageTypes.ImageProcessor;

  type PreparedImage = imageTypes.PreparedImage;

  type ReadToolDetails = readTextTypes.ReadToolDetails;

  type ReadToolInput = readTypes.ReadToolInput;

  type ReadToolOptions = readTypes.ReadToolOptions;

  type WriteToolInput = writeTypes.WriteToolInput;
}

export type { toolsTypes as default };
