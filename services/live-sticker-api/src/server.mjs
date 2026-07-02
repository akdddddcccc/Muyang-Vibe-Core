import { createServer } from "node:http";
import { randomUUID } from "node:crypto";
import { pathToFileURL } from "node:url";
import { PNG } from "pngjs";

const host = process.env.CORE_HOST ?? "127.0.0.1";
const port = Number(process.env.CORE_PORT ?? 8787);
const allowedOrigins = (process.env.CORS_ORIGIN ?? "*").split(",").map((origin) => origin.trim()).filter(Boolean);
const adapterUrl = (process.env.OFOX_TYPOGRAPHY_ADAPTER_URL ?? process.env.TYPOGRAPHY_ADAPTER_URL)?.replace(/\/$/, "");
const adapterToken = process.env.OFOX_TYPOGRAPHY_ADAPTER_TOKEN ?? process.env.TYPOGRAPHY_ADAPTER_TOKEN;
const ofoxApiKey = process.env.OFOX_API_KEY;
const ofoxBaseUrl = (process.env.OFOX_BASE_URL ?? "https://api.ofox.ai/v1").replace(/\/$/, "");
const ofoxImageModel = process.env.OFOX_IMAGE_MODEL ?? "openai/gpt-image-2";
const ofoxImageQuality = process.env.OFOX_IMAGE_QUALITY ?? "low";
const textLayerSize = process.env.OFOX_TEXT_LAYER_SIZE ?? "1536x1024";
const jobs = new Map();
const typographyPresetKeys = new Set(["elegant-songti", "expressive-calligraphy", "rounded-cute", "custom-reference"]);
const stickerSpecs = {
  top: {
    label: "上贴", size: "1536x1024", direction: "top banner, landscape",
    instruction: "生成直播间顶部横向贴片。顶部 35% 和左右边缘可有装饰、材质和光效，必须保留参考图的主色、饱和度、线条对比和深浅层次，不能泛白、雾化或褪色；只有底边 25% 可以自然过渡到中性纯白或近白背景。若存在聚焦感，视觉轻微向下汇聚，但不要形成明确主体或海报中心。",
  },
  bottom: {
    label: "下贴", size: "1536x1024", direction: "bottom banner, landscape",
    instruction: "生成直播间底部横向贴片。下沿 35% 可承载主要装饰、材质和光效，必须保留参考图的主色、饱和度、线条对比和深浅关系，不能泛白、雾化或褪色；只有顶边 25% 可以自然过渡到中性纯白或近白背景。若存在聚焦感，视觉轻微向上汇聚，但不要形成明确主体或促销海报感。",
  },
  side: {
    label: "侧贴", size: "1024x1536", direction: "side banner, portrait",
    instruction: "生成直播间侧边竖向窄幅贴片。装饰只允许沿一侧外边缘单侧生长，可集中在左上角、上沿或外侧边缘；另一侧与大部分区域必须保持素净、透气。严禁左右对半、镜像对称、中央分割、双栏、门框式构图、两侧同时出现同等装饰。严禁密铺、平铺、网格式重复、连续小图案、壁纸纹样或满版装饰。不要强纵深、中心主体或密集信息排版。",
  },
};

const backgroundBasePrompt = `根据当前唯一参考图生成直播间贴片背景底图。
本次请求只允许使用当前上传的这一张参考图；不存在任何历史参考图、缓存图片或上一轮素材。
只继承当前参考图的构图气质、色彩关系、材质、光效、边缘装饰密度和留白方式，不复刻其主体、物件、文字或场景。
颜色锁定：装饰区域必须保持参考图主要颜色的饱和度、明度层次和深色线条对比，不能把彩色装饰整体洗成浅灰、浅粉、浅蓝或接近白色。
留白只发生在指定过渡边缘，不允许把整张贴片做成低饱和、雾化、褪色、奶白或半透明质感。
将参考图中的主体转译为抽象背景语言，使画面适合叠加直播间内容。
整体干净、透气，过渡边缘自然，不抢直播主体。`;

const backgroundNegativePrompt = "禁止生成：参考图中的原始主体或物件、任何其他图片痕迹、文字、logo、二维码、人物、具体商品、价格、优惠券、促销标签、按钮、信息图、海报模板、广告版式、月亮、天体、球体、强中心主体、强边框、深色压迫背景、过密装饰、脏灰底色、整图泛白、整图雾化、低饱和褪色、彩色线条变浅、装饰区域接近白色、平铺纹样、重复贴图。";

function corsOrigin(request) {
  if (allowedOrigins.includes("*")) return "*";
  const origin = request.headers.origin;
  return origin && allowedOrigins.includes(origin) ? origin : allowedOrigins[0] ?? "null";
}

function sendJson(request, response, statusCode, body) {
  response.writeHead(statusCode, {
    "Access-Control-Allow-Origin": corsOrigin(request),
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Request-Id",
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "Vary": "Origin",
  });
  response.end(JSON.stringify(body));
}

function sendOptions(request, response) {
  response.writeHead(204, {
    "Access-Control-Allow-Origin": corsOrigin(request),
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Request-Id",
    "Access-Control-Max-Age": "600",
    "Vary": "Origin",
  });
  response.end();
}

async function readJson(request, maxBytes = 32_000_000) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > maxBytes) throw new Error("request_too_large");
    chunks.push(chunk);
  }
  if (!chunks.length) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new Error("invalid_json");
  }
}

function normalizeReference(value) {
  if (!value || typeof value !== "object") return undefined;
  const reference = {};
  if (typeof value.assetId === "string" && value.assetId.length <= 160) reference.assetId = value.assetId;
  if (typeof value.mimeType === "string" && value.mimeType.startsWith("image/")) reference.mimeType = value.mimeType;
  if (typeof value.dataUrl === "string" && value.dataUrl.startsWith("data:image/") && value.dataUrl.length <= 12_000_000) reference.dataUrl = value.dataUrl;
  return reference.dataUrl ? reference : undefined;
}

function validateTypographyRequest(payload) {
  const text = typeof payload.text === "string" ? payload.text.trim() : "";
  const fontPresetKey = typeof payload.fontPresetKey === "string" ? payload.fontPresetKey : "elegant-songti";
  const mode = payload.mode === "refine" ? "refine" : "create";
  const matte = payload.matte === "black" ? "black" : "white";
  const studyPoster = payload.studyPoster === true;
  const deferMaterial = payload.deferMaterial === true;
  const instruction = typeof payload.instruction === "string" ? payload.instruction.trim() : "";
  const references = {
    color: normalizeReference(payload.references?.color),
    font: normalizeReference(payload.references?.font),
    layout: normalizeReference(payload.references?.layout),
    typography: normalizeReference(payload.references?.typography),
  };
  if (mode === "create" && !text && !references.layout) return { error: "请填写文本内容，或提供带布局的文本参考图。" };
  if (mode === "refine" && !text) return { error: "微调已有文字图层时请填写新的文本内容。" };
  if (mode === "refine" && !references.typography) return { error: "微调已有文字图层时请提供文字图层参考。" };
  if (studyPoster && !references.color) return { error: "成品海报学习模式需要上传一张海报或背景参考图。" };
  if (text.length > 240) return { error: "文本内容不能超过 240 个字符。" };
  if (instruction.length > 480) return { error: "定制化要求不能超过 480 个字符。" };
  if (!typographyPresetKeys.has(fontPresetKey)) return { error: "fontPresetKey 无效。" };
  return { value: { text, fontPresetKey, mode, matte, studyPoster, deferMaterial, instruction: instruction || undefined, references } };
}

function validateTypographyMaterialRequest(payload) {
  const image = normalizeReference(payload.image);
  const background = normalizeReference(payload.background);
  const matte = payload.matte === "black" ? "black" : "white";
  const source = payload.placement && typeof payload.placement === "object" ? payload.placement : {};
  const placement = {
    x: Number(source.x), y: Number(source.y), width: Number(source.width), height: Number(source.height),
  };
  if (!image) return { error: "请提供灰度文字实底稿。" };
  if (!background) return { error: "请提供需要适配的背景图。" };
  if (!Object.values(placement).every(Number.isFinite)) return { error: "文字位置参数无效。" };
  if (placement.x < 0 || placement.y < 0 || placement.width <= 0 || placement.height <= 0 || placement.x + placement.width > 1 || placement.y + placement.height > 1) {
    return { error: "文字位置必须完整位于背景范围内。" };
  }
  return { value: { image, background, matte, placement } };
}

function validateBackgroundRequest(payload) {
  const kind = typeof payload.kind === "string" ? payload.kind : "";
  const prompt = typeof payload.prompt === "string" ? payload.prompt.trim() : "";
  const reference = normalizeReference(payload.reference);
  if (!stickerSpecs[kind]) return { error: "kind 必须是 top、bottom 或 side。" };
  if (!reference) return { error: "请先上传直播间或色彩参考图。当前 OFOX 背景任务固定使用参考图编辑。" };
  if (prompt.length > 800) return { error: "背景生成要求不能超过 800 个字符。" };
  return { value: { kind, prompt, reference } };
}

function validateTypographyCutoutRequest(payload) {
  const image = normalizeReference(payload.image);
  if (!image) return { error: "请提供需要抠图的 PNG 文字实底稿。" };
  return { value: { image } };
}

function isRawOfoxUrl(value) {
  if (!value) return false;
  try {
    const url = new URL(value);
    return url.hostname.endsWith("ofox.ai") || url.hostname.endsWith("ofox.io");
  } catch {
    return false;
  }
}

const externalAdapterUrl = adapterUrl && !isRawOfoxUrl(adapterUrl) ? adapterUrl : undefined;

function typographyPrompt(input) {
  const matte = input.matte === "black" ? "pure black (#000000)" : "pure white (#FFFFFF)";
  const preset = {
    "elegant-songti": "elegant Chinese Songti/Ming serif, sharp terminals and refined thick-thin contrast",
    "expressive-calligraphy": "expressive Chinese brush calligraphy, energetic pressure and sweeping strokes",
    "rounded-cute": "rounded playful Chinese display lettering, thick soft corners and compact rhythm",
    "custom-reference": "the custom glyph reference's letterform and stroke construction",
  }[input.fontPresetKey];
  const hasStructureReference = input.mode === "refine" ? Boolean(input.references.typography) : Boolean(input.references.font);
  const structureReferenceNumber = hasStructureReference ? 1 : undefined;
  const environmentReferenceNumber = input.references.color ? (hasStructureReference ? 2 : 1) : undefined;
  const layoutReferenceNumber = input.references.layout
    ? Number(Boolean(hasStructureReference)) + Number(Boolean(input.references.color)) + 1
    : undefined;
  const referenceRules = input.studyPoster
    ? [
        `Reference ${environmentReferenceNumber} is a desaturated finished poster. Study the existing headline typography's stroke character, weight, width, spacing, hierarchy and grayscale relief together with the poster's abstract visual rhythm.`,
        "Render the new text in that design language without copying the poster's original words, logo, product, people, scene layout or concrete objects.",
      ]
    : input.mode === "refine"
    ? [
        `Reference ${structureReferenceNumber} is an existing desaturated typography asset. It defines the design language: glyph silhouette, stroke construction, weight, width, spacing, hierarchy, layout and grayscale material relief.`,
        "Preserve those structural traits while rendering the new text exactly. Ignore any residual hue and produce a neutral grayscale material master.",
      ]
    : [
        input.references.font ? `Reference ${structureReferenceNumber} is a pre-desaturated font reference. Learn only its design language: glyph silhouette, stroke rhythm, weight, width, corner character, spacing, hierarchy and grayscale surface relief.` : `Typography route: ${preset}.`,
        input.references.layout ? `Reference ${layoutReferenceNumber} controls line breaks, hierarchy and relative placement only. Do not copy its background or unrelated words.` : "",
      ];
  return [
    `Create a standalone neutral-grayscale Chinese typography material master on a strict ${matte} solid background.`,
    "Generate typography only: no poster scene, product, person, logo, QR code, frame or unrelated decoration.",
    `Render exactly this text and preserve its line breaks:\n${input.text}`,
    ...referenceRules,
    environmentReferenceNumber ? `Reference ${environmentReferenceNumber} is a desaturated environment reference. Identify only its abstract visual motifs and design semantics, such as ink splashes, geometric forms, petals, ribbons, light trails, particles, electric arcs or similar nonliteral elements.` : "",
    environmentReferenceNumber ? "Translate at most one or two relevant motif families into restrained grayscale accents attached to or interacting with the glyphs. Preserve the environment's visual rhythm, but never copy concrete products, people, scenery, layout, words, logos or recognizable objects." : "",
    "Use grayscale luminance to encode material depth: retain deliberate highlights, shadows, bevels, grain and stroke relief, but use no colored pixels. A deterministic renderer will apply the livestream palette and texture after this step.",
    "Keep the glyph body visually solid and readable. Decorations must remain attached to the lettering and must not become a separate scene.",
    input.studyPoster
      ? "Priority order: exact written text first; the poster headline's structural design language second; grayscale material depth third; abstract environmental accents fourth."
      : "Priority order: exact written text first; reference or selected preset for structural design language second; grayscale material depth third; abstract environmental accents fourth.",
    input.instruction ? `Additional art direction: ${input.instruction}` : "",
    input.matte === "black"
      ? "Use light neutral-gray lettering. Pure white highlights are allowed, but never use pure black inside any glyph or decoration because pure black is reserved exclusively for the removable matte."
      : "Use dark neutral-gray lettering. Pure black shadows are allowed, but never use pure white inside any glyph or decoration because pure white is reserved exclusively for the removable matte.",
    "Keep all lettering fully inside the canvas with generous margins. Do not add, translate or rewrite any supplied text.",
  ].filter(Boolean).join("\n\n");
}

function backgroundPrompt(input) {
  const spec = stickerSpecs[input.kind];
  return [
    backgroundBasePrompt,
    spec.instruction,
    input.prompt ? `本轮用户补充要求：${input.prompt}` : "",
    `输出尺寸与构图：${spec.direction}，${spec.size}。只输出可叠加的背景素材，三类贴片风格统一但构图不能完全重复。`,
    backgroundNegativePrompt,
  ].filter(Boolean).join("\n\n");
}

function parseDataUrl(dataUrl, index = 0) {
  const match = String(dataUrl || "").match(/^data:([^;,]+);base64,(.+)$/s);
  if (!match) throw new Error("参考图不是有效的 base64 data URL。");
  const extension = match[1] === "image/jpeg" ? "jpg" : match[1] === "image/webp" ? "webp" : "png";
  return { mimeType: match[1], bytes: Buffer.from(match[2], "base64"), fileName: `reference-${index + 1}.${extension}` };
}

function imageToDataUrl({ bytes, mimeType }) {
  return `data:${mimeType};base64,${bytes.toString("base64")}`;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function colorStats(red, green, blue) {
  const max = Math.max(red, green, blue);
  const min = Math.min(red, green, blue);
  const chroma = max - min;
  return {
    luminance: 0.2126 * red + 0.7152 * green + 0.0722 * blue,
    saturation: max === 0 ? 0 : chroma / max,
    chroma,
  };
}

function colorHex(color) {
  return `#${[color.red, color.green, color.blue].map((value) => clamp(Math.round(value), 0, 255).toString(16).padStart(2, "0")).join("")}`;
}

function mixColor(color, target, amount) {
  return {
    red: color.red + (target.red - color.red) * amount,
    green: color.green + (target.green - color.green) * amount,
    blue: color.blue + (target.blue - color.blue) * amount,
  };
}

function extractReferencePalette(reference) {
  if (!reference?.dataUrl) return undefined;
  const parsed = parseDataUrl(reference.dataUrl);
  if (sniffImageMime(parsed.bytes) !== "image/png") return undefined;
  const png = PNG.sync.read(parsed.bytes);
  const step = Math.max(1, Math.floor(Math.sqrt((png.width * png.height) / 14000)));
  let weightSum = 0;
  let redSum = 0;
  let greenSum = 0;
  let blueSum = 0;
  let best = null;
  let bestScore = 0;
  for (let y = 0; y < png.height; y += step) {
    for (let x = 0; x < png.width; x += step) {
      const index = (y * png.width + x) * 4;
      const alpha = png.data[index + 3];
      if (alpha < 180) continue;
      const red = png.data[index];
      const green = png.data[index + 1];
      const blue = png.data[index + 2];
      const stats = colorStats(red, green, blue);
      if (stats.luminance < 18 || stats.luminance > 242 || stats.saturation < 0.12 || stats.chroma < 24) continue;
      const midtoneBonus = 1 - Math.min(1, Math.abs(stats.luminance - 126) / 126);
      const score = stats.saturation * 1.8 + (stats.chroma / 255) * 1.1 + midtoneBonus * 0.7;
      const weight = score * score;
      redSum += red * weight;
      greenSum += green * weight;
      blueSum += blue * weight;
      weightSum += weight;
      if (score > bestScore) {
        bestScore = score;
        best = { red, green, blue };
      }
    }
  }
  if (!weightSum && !best) return undefined;
  const primary = weightSum
    ? { red: redSum / weightSum, green: greenSum / weightSum, blue: blueSum / weightSum }
    : best;
  return {
    primary: {
      red: Math.round(primary.red),
      green: Math.round(primary.green),
      blue: Math.round(primary.blue),
    },
    accent: best ?? primary,
  };
}

function desaturatePngReference(reference) {
  if (!reference?.dataUrl) return reference;
  const parsed = parseDataUrl(reference.dataUrl);
  if (sniffImageMime(parsed.bytes) !== "image/png") return reference;
  const png = PNG.sync.read(parsed.bytes);
  for (let index = 0; index < png.data.length; index += 4) {
    const luminance = Math.round(0.2126 * png.data[index] + 0.7152 * png.data[index + 1] + 0.0722 * png.data[index + 2]);
    png.data[index] = luminance;
    png.data[index + 1] = luminance;
    png.data[index + 2] = luminance;
  }
  const bytes = PNG.sync.write(png);
  return { ...reference, mimeType: "image/png", dataUrl: imageToDataUrl({ bytes, mimeType: "image/png" }) };
}

function sniffImageMime(bytes) {
  if (bytes.subarray(0, 8).toString("hex") === "89504e470d0a1a0a") return "image/png";
  if (bytes.subarray(0, 3).toString("hex") === "ffd8ff") return "image/jpeg";
  if (bytes.subarray(0, 4).toString("ascii") === "RIFF" && bytes.subarray(8, 12).toString("ascii") === "WEBP") return "image/webp";
  return "application/octet-stream";
}

function readablePaletteColor(color, matteMode) {
  const luminance = colorStats(color.red, color.green, color.blue).luminance;
  if (matteMode === "white" && luminance > 138) {
    const amount = clamp((luminance - 126) / 170, 0.18, 0.52);
    return mixColor(color, { red: 0, green: 0, blue: 0 }, amount);
  }
  if (matteMode === "black" && luminance < 168) {
    const amount = clamp((178 - luminance) / 190, 0.2, 0.58);
    return mixColor(color, { red: 255, green: 255, blue: 255 }, amount);
  }
  return color;
}

function typographyMaterialPalette(reference, matteMode) {
  const palette = extractReferencePalette(reference);
  if (!palette) return undefined;
  const primary = readablePaletteColor(palette.primary, matteMode);
  let accent = readablePaletteColor(palette.accent, matteMode);
  const distance = Math.hypot(primary.red - accent.red, primary.green - accent.green, primary.blue - accent.blue);
  if (distance < 42) {
    const target = colorStats(primary.red, primary.green, primary.blue).luminance > 138
      ? { red: 22, green: 22, blue: 22 }
      : { red: 242, green: 242, blue: 242 };
    accent = mixColor(primary, target, 0.38);
  }
  return { primary, accent };
}

function applyTypographyMaterial(image, colorReference, matteMode) {
  if (image.mimeType !== "image/png" || !colorReference?.dataUrl) return { image };
  const palette = typographyMaterialPalette(colorReference, matteMode);
  if (!palette) return { image };
  const referenceImage = parseDataUrl(colorReference.dataUrl);
  if (sniffImageMime(referenceImage.bytes) !== "image/png") return { image };
  const reference = PNG.sync.read(referenceImage.bytes);
  const png = PNG.sync.read(image.bytes);
  let referenceLuminance = 0;
  let referenceLuminanceSquared = 0;
  let referenceSaturation = 0;
  let referenceSamples = 0;
  const referenceStep = Math.max(1, Math.floor(Math.sqrt((reference.width * reference.height) / 12_000)));
  for (let y = 0; y < reference.height; y += referenceStep) {
    for (let x = 0; x < reference.width; x += referenceStep) {
      const index = (y * reference.width + x) * 4;
      if (reference.data[index + 3] < 160) continue;
      const stats = colorStats(reference.data[index], reference.data[index + 1], reference.data[index + 2]);
      referenceLuminance += stats.luminance;
      referenceLuminanceSquared += stats.luminance ** 2;
      referenceSaturation += stats.saturation;
      referenceSamples += 1;
    }
  }
  referenceLuminance /= Math.max(1, referenceSamples);
  const averageSaturation = referenceSaturation / Math.max(1, referenceSamples);
  const luminanceVariance = referenceLuminanceSquared / Math.max(1, referenceSamples) - referenceLuminance ** 2;

  for (let y = 0; y < png.height; y += 1) {
    for (let x = 0; x < png.width; x += 1) {
      const index = (y * png.width + x) * 4;
      const alpha = png.data[index + 3];
      if (alpha < 80) continue;
      const red = png.data[index];
      const green = png.data[index + 1];
      const blue = png.data[index + 2];
      const max = Math.max(red, green, blue);
      const min = Math.min(red, green, blue);
      const mattePixel = matteMode === "black" ? max <= 30 && max - min <= 26 : min >= 230 && max - min <= 26;
      if (mattePixel) continue;

      const matteStrength = matteMode === "black"
        ? clamp((max - 8) / 192, 0, 1)
        : clamp((246 - min) / 192, 0, 1);
      const verticalPosition = y / Math.max(1, png.height - 1);
      const gradientPosition = clamp(verticalPosition * 0.72 + 0.14, 0, 1);
      let materialColor = mixColor(palette.primary, palette.accent, gradientPosition);

      // Sample a low-frequency version of the environment so texture is
      // transferred as abstract variation rather than recognizable objects.
      const textureX = Math.min(reference.width - 1, Math.floor((x / Math.max(1, png.width - 1)) * reference.width / 12) * 12);
      const textureY = Math.min(reference.height - 1, Math.floor((y / Math.max(1, png.height - 1)) * reference.height / 12) * 12);
      const textureIndex = (textureY * reference.width + textureX) * 4;
      const textureColor = {
        red: reference.data[textureIndex],
        green: reference.data[textureIndex + 1],
        blue: reference.data[textureIndex + 2],
      };
      const textureStats = colorStats(textureColor.red, textureColor.green, textureColor.blue);
      const textureAmount = clamp(textureStats.saturation * 0.22 + Math.abs(textureStats.luminance - referenceLuminance) / 255 * 0.16, 0.04, 0.24);
      materialColor = mixColor(materialColor, textureColor, textureAmount);

      // Preserve the AI-generated grayscale relief as highlights and shadows.
      const sourceLuminance = colorStats(red, green, blue).luminance / 255;
      const highlight = clamp((sourceLuminance - 0.58) / 0.42, 0, 1);
      const shadow = clamp((0.38 - sourceLuminance) / 0.38, 0, 1);
      materialColor = mixColor(materialColor, { red: 255, green: 255, blue: 255 }, highlight * 0.38);
      materialColor = mixColor(materialColor, { red: 12, green: 12, blue: 12 }, shadow * 0.32);

      const matteColor = matteMode === "black" ? 0 : 255;
      png.data[index] = Math.round(matteColor * (1 - matteStrength) + materialColor.red * matteStrength);
      png.data[index + 1] = Math.round(matteColor * (1 - matteStrength) + materialColor.green * matteStrength);
      png.data[index + 2] = Math.round(matteColor * (1 - matteStrength) + materialColor.blue * matteStrength);
    }
  }
  return {
    image: { ...image, bytes: PNG.sync.write(png), mimeType: "image/png" },
    palette: { primary: colorHex(palette.primary), accent: colorHex(palette.accent) },
    profile: {
      brightness: Number((referenceLuminance / 255).toFixed(3)),
      saturation: Number(averageSaturation.toFixed(3)),
      contrast: Number((Math.sqrt(Math.max(0, luminanceVariance)) / 128).toFixed(3)),
    },
  };
}

function buildColorGrid(png, columns = 28, rows = 28) {
  const red = new Float64Array(columns * rows);
  const green = new Float64Array(columns * rows);
  const blue = new Float64Array(columns * rows);
  const count = new Uint32Array(columns * rows);
  const step = Math.max(1, Math.floor(Math.sqrt((png.width * png.height) / 90_000)));
  for (let y = 0; y < png.height; y += step) {
    for (let x = 0; x < png.width; x += step) {
      const source = (y * png.width + x) * 4;
      if (png.data[source + 3] < 100) continue;
      const column = Math.min(columns - 1, Math.floor(x / png.width * columns));
      const row = Math.min(rows - 1, Math.floor(y / png.height * rows));
      const target = row * columns + column;
      red[target] += png.data[source];
      green[target] += png.data[source + 1];
      blue[target] += png.data[source + 2];
      count[target] += 1;
    }
  }
  const colors = Array.from({ length: columns * rows }, (_, index) => {
    const divisor = Math.max(1, count[index]);
    return { red: red[index] / divisor, green: green[index] / divisor, blue: blue[index] / divisor };
  });
  return { columns, rows, colors };
}

function sampleColorGrid(grid, x, y) {
  const scaledX = clamp(x, 0, 1) * (grid.columns - 1);
  const scaledY = clamp(y, 0, 1) * (grid.rows - 1);
  const x0 = Math.floor(scaledX);
  const y0 = Math.floor(scaledY);
  const x1 = Math.min(grid.columns - 1, x0 + 1);
  const y1 = Math.min(grid.rows - 1, y0 + 1);
  const horizontal = scaledX - x0;
  const vertical = scaledY - y0;
  const top = mixColor(grid.colors[y0 * grid.columns + x0], grid.colors[y0 * grid.columns + x1], horizontal);
  const bottom = mixColor(grid.colors[y1 * grid.columns + x0], grid.colors[y1 * grid.columns + x1], horizontal);
  return mixColor(top, bottom, vertical);
}

function adaptColorToLocalBackground(base, background) {
  const backgroundLuminance = colorStats(background.red, background.green, background.blue).luminance;
  let result = mixColor(base, background, 0.12);
  let resultLuminance = colorStats(result.red, result.green, result.blue).luminance;
  const requiredDistance = 78;
  if (Math.abs(resultLuminance - backgroundLuminance) < requiredDistance) {
    const target = backgroundLuminance >= 132
      ? { red: 10, green: 10, blue: 10 }
      : { red: 245, green: 245, blue: 245 };
    for (let step = 0; step < 8 && Math.abs(resultLuminance - backgroundLuminance) < requiredDistance; step += 1) {
      result = mixColor(result, target, 0.18);
      resultLuminance = colorStats(result.red, result.green, result.blue).luminance;
    }
  }
  return result;
}

function applyPositionAwareTypographyMaterial(image, backgroundReference, matteMode, placement) {
  if (image.mimeType !== "image/png" || !backgroundReference?.dataUrl) throw new Error("位置适配需要 PNG 灰度文字稿和背景图。");
  const parsedBackground = parseDataUrl(backgroundReference.dataUrl);
  if (sniffImageMime(parsedBackground.bytes) !== "image/png") throw new Error("位置适配背景必须转换为 PNG。");
  const background = PNG.sync.read(parsedBackground.bytes);
  const png = PNG.sync.read(image.bytes);
  const grid = buildColorGrid(background);
  const palette = typographyMaterialPalette(backgroundReference, matteMode);
  if (!palette) throw new Error("无法从背景中提取可用颜色。请换一张色彩信息更完整的参考图。");
  let contrastSum = 0;
  let minimumContrast = 255;
  let coloredPixels = 0;

  for (let y = 0; y < png.height; y += 1) {
    for (let x = 0; x < png.width; x += 1) {
      const index = (y * png.width + x) * 4;
      if (png.data[index + 3] < 80) continue;
      const sourceRed = png.data[index];
      const sourceGreen = png.data[index + 1];
      const sourceBlue = png.data[index + 2];
      const max = Math.max(sourceRed, sourceGreen, sourceBlue);
      const min = Math.min(sourceRed, sourceGreen, sourceBlue);
      const mattePixel = matteMode === "black" ? max <= 30 && max - min <= 26 : min >= 230 && max - min <= 26;
      if (mattePixel) continue;

      const u = placement.x + x / Math.max(1, png.width - 1) * placement.width;
      const v = placement.y + y / Math.max(1, png.height - 1) * placement.height;
      const localBackground = sampleColorGrid(grid, u, v);
      const palettePosition = clamp((u + v) * 0.5, 0, 1);
      const paletteColor = mixColor(palette.primary, palette.accent, palettePosition);
      let materialColor = adaptColorToLocalBackground(paletteColor, localBackground);

      const sourceLuminance = colorStats(sourceRed, sourceGreen, sourceBlue).luminance / 255;
      const highlight = clamp((sourceLuminance - 0.58) / 0.42, 0, 1);
      const shadow = clamp((0.38 - sourceLuminance) / 0.38, 0, 1);
      materialColor = mixColor(materialColor, { red: 255, green: 255, blue: 255 }, highlight * 0.24);
      materialColor = mixColor(materialColor, { red: 10, green: 10, blue: 10 }, shadow * 0.24);

      const localLuminance = colorStats(localBackground.red, localBackground.green, localBackground.blue).luminance;
      const materialLuminance = colorStats(materialColor.red, materialColor.green, materialColor.blue).luminance;
      const contrast = Math.abs(materialLuminance - localLuminance);
      contrastSum += contrast;
      minimumContrast = Math.min(minimumContrast, contrast);
      coloredPixels += 1;

      const matteStrength = matteMode === "black"
        ? clamp((max - 8) / 192, 0, 1)
        : clamp((246 - min) / 192, 0, 1);
      const matteColor = matteMode === "black" ? 0 : 255;
      png.data[index] = Math.round(matteColor * (1 - matteStrength) + materialColor.red * matteStrength);
      png.data[index + 1] = Math.round(matteColor * (1 - matteStrength) + materialColor.green * matteStrength);
      png.data[index + 2] = Math.round(matteColor * (1 - matteStrength) + materialColor.blue * matteStrength);
    }
  }
  return {
    image: { ...image, bytes: PNG.sync.write(png), mimeType: "image/png" },
    palette: { primary: colorHex(palette.primary), accent: colorHex(palette.accent) },
    analysis: {
      averageLuminanceDistance: Number((contrastSum / Math.max(1, coloredPixels) / 255).toFixed(3)),
      minimumLuminanceDistance: Number((minimumContrast / 255).toFixed(3)),
      sampledRegions: grid.columns * grid.rows,
    },
  };
}

function materializeTypography(input) {
  const image = parseDataUrl(input.image.dataUrl);
  if (sniffImageMime(image.bytes) !== "image/png") throw new Error("灰度文字实底稿必须是 PNG。");
  const rendered = applyPositionAwareTypographyMaterial({ bytes: image.bytes, mimeType: "image/png" }, input.background, input.matte, input.placement);
  return {
    result: makeAsset(randomUUID(), "typography-draft", rendered.image),
    renderStrategy: "position-aware-local-material",
    appliedPalette: rendered.palette,
    placement: input.placement,
    analysisSummary: rendered.analysis,
  };
}

async function parseImageResponse(response, requestedFormat) {
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error?.message || payload.message || `OFOX returned ${response.status}.`);
  const image = payload.data?.[0];
  if (!image?.b64_json && !image?.url) throw new Error("OFOX response did not include an image.");
  let bytes;
  if (image.b64_json) bytes = Buffer.from(image.b64_json, "base64");
  else {
    const fetched = await fetch(image.url, { signal: AbortSignal.timeout(60_000) });
    if (!fetched.ok) throw new Error(`无法读取 OFOX 图片地址：${fetched.status}。`);
    bytes = Buffer.from(await fetched.arrayBuffer());
  }
  const mimeType = sniffImageMime(bytes);
  return { bytes, mimeType: mimeType === "application/octet-stream" ? `image/${requestedFormat}` : mimeType };
}

async function requestOfoxImage({ jobId, prompt, size, outputFormat, references = [] }) {
  const headers = { Authorization: `Bearer ${ofoxApiKey}`, "X-Request-Id": jobId };
  let response;
  if (references.length) {
    const form = new FormData();
    form.append("model", ofoxImageModel);
    form.append("prompt", prompt);
    form.append("size", size);
    form.append("quality", ofoxImageQuality);
    form.append("output_format", outputFormat);
    references.forEach((reference, index) => {
      const image = parseDataUrl(reference.dataUrl, index);
      form.append("image", new Blob([image.bytes], { type: image.mimeType }), image.fileName);
    });
    response = await fetch(`${ofoxBaseUrl}/images/edits`, { method: "POST", headers, body: form, signal: AbortSignal.timeout(180_000) });
  } else {
    response = await fetch(`${ofoxBaseUrl}/images/generations`, {
      method: "POST",
      headers: { ...headers, "Content-Type": "application/json" },
      body: JSON.stringify({ model: ofoxImageModel, prompt, size, quality: ofoxImageQuality, output_format: outputFormat }),
      signal: AbortSignal.timeout(180_000),
    });
  }
  return parseImageResponse(response, outputFormat);
}

function removeConnectedMatte(bytes, matteMode) {
  const png = PNG.sync.read(bytes);
  const { width, height, data } = png;
  const total = width * height;
  const visited = new Uint8Array(total);
  const queue = new Uint32Array(total);
  const matches = (index) => {
    const red = data[index];
    const green = data[index + 1];
    const blue = data[index + 2];
    const max = Math.max(red, green, blue);
    const min = Math.min(red, green, blue);
    return matteMode === "black" ? max <= 30 && max - min <= 26 : min >= 230 && max - min <= 26;
  };
  let head = 0;
  let tail = 0;
  const enqueue = (x, y) => {
    if (x < 0 || y < 0 || x >= width || y >= height) return;
    const pixel = y * width + x;
    if (visited[pixel] || !matches(pixel * 4)) return;
    visited[pixel] = 1;
    queue[tail++] = pixel;
  };
  for (let x = 0; x < width; x += 1) { enqueue(x, 0); enqueue(x, height - 1); }
  for (let y = 0; y < height; y += 1) { enqueue(0, y); enqueue(width - 1, y); }
  while (head < tail) {
    const pixel = queue[head++];
    const x = pixel % width;
    const y = Math.floor(pixel / width);
    enqueue(x + 1, y); enqueue(x - 1, y); enqueue(x, y + 1); enqueue(x, y - 1);
  }

  // The edge flood fill preserves foreground details, but it cannot reach the
  // enclosed counters in glyphs such as 日, 目, 田, or 品. Remove enclosed matte
  // components as holes while retaining tiny matte-colored highlights/noise.
  const minimumHoleArea = Math.max(6, Math.round(total * 0.000008));
  for (let seed = 0; seed < total; seed += 1) {
    if (visited[seed] || !matches(seed * 4)) continue;
    head = 0;
    tail = 0;
    visited[seed] = 2;
    queue[tail++] = seed;
    while (head < tail) {
      const pixel = queue[head++];
      const x = pixel % width;
      const y = Math.floor(pixel / width);
      const enqueueHole = (nextX, nextY) => {
        if (nextX < 0 || nextY < 0 || nextX >= width || nextY >= height) return;
        const next = nextY * width + nextX;
        if (visited[next] || !matches(next * 4)) return;
        visited[next] = 2;
        queue[tail++] = next;
      };
      enqueueHole(x + 1, y); enqueueHole(x - 1, y); enqueueHole(x, y + 1); enqueueHole(x, y - 1);
    }
    if (tail < minimumHoleArea) {
      for (let index = 0; index < tail; index += 1) visited[queue[index]] = 3;
    }
  }

  for (let pixel = 0; pixel < total; pixel += 1) {
    if (visited[pixel] !== 1 && visited[pixel] !== 2) continue;
    const index = pixel * 4;
    const channel = matteMode === "black"
      ? Math.max(data[index], data[index + 1], data[index + 2])
      : 255 - Math.min(data[index], data[index + 1], data[index + 2]);
    data[index + 3] = Math.max(0, Math.min(255, Math.round((channel - 5) * 12)));
  }
  return PNG.sync.write(png);
}

function detectMatteMode(bytes) {
  const png = PNG.sync.read(bytes);
  const samples = [];
  const push = (x, y) => {
    const index = (y * png.width + x) * 4;
    samples.push(0.2126 * png.data[index] + 0.7152 * png.data[index + 1] + 0.0722 * png.data[index + 2]);
  };
  const stepX = Math.max(1, Math.floor(png.width / 48));
  const stepY = Math.max(1, Math.floor(png.height / 48));
  for (let x = 0; x < png.width; x += stepX) { push(x, 0); push(x, png.height - 1); }
  for (let y = 0; y < png.height; y += stepY) { push(0, y); push(png.width - 1, y); }
  const average = samples.reduce((sum, value) => sum + value, 0) / Math.max(1, samples.length);
  return average < 128 ? "black" : "white";
}

function cutoutTypography(input) {
  const parsed = parseDataUrl(input.image.dataUrl);
  if (sniffImageMime(parsed.bytes) !== "image/png") throw new Error("文字抠图只支持 PNG 实底稿。");
  const matte = detectMatteMode(parsed.bytes);
  const bytes = removeConnectedMatte(parsed.bytes, matte);
  return { matte, result: makeAsset(randomUUID(), "typography", { bytes, mimeType: "image/png" }) };
}

function makeAsset(jobId, kind, image, source = "generated") {
  const extension = image.mimeType === "image/jpeg" ? "jpg" : image.mimeType === "image/webp" ? "webp" : "png";
  return {
    id: randomUUID(), kind, format: extension === "jpg" ? "jpeg" : extension, source,
    fileName: `${kind}-${jobId.slice(0, 8)}.${extension}`,
    mimeType: image.mimeType, sizeBytes: image.bytes.length,
    url: `data:${image.mimeType};base64,${image.bytes.toString("base64")}`,
    createdAt: new Date().toISOString(),
  };
}

async function requestExternalAdapter(jobId, input) {
  const response = await fetch(externalAdapterUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(adapterToken ? { Authorization: `Bearer ${adapterToken}` } : {}) },
    body: JSON.stringify({ jobId, input }),
    signal: AbortSignal.timeout(180_000),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.message || `Adapter returned ${response.status}.`);
  return payload;
}

async function createTypographyJob(input) {
  const job = { id: randomUUID(), type: "typography", status: "queued", createdAt: new Date().toISOString(), input };
  jobs.set(job.id, job);
  if (!externalAdapterUrl && !ofoxApiKey) {
    job.status = "failed";
    job.error = { code: "provider_not_configured", message: "未配置 OFOX_API_KEY。" };
    return job;
  }
  job.status = "processing";
  try {
    if (externalAdapterUrl) {
      const payload = await requestExternalAdapter(job.id, input);
      job.status = payload.status === "queued" ? "queued" : "completed";
      job.result = payload.result;
      return job;
    }
    const glyphFont = input.references.font ? desaturatePngReference(input.references.font) : undefined;
    const shapeOnlyTypography = input.references.typography ? desaturatePngReference(input.references.typography) : undefined;
    const semanticEnvironment = input.references.color ? desaturatePngReference(input.references.color) : undefined;
    const orderedReferences = input.mode === "refine"
      ? [shapeOnlyTypography, semanticEnvironment].filter(Boolean)
      : input.studyPoster
        ? [semanticEnvironment, input.references.layout].filter(Boolean)
        : [glyphFont, semanticEnvironment, input.references.layout].filter(Boolean);
    let image;
    try {
      image = await requestOfoxImage({ jobId: job.id, prompt: typographyPrompt(input), size: textLayerSize, outputFormat: "png", references: orderedReferences });
    } catch (error) {
      if (orderedReferences.length <= 1) throw error;
      const fallbackInput = {
        ...input,
        references: {
          ...input.references,
          color: input.mode === "create" && !input.references.font ? input.references.color : undefined,
          font: input.mode === "create" ? input.references.font : undefined,
          layout: undefined,
        },
      };
      image = await requestOfoxImage({ jobId: job.id, prompt: `${typographyPrompt(fallbackInput)}\n\nCompatibility retry: preserve the remaining reference's authority and follow the written typography route.`, size: textLayerSize, outputFormat: "png", references: orderedReferences.slice(0, 1) });
    }
    if (image.mimeType !== "image/png") throw new Error("OFOX 文字图层未返回 PNG 实底稿。");
    const material = input.deferMaterial ? { image } : applyTypographyMaterial(image, input.references.color, input.matte);
    image = material.image;
    job.renderStrategy = input.deferMaterial ? "grayscale-master-deferred" : material.palette ? "grayscale-master-with-local-material" : "grayscale-master";
    if (material.palette) job.appliedPalette = material.palette;
    if (material.profile) job.analysisSummary = { source: input.studyPoster ? "finished-poster" : "color-reference", ...material.profile };
    job.result = makeAsset(job.id, "typography-draft", image);
    job.status = "completed";
  } catch (error) {
    job.status = "failed";
    job.error = { code: "provider_request_failed", message: error instanceof Error ? error.message : "文字图层 Provider 请求失败。" };
  }
  return job;
}

async function createBackgroundJob(input) {
  const job = { id: randomUUID(), type: "background", status: "queued", createdAt: new Date().toISOString(), input };
  jobs.set(job.id, job);
  if (!ofoxApiKey) {
    job.status = "failed";
    job.error = { code: "provider_not_configured", message: "未配置 OFOX_API_KEY。" };
    return job;
  }
  job.status = "processing";
  try {
    const image = await requestOfoxImage({ jobId: job.id, prompt: backgroundPrompt(input), size: stickerSpecs[input.kind].size, outputFormat: "jpeg", references: [input.reference] });
    job.result = makeAsset(job.id, input.kind, image);
    job.status = "completed";
  } catch (error) {
    job.status = "failed";
    job.error = { code: "provider_request_failed", message: error instanceof Error ? error.message : "背景 Provider 请求失败。" };
  }
  return job;
}

const server = createServer(async (request, response) => {
  if (request.method === "OPTIONS") return sendOptions(request, response);
  const url = new URL(request.url ?? "/", `http://${request.headers.host ?? host}`);
  if (request.method === "GET" && url.pathname === "/health") {
    return sendJson(request, response, 200, {
      status: "ok", service: "live-sticker-api", mode: "production", version: "0.5.0", timestamp: new Date().toISOString(),
      providers: {
        imageGeneration: ofoxApiKey ? "ready" : "not-configured",
        taskPlanning: "not-configured",
        typographyGeneration: externalAdapterUrl || ofoxApiKey ? "ready" : "not-configured",
        typographyProvider: "ofox",
        typographyMode: externalAdapterUrl ? "external-adapter" : ofoxApiKey ? "built-in" : "not-configured",
      },
    });
  }
  if (request.method === "POST" && url.pathname === "/v1/live-sticker/typography/jobs") {
    try {
      const validation = validateTypographyRequest(await readJson(request));
      if (validation.error) return sendJson(request, response, 400, { error: "invalid_typography_request", message: validation.error });
      const job = await createTypographyJob(validation.value);
      return sendJson(request, response, job.status === "failed" ? 503 : 202, job);
    } catch (error) {
      return sendJson(request, response, 400, { error: "invalid_request", message: error instanceof Error && error.message === "request_too_large" ? "请求体超过 32MB，请压缩参考图片。" : "请求不是有效的 JSON。" });
    }
  }
  if (request.method === "POST" && url.pathname === "/v1/live-sticker/typography/cutout") {
    try {
      const validation = validateTypographyCutoutRequest(await readJson(request));
      if (validation.error) return sendJson(request, response, 400, { error: "invalid_cutout_request", message: validation.error });
      return sendJson(request, response, 200, cutoutTypography(validation.value));
    } catch (error) {
      return sendJson(request, response, 400, { error: "cutout_failed", message: error instanceof Error ? error.message : "文字抠图失败。" });
    }
  }
  if (request.method === "POST" && url.pathname === "/v1/live-sticker/typography/materialize") {
    try {
      const validation = validateTypographyMaterialRequest(await readJson(request));
      if (validation.error) return sendJson(request, response, 400, { error: "invalid_material_request", message: validation.error });
      return sendJson(request, response, 200, materializeTypography(validation.value));
    } catch (error) {
      return sendJson(request, response, 400, { error: "materialize_failed", message: error instanceof Error ? error.message : "位置配色失败。" });
    }
  }
  if (request.method === "POST" && url.pathname === "/v1/live-sticker/background/jobs") {
    try {
      const validation = validateBackgroundRequest(await readJson(request));
      if (validation.error) return sendJson(request, response, 400, { error: "invalid_background_request", message: validation.error });
      const job = await createBackgroundJob(validation.value);
      return sendJson(request, response, job.status === "failed" ? 503 : 202, job);
    } catch (error) {
      return sendJson(request, response, 400, { error: "invalid_request", message: error instanceof Error && error.message === "request_too_large" ? "请求体超过 32MB，请压缩参考图片。" : "请求不是有效的 JSON。" });
    }
  }
  const jobMatch = url.pathname.match(/^\/v1\/live-sticker\/(?:typography|background)\/jobs\/([\w-]+)$/);
  if (request.method === "GET" && jobMatch) {
    const job = jobs.get(jobMatch[1]);
    return job ? sendJson(request, response, 200, job) : sendJson(request, response, 404, { error: "job_not_found", message: "未找到该生成任务。" });
  }
  return sendJson(request, response, 404, { error: "not_found", message: "Available endpoints: GET /health, POST /v1/live-sticker/background/jobs, POST /v1/live-sticker/typography/jobs, POST /v1/live-sticker/typography/cutout." });
});

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  server.listen(port, host, () => console.log(`live-sticker-api listening at http://${host}:${port}`));
}

export { applyPositionAwareTypographyMaterial, applyTypographyMaterial, cutoutTypography, detectMatteMode, removeConnectedMatte, typographyPrompt };
