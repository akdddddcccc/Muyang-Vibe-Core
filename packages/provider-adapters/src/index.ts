export type ImageProviderName = "ofox" | "openai";

export interface ImageGenerationAdapter {
  readonly provider: ImageProviderName;
  isConfigured(): boolean;
}

export interface TaskMapAdapter {
  readonly provider: "deepseek";
  isConfigured(): boolean;
}
