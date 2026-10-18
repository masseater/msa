import type { Provider } from "../models.ts";
import { antLingProvider } from "./ant-ling.ts";
import { kimiCodingProvider } from "./kimi-coding.ts";
import { minimaxCnProvider } from "./minimax-cn.ts";
import { minimaxProvider } from "./minimax.ts";
import { moonshotaiCnProvider } from "./moonshotai-cn.ts";
import { moonshotaiProvider } from "./moonshotai.ts";
import { xiaomiProvider } from "./xiaomi.ts";
import { zaiCodingCnProvider } from "./zai-coding-cn.ts";
import { zaiProvider } from "./zai.ts";

export function chinaLabProviders(): Provider[] {
  return [
    antLingProvider(),
    minimaxProvider(),
    minimaxCnProvider(),
    moonshotaiProvider(),
    moonshotaiCnProvider(),
    zaiProvider(),
    zaiCodingCnProvider(),
    kimiCodingProvider(),
    xiaomiProvider(),
  ];
}
