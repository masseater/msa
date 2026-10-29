import platform from "../core/platform/index.ts";
import changelog from "../utils/changelog.ts";
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
  readonly getChangelogPath: typeof changelog.getChangelogPath;
  readonly getPowerShellConfig: typeof shell.getPowerShellConfig;
  readonly getShellConfig: typeof shell.getShellConfig;
  readonly parseChangelog: typeof changelog.parseChangelog;
  readonly resizeImage: typeof imageResize.resizeImage;
  readonly resizeImageInWorker: typeof imageResize.resizeImageInWorker;
} = {
  convertToPng: imageConvert.convertToPng,
  copyToClipboard: clipboard.copyToClipboard,
  detectSupportedImageMimeTypeFromFile: mime.detectSupportedImageMimeTypeFromFile,
  formatDimensionNote: imageResize.formatDimensionNote,
  formatLocalTime: platform.formatLocalTime,
  getChangelogPath: changelog.getChangelogPath,
  getPowerShellConfig: shell.getPowerShellConfig,
  getShellConfig: shell.getShellConfig,
  parseChangelog: changelog.parseChangelog,
  resizeImage: imageResize.resizeImage,
  resizeImageInWorker: imageResize.resizeImageInWorker,
};

export default utilsKit;
