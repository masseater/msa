import type { Provider } from "../models.ts";
import { chinaLabProviders } from "./builtin-china-labs.ts";
import { cloudProviders } from "./builtin-clouds.ts";
import { gatewayProviders } from "./builtin-gateways.ts";
import { inferenceHostProviders } from "./builtin-hosts.ts";
import { labProviders } from "./builtin-labs.ts";
import { tokenPlanProviders } from "./builtin-token-plans.ts";

const byId = (left: Provider, right: Provider): number => (left.id < right.id ? -1 : 1);

export function builtinProviders(): Provider[] {
  return [
    ...labProviders(),
    ...cloudProviders(),
    ...inferenceHostProviders(),
    ...gatewayProviders(),
    ...chinaLabProviders(),
    ...tokenPlanProviders(),
  ].sort(byId);
}
