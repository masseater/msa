declare namespace sseTypes {
  interface SseEvent {
    event?: string;
    data: string;
    id?: string;
  }

  interface ConsumeSseOptions {
    maxEventBytes?: number;
    onEvent(event: SseEvent): void;
    onId?(id: string): void;
    onRetry?(delayMs: number): void;
  }
}

export type { sseTypes as default };
