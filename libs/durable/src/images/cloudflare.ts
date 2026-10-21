import photonWasm from "@silvia-odwyer/photon/photon_rs_bg.wasm";

import type imageTypes from "../tools/image.types.ts";
import images from "./index.ts";

const { createPhotonImages } = images;

function createCloudflarePhotonImages(): imageTypes.ImageProcessor {
  return createPhotonImages(photonWasm);
}

const cloudflare = {
  createCloudflarePhotonImages,
};

export default cloudflare;
