import type nodeLlamaCppClassifyTypes from "@msa/ai/api/node-llama-cpp-classify.types";

type Listener = (event: nodeLlamaCppClassifyTypes.LocalModelEvent) => void;

const listeners = new Set<Listener>();

function emitLocalModelEvent(event: nodeLlamaCppClassifyTypes.LocalModelEvent): void {
  for (const listener of listeners) listener(event);
}

function subscribeLocalModelEvents(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

const localModelEvents = { emitLocalModelEvent, subscribeLocalModelEvents };

export default localModelEvents;
