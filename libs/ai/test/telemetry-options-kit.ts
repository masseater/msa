import simpleOptions from "../src/api/simple-options.ts";
import imagesApiRegistry from "../src/images-api-registry.ts";
import images from "../src/images.ts";
import models from "../src/models.ts";

const telemetryOptionsKit = {
  images,
  imagesApiRegistry,
  models,
  simpleOptions,
};

export default telemetryOptionsKit;
