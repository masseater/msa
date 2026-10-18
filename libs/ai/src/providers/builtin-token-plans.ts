import type { Provider } from "../models.ts";
import { qwenTokenPlanCnProvider } from "./qwen-token-plan-cn.ts";
import { qwenTokenPlanIndividualProvider } from "./qwen-token-plan-individual.ts";
import { qwenTokenPlanProvider } from "./qwen-token-plan.ts";
import { xiaomiTokenPlanAmsProvider } from "./xiaomi-token-plan-ams.ts";
import { xiaomiTokenPlanCnProvider } from "./xiaomi-token-plan-cn.ts";
import { xiaomiTokenPlanSgpProvider } from "./xiaomi-token-plan-sgp.ts";

export function tokenPlanProviders(): Provider[] {
  return [
    qwenTokenPlanProvider(),
    qwenTokenPlanCnProvider(),
    qwenTokenPlanIndividualProvider(),
    xiaomiTokenPlanAmsProvider(),
    xiaomiTokenPlanCnProvider(),
    xiaomiTokenPlanSgpProvider(),
  ];
}
