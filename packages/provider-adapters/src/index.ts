export type ImageProviderName = "ofox" | "openai";

export interface ImageGenerationAdapter {
  readonly provider: ImageProviderName;
  isConfigured(): boolean;
}

export interface TypographyGenerationAdapter extends ImageGenerationAdapter {
  generateTypography(input: {
    text: string;
    fontPresetKey: "elegant-songti" | "expressive-calligraphy" | "rounded-cute" | "custom-reference";
    references?: {
      color?: { assetId?: string; mimeType?: string; dataUrl?: string };
      font?: { assetId?: string; mimeType?: string; dataUrl?: string };
      layout?: { assetId?: string; mimeType?: string; dataUrl?: string };
    };
  }): Promise<{ mimeType: "image/png"; dataUrl: string }>;
}

export interface TaskMapAdapter {
  readonly provider: "deepseek";
  isConfigured(): boolean;
}
