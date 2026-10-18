import { afterEach, describe, expect, it, vi } from "vitest";
import { downscaleImage, scaledSize } from "./image";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("scaledSize", () => {
  it("scales a 4000×3000 image to 2000×1500", () => {
    expect(scaledSize(4000, 3000)).toEqual({ width: 2000, height: 1500 });
  });

  it("scales a portrait image by its long edge", () => {
    expect(scaledSize(3024, 4032)).toEqual({ width: 1500, height: 2000 });
  });

  it("leaves a small image as it is", () => {
    expect(scaledSize(1200, 900)).toEqual({ width: 1200, height: 900 });
  });
});

describe("downscaleImage", () => {
  it("draws a 4000×3000 photo on a 2000×1500 canvas and encodes it as JPEG at 0.9", async () => {
    const close = vi.fn();
    vi.stubGlobal("createImageBitmap", vi.fn(async () => ({ width: 4000, height: 3000, close })));
    const drawImage = vi.fn();
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({
      drawImage,
    } as unknown as CanvasRenderingContext2D);
    let canvasSize: [number, number] = [0, 0];
    const toBlob = vi
      .spyOn(HTMLCanvasElement.prototype, "toBlob")
      .mockImplementation(function (this: HTMLCanvasElement, cb: BlobCallback) {
        canvasSize = [this.width, this.height];
        cb(new Blob(["jpeg"], { type: "image/jpeg" }));
      });

    const blob = await downscaleImage(new Blob(["photo"], { type: "image/jpeg" }));

    expect(canvasSize).toEqual([2000, 1500]);
    expect(drawImage).toHaveBeenCalledWith(expect.anything(), 0, 0, 2000, 1500);
    expect(toBlob).toHaveBeenCalledWith(expect.any(Function), "image/jpeg", 0.9);
    expect(blob.type).toBe("image/jpeg");
    expect(close).toHaveBeenCalled();
  });
});
