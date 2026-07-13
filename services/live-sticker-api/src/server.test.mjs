import assert from "node:assert/strict";
import test from "node:test";
import { PNG } from "pngjs";
import { extractJsonValue, normalizeBreakdownItems, normalizeScheduleItems, removeConnectedMatte } from "./server.mjs";

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

test("accepts a top-level DeepSeek array without replacing valid breakdown items", () => {
  const modelText = JSON.stringify([
    { title: "明确分享目标", note: "确定受众和预期结果" },
    { title: "整理案例", note: "筛选有代表性的实操案例" },
    { title: "制作演示", note: "完成演示流程与备用方案" },
  ]);
  const parsed = extractJsonValue(modelText);
  const normalized = normalizeBreakdownItems(parsed, { title: "准备分享" });

  assert.equal(normalized.usedFallback, false);
  assert.deepEqual(normalized.items.map((item) => item.title), ["明确分享目标", "整理案例", "制作演示"]);
});

test("accepts fenced object responses from DeepSeek-compatible gateways", () => {
  const parsed = extractJsonValue('```json\n{"items":[{"title":"A"},{"title":"B"},{"title":"C"}]}\n```');
  const normalized = normalizeBreakdownItems(parsed, { title: "Root" });

  assert.equal(normalized.usedFallback, false);
  assert.deepEqual(normalized.items.map((item) => item.title), ["A", "B", "C"]);
});

test("labels incomplete schedule output for fallback instead of treating it as DeepSeek success", () => {
  const input = {
    parent: { id: "root", title: "项目", startDay: 0, endDay: 14 },
    children: [
      { id: "a", title: "任务 A" },
      { id: "b", title: "任务 B" },
    ],
  };
  const normalized = normalizeScheduleItems([{ id: "a", startDay: 0, endDay: 4, lane: 0 }], input);

  assert.equal(normalized.usedFallback, true);
  assert.equal(normalized.items.length, 2);
});
