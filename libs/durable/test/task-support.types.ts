declare namespace taskSupportTypes {
  type Deferred<T = void> = PromiseWithResolvers<T>;
}

export type { taskSupportTypes as default };
