import platform from "../core/platform/index.ts";
import clipboard from "../utils/clipboard.ts";
import imageConvert from "../utils/image-convert.ts";
import imageResize from "../utils/image-resize.ts";
import mime from "../utils/mime.ts";
import shell from "../utils/shell.ts";

const utilsKit: {
  readonly convertToPng: typeof imageConvert.convertToPng;
  readonly copyToClipboard: typeof clipboard.copyToClipboard;
  readonly detectSupportedImageMimeTypeFromFile: typeof mime.detectSupportedImageMimeTypeFromFile;
  readonly formatDimensionNote: typeof imageResize.formatDimensionNote;
  readonly formatLocalTime: typeof platform.formatLocalTime;
  readonly getPowerShellConfig: typeof shell.getPowerShellConfig;
  readonly getShellConfig: typeof shell.getShellConfig;
  readonly resizeImage: typeof imageResize.resizeImage;
} = {
  convertToPng: imageConvert.convertToPng,
  copyToClipboard: clipboard.copyToClipboard,
  detectSupportedImageMimeTypeFromFile: mime.detectSupportedImageMimeTypeFromFile,
  formatDimensionNote: imageResize.formatDimensionNote,
  formatLocalTime: platform.formatLocalTime,
  getPowerShellConfig: shell.getPowerShellConfig,
  getShellConfig: shell.getShellConfig,
  resizeImage: imageResize.resizeImage,
};

export default utilsKit;
