import imageModels from "../image-models.ts";
import imagesApiRegistry from "../images-api-registry.ts";
import images from "../images.ts";
import registerBuiltins from "../providers/images/register-builtins.ts";

const imagesKit: {
  readonly imageModels: typeof imageModels;
  readonly images: typeof images;
  readonly imagesApiRegistry: typeof imagesApiRegistry;
  readonly registerBuiltins: typeof registerBuiltins;
} = {
  imageModels,
  images,
  imagesApiRegistry,
  registerBuiltins,
};

export default imagesKit;
