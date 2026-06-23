export type StickerAssetKind =
  | "reference"
  | "font-reference"
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
}

export type TypographyPresetKey = "elegant-songti" | "expressive-calligraphy" | "rounded-cute" | "custom-reference";

export interface TypographySettings {
  fontPresetKey: TypographyPresetKey;
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
  mode: "foundation";
  version: string;
  timestamp: string;
  providers: {
    imageGeneration: ProviderReadiness;
    taskPlanning: ProviderReadiness;
  };
}
