import assert from "node:assert/strict";
import test from "node:test";
import { PNG } from "pngjs";
import { applyPositionAwareTypographyMaterial, applyTypographyMaterial, removeConnectedMatte, typographyPrompt } from "./server.mjs";

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

function makeGrayscaleMasterFixture() {
  const png = new PNG({ width: 40, height: 40 });
  png.data.fill(255);
  for (let y = 8; y < 32; y += 1) {
    for (let x = 8; x < 32; x += 1) {
      const index = (y * png.width + x) * 4;
      const shade = Math.round(52 + (y - 8) / 24 * 112);
      png.data[index] = shade;
      png.data[index + 1] = shade;
      png.data[index + 2] = shade;
    }
  }
  return PNG.sync.write(png);
}

function makeSplitBackgroundFixture() {
  const png = new PNG({ width: 80, height: 40 });
  for (let y = 0; y < png.height; y += 1) {
    for (let x = 0; x < png.width; x += 1) {
      const index = (y * png.width + x) * 4;
      const color = x < png.width / 2 ? [236, 212, 82] : [16, 62, 48];
      png.data[index] = color[0]; png.data[index + 1] = color[1]; png.data[index + 2] = color[2]; png.data[index + 3] = 255;
    }
  }
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

test("typography prompt separates font structure from semantic environment reference", () => {
  const dataUrl = `data:image/png;base64,${makeWhiteMatteFixture().toString("base64")}`;
  const reference = { dataUrl, mimeType: "image/png" };
  const prompt = typographyPrompt({
    text: "新品首发",
    fontPresetKey: "custom-reference",
    mode: "create",
    matte: "white",
    references: { color: reference, font: reference },
  });
  assert.match(prompt, /pre-desaturated font reference/);
  assert.match(prompt, /desaturated environment reference/);
  assert.match(prompt, /ink splashes, geometric forms/);
  assert.match(prompt, /never copy concrete products/);
  assert.match(prompt, /Priority order/);
});

test("poster study prompt treats one image as typography and environment evidence", () => {
  const dataUrl = `data:image/png;base64,${makeWhiteMatteFixture().toString("base64")}`;
  const prompt = typographyPrompt({
    text: "新品首发",
    fontPresetKey: "custom-reference",
    mode: "create",
    matte: "white",
    studyPoster: true,
    references: { color: { dataUrl, mimeType: "image/png" } },
  });
  assert.match(prompt, /desaturated finished poster/);
  assert.match(prompt, /poster headline's structural design language/);
  assert.match(prompt, /without copying the poster's original words/);
});

test("local material renderer colors a grayscale master while preserving matte", () => {
  const referenceBytes = makeWhiteMatteFixture();
  const reference = { dataUrl: `data:image/png;base64,${referenceBytes.toString("base64")}`, mimeType: "image/png" };
  const rendered = applyTypographyMaterial(
    { bytes: makeGrayscaleMasterFixture(), mimeType: "image/png" },
    reference,
    "white",
  );
  const png = PNG.sync.read(rendered.image.bytes);
  const pixelAt = (x, y) => [...png.data.subarray((y * png.width + x) * 4, (y * png.width + x) * 4 + 4)];
  assert.deepEqual(pixelAt(0, 0), [255, 255, 255, 255]);
  const top = pixelAt(12, 10);
  const bottom = pixelAt(12, 29);
  assert.ok(Math.max(...top.slice(0, 3)) - Math.min(...top.slice(0, 3)) > 20);
  assert.notDeepEqual(top.slice(0, 3), bottom.slice(0, 3));
  assert.ok(rendered.palette.primary.startsWith("#"));
  assert.ok(rendered.profile.brightness >= 0 && rendered.profile.brightness <= 1);
  assert.ok(rendered.profile.saturation >= 0 && rendered.profile.saturation <= 1);
});

test("position-aware renderer adapts different glyph regions to local background", () => {
  const backgroundBytes = makeSplitBackgroundFixture();
  const background = { dataUrl: `data:image/png;base64,${backgroundBytes.toString("base64")}`, mimeType: "image/png" };
  const rendered = applyPositionAwareTypographyMaterial(
    { bytes: makeGrayscaleMasterFixture(), mimeType: "image/png" },
    background,
    "white",
    { x: 0, y: 0, width: 1, height: 1 },
  );
  const png = PNG.sync.read(rendered.image.bytes);
  const luminanceAt = (x, y) => {
    const index = (y * png.width + x) * 4;
    return 0.2126 * png.data[index] + 0.7152 * png.data[index + 1] + 0.0722 * png.data[index + 2];
  };
  assert.ok(luminanceAt(12, 20) < luminanceAt(28, 20), "bright background should receive darker type than dark background");
  assert.ok(rendered.analysis.averageLuminanceDistance > 0.15);
  assert.equal(rendered.analysis.sampledRegions, 784);
});
