import TransportEvents from "./transport-events.ts";

const DEFAULT_MAX_MESSAGE_BYTES = 16 * 1024 * 1024;

const transport = {
  DEFAULT_MAX_MESSAGE_BYTES,
  TransportEvents,
};

export default transport;
