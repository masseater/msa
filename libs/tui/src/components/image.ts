import Image from "./image-class.ts";
import imageTranscoderModule from "./image-transcoder.ts";

const image = {
  Image,
  setImageTranscoder: imageTranscoderModule.setImageTranscoder,
};

export default image;
