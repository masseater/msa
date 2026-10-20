import type imageTypes from "./image.types.ts";

let imageTranscoder: imageTypes.ImageTranscoder | undefined;
const pngCache = new Map<string, string | null>();

function currentImageTranscoder(): imageTypes.ImageTranscoder | undefined {
  return imageTranscoder;
}

function setImageTranscoder(transcoder: imageTypes.ImageTranscoder | undefined): void {
  imageTranscoder = transcoder;
  pngCache.clear();
}

const imageTranscoderModule = {
  currentImageTranscoder,
  pngCache,
  setImageTranscoder,
};

export default imageTranscoderModule;
