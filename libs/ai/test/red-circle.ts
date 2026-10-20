import redCircleDataUrl from "./data/red-circle.png?inline";

const redCircle = {
  data: redCircleDataUrl.slice(redCircleDataUrl.indexOf(",") + 1),
  mimeType: "image/png",
};

export default redCircle;
