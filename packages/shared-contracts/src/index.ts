export type StickerAssetKind =
  | "reference"
  | "color-reference"
  | "font-reference"
  | "layout-reference"
  | "top"
  | "bottom"
  | "side"
  | "typography"
  | "base-image"
  | "composition";

export type StickerAssetFormat = "jpeg" | "png";

export interface StickerAsset {
  id: string;
  kind: StickerAssetKind;
  format: StickerAssetFormat;
  source: "generated" | "uploaded";
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  trimmed?: boolean;
  url: string;
  createdAt: string;
}

export interface StickerProject {
  id: string;
  name: string;
  assets: StickerAsset[];
  composition: CompositionDocument;
  createdAt: string;
  updatedAt: string;
}

export interface TextLayerInput {
  text: string;
  colorReferenceAssetId?: string;
  fontReferenceAssetId?: string;
  layoutReferenceAssetId?: string;
}

export type TypographyPresetKey = "elegant-songti" | "expressive-calligraphy" | "rounded-cute" | "custom-reference";
export type TypographyGenerationMode = "create" | "refine";
export type TypographyMatte = "white" | "black";

export interface TypographySettings {
  fontPresetKey: TypographyPresetKey;
  text: string;
  instruction: string;
  mode: TypographyGenerationMode;
  matte: TypographyMatte;
}

export interface TypographyReferenceInput {
  assetId?: string;
  mimeType?: string;
  dataUrl?: string;
}

export interface TypographyGenerationRequest {
  text: string;
  fontPresetKey: TypographyPresetKey;
  mode: TypographyGenerationMode;
  matte: TypographyMatte;
  instruction?: string;
  references?: {
    color?: TypographyReferenceInput;
    font?: TypographyReferenceInput;
    layout?: TypographyReferenceInput;
    typography?: TypographyReferenceInput;
  };
}

export interface TypographyGenerationJob {
  id: string;
  status: "queued" | "processing" | "completed" | "failed";
  createdAt: string;
  input: TypographyGenerationRequest;
  result?: StickerAsset;
  error?: { code: string; message: string };
}

export type StickerBackgroundKind = "top" | "bottom" | "side";

export interface BackgroundGenerationRequest {
  kind: StickerBackgroundKind;
  prompt?: string;
  reference?: TypographyReferenceInput;
}

export interface BackgroundGenerationJob {
  id: string;
  status: "queued" | "processing" | "completed" | "failed";
  createdAt: string;
  input: BackgroundGenerationRequest;
  result?: StickerAsset;
  error?: { code: string; message: string };
}

export type CompositionLayerKind = "base-image" | "top" | "bottom" | "side" | "typography";

export interface CompositionMask {
  mode: "default" | "manual";
  feather: number;
  fadePath: Array<{ x: number; y: number }>;
  edgeTexture: "none" | "flame" | "cloud";
}

export interface CompositionLayer {
  id: string;
  assetId: string;
  kind: CompositionLayerKind;
  x: number;
  y: number;
  width: number;
  height: number;
  opacity: number;
  visible: boolean;
  zIndex: number;
  mask: CompositionMask;
}

export interface CompositionDocument {
  aspectRatio: "9:16";
  selectedLayerId?: string;
  layers: CompositionLayer[];
  updatedAt: string;
}

export type ProviderReadiness = "not-configured" | "ready" | "unavailable";

export interface CoreHealth {
  status: "ok";
  service: "live-sticker-api";
  mode: "foundation" | "staging" | "production";
  version: string;
  timestamp: string;
  providers: {
    imageGeneration: ProviderReadiness;
    taskPlanning: ProviderReadiness;
    typographyGeneration?: ProviderReadiness;
    typographyProvider?: "ofox";
    typographyMode?: "built-in" | "external-adapter" | "not-configured";
  };
}
