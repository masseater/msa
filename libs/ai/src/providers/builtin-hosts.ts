import type { Provider } from "../models.ts";
import { basetenProvider } from "./baseten.ts";
import { cerebrasProvider } from "./cerebras.ts";
import { fireworksProvider } from "./fireworks.ts";
import { groqProvider } from "./groq.ts";
import { huggingfaceProvider } from "./huggingface.ts";
import { nvidiaProvider } from "./nvidia.ts";
import { togetherProvider } from "./together.ts";

export function inferenceHostProviders(): Provider[] {
  return [
    groqProvider(),
    cerebrasProvider(),
    fireworksProvider(),
    togetherProvider(),
    basetenProvider(),
    huggingfaceProvider(),
    nvidiaProvider(),
  ];
}
