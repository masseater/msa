import apiProvidersKit from "./compat-kit/api-providers.ts";
import authModelsKit from "./compat-kit/auth-models.ts";
import imagesKit from "./compat-kit/images.ts";
import streamsFauxKit from "./compat-kit/streams-faux.ts";

const compatKit: typeof apiProvidersKit &
  typeof authModelsKit &
  typeof imagesKit &
  typeof streamsFauxKit = {
  ...apiProvidersKit,
  ...authModelsKit,
  ...imagesKit,
  ...streamsFauxKit,
};

export default compatKit;
