import authModelsKit from "./index-kit/auth-models.ts";
import streamsFauxKit from "./index-kit/streams-faux.ts";

const indexKit: typeof authModelsKit & typeof streamsFauxKit = {
  ...authModelsKit,
  ...streamsFauxKit,
};

export default indexKit;
