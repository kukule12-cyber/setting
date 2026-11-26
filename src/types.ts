export type AuthMode = 'env' | 'claimed' | 'unclaimed';

export type ImageMime = 'image/jpeg' | 'image/webp' | 'image/png';

export type CropMode = 'cover' | 'contain' | 'stretch';

export type CompressionMode = 'quality' | 'targetKb';

export interface AspectRatioPreset {
  id: string;
  label: string;
  subLabel: string;
  ratio: number | null; // null means original image ratio
}

export interface SourceImage {
  name: string;
  width: number;
  height: number;
  sizeBytes: number;
  mimeType: string;
  objectUrl: string;
  element: HTMLImageElement;
}

export interface EditSettings {
  aspectPresetId: string;
  customRatioW: number;
  customRatioH: number;
  cropMode: CropMode;
  focalX: number; // 0..1
  focalY: number; // 0..1
  padColor: string; // 'transparent' | hex color
  width: number;
  height: number;
  lockAspect: boolean;
  format: ImageMime;
  compressionMode: CompressionMode;
  quality: number; // 1..100
  targetKb: number;
  autoDownscaleForTarget: boolean;
}

export interface ProcessedResult {
  blob: Blob;
  objectUrl: string;
  width: number;
  height: number;
  sizeBytes: number;
  effectiveQuality: number;
  targetMet: boolean;
  note?: string;
}

export interface SavedPhotoRecord {
  id: string;
  title: string;
  originalName: string;
  originalWidth: number;
  originalHeight: number;
  originalSizeBytes: number;
  width: number;
  height: number;
  sizeBytes: number;
  format: ImageMime;
  aspectRatioLabel: string;
  cropMode: CropMode;
  quality: number;
  targetKb: number | null;
  fileName: string;
  createdAt: string;
  updatedAt: string;
}
