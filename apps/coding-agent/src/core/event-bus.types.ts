declare namespace eventBusTypes {
  interface EventBus {
    emit(channel: string, data: unknown): void;
    on(channel: string, handler: (data: unknown) => void): () => void;
  }

  interface EventBusController extends EventBus {
    clear(): void;
  }
}

export type { eventBusTypes as default };
