import assert from "node:assert/strict";
import test from "node:test";
import { PNG } from "pngjs";
import { removeConnectedMatte } from "./server.mjs";

function makeWhiteMatteFixture() {
  const png = new PNG({ width: 40, height: 40 });
  png.data.fill(255);
  for (let y = 8; y < 32; y += 1) {
    for (let x = 8; x < 32; x += 1) {
      const index = (y * png.width + x) * 4;
      png.data[index] = 30;
      png.data[index + 1] = 150;
      png.data[index + 2] = 80;
    }
  }
  // A glyph counter large enough to be treated as an enclosed hole.
  for (let y = 15; y < 25; y += 1) {
    for (let x = 15; x < 25; x += 1) {
      const index = (y * png.width + x) * 4;
      png.data[index] = 255;
      png.data[index + 1] = 255;
      png.data[index + 2] = 255;
    }
  }
  // A tiny white highlight should survive the hole filter.
  const highlight = (11 * png.width + 11) * 4;
  png.data[highlight] = 255;
  png.data[highlight + 1] = 255;
  png.data[highlight + 2] = 255;
  return PNG.sync.write(png);
}

test("removes edge matte and enclosed glyph counters", () => {
  const result = PNG.sync.read(removeConnectedMatte(makeWhiteMatteFixture(), "white"));
  const alphaAt = (x, y) => result.data[(y * result.width + x) * 4 + 3];
  assert.equal(alphaAt(0, 0), 0);
  assert.equal(alphaAt(20, 20), 0);
  assert.equal(alphaAt(11, 11), 255);
  assert.equal(alphaAt(10, 20), 255);
});
