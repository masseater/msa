import hooks from "../utils/hooks.ts";
import fauxDeferred from "./faux-deferred.ts";

const fauxCoreKit = {
  fauxDeferred,
  hooks,
};

export default fauxCoreKit;
