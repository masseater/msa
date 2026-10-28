const createMarker = () =>
  class Marker {
    static tag = "marker";
    method(): string {
      return "marker";
    }
  };

const classMarker = { createMarker };

export default classMarker;
