import type {
  AspectRatioPreset,
  EditSettings,
  ImageMime,
  ProcessedResult,
  SourceImage,
} from '../types.ts';

export const ASPECT_PRESETS: AspectRatioPreset[] = [
  {id: 'original', label: '원본 비율', subLabel: '유지', ratio: null},
  {id: '1:1', label: '1:1', subLabel: '정사각형', ratio: 1},
  {id: '4:3', label: '4:3', subLabel: '표준', ratio: 4 / 3},
  {id: '3:2', label: '3:2', subLabel: 'DSLR', ratio: 3 / 2},
  {id: '16:9', label: '16:9', subLabel: '와이드', ratio: 16 / 9},
  {id: '9:16', label: '9:16', subLabel: '세로 릴스', ratio: 9 / 16},
  {id: '4:5', label: '4:5', subLabel: '피드 세로', ratio: 4 / 5},
  {id: '21:9', label: '21:9', subLabel: '시네마', ratio: 21 / 9},
  {id: 'custom', label: '직접 비율', subLabel: '커스텀', ratio: null},
];

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${kb.toFixed(kb >= 100 ? 0 : 1)} KB`;
  const mb = kb / 1024;
  return `${mb.toFixed(2)} MB`;
}

export function formatSavingsPercent(originalBytes: number, nextBytes: number): string {
  if (originalBytes <= 0) return '0%';
  const diff = ((nextBytes - originalBytes) / originalBytes) * 100;
  const rounded = diff.toFixed(1);
  return diff <= 0 ? `${rounded}%` : `+${rounded}%`;
}

export function formatShortFormat(mime: ImageMime): string {
  if (mime === 'image/webp') return 'WebP';
  if (mime === 'image/jpeg') return 'JPEG';
  return 'PNG';
}

export function formatExt(mime: ImageMime): string {
  if (mime === 'image/webp') return 'webp';
  if (mime === 'image/jpeg') return 'jpg';
  return 'png';
}

export function resolveTargetAspectRatio(
  settings: Pick<EditSettings, 'aspectPresetId' | 'customRatioW' | 'customRatioH'>,
  source: Pick<SourceImage, 'width' | 'height'>,
): number {
  if (settings.aspectPresetId === 'original') {
    return source.width / source.height;
  }
  if (settings.aspectPresetId === 'custom') {
    const w = Math.max(1, settings.customRatioW || 1);
    const h = Math.max(1, settings.customRatioH || 1);
    return w / h;
  }
  const found = ASPECT_PRESETS.find((p) => p.id === settings.aspectPresetId);
  if (found && found.ratio !== null) {
    return found.ratio;
  }
  return source.width / source.height;
}

export function getAspectRatioLabel(
  settings: Pick<EditSettings, 'aspectPresetId' | 'customRatioW' | 'customRatioH'>,
): string {
  if (settings.aspectPresetId === 'custom') {
    return `${Math.max(1, settings.customRatioW)}:${Math.max(1, settings.customRatioH)}`;
  }
  const found = ASPECT_PRESETS.find((p) => p.id === settings.aspectPresetId);
  return found ? found.label : '원본 비율';
}

export function loadImageFromBlob(blob: Blob, name: string): Promise<SourceImage> {
  return new Promise((resolve, reject) => {
    const objectUrl = URL.createObjectURL(blob);
    const img = new Image();
    img.onload = () => {
      resolve({
        name,
        width: img.naturalWidth,
        height: img.naturalHeight,
        sizeBytes: blob.size,
        mimeType: blob.type || 'image/jpeg',
        objectUrl,
        element: img,
      });
    };
    img.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      reject(new Error('이미지를 디코딩할 수 없습니다. 지원되는 사진 파일인지 확인해 주세요.'));
    };
    img.src = objectUrl;
  });
}

export function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === 'string') {
        resolve(reader.result);
      } else {
        reject(new Error('이미지 인코딩에 실패했습니다.'));
      }
    };
    reader.onerror = () => reject(new Error('이미지를 읽는 중 오류가 발생했습니다.'));
    reader.readAsDataURL(blob);
  });
}

function canvasToBlob(
  canvas: HTMLCanvasElement,
  mime: ImageMime,
  quality: number,
): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (!blob) {
          reject(new Error('캔버스 이미지 변환에 실패했습니다.'));
          return;
        }
        resolve(blob);
      },
      mime,
      mime === 'image/png' ? undefined : Math.min(1, Math.max(0.01, quality)),
    );
  });
}

function renderCroppedCanvas(
  source: SourceImage,
  targetW: number,
  targetH: number,
  settings: EditSettings,
): HTMLCanvasElement {
  const safeW = Math.max(1, Math.round(targetW));
  const safeH = Math.max(1, Math.round(targetH));
  const canvas = document.createElement('canvas');
  canvas.width = safeW;
  canvas.height = safeH;
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    throw new Error('2D 그래픽 컨텍스트를 초기화할 수 없습니다.');
  }

  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';

  const supportsAlpha = settings.format === 'image/png' || settings.format === 'image/webp';
  if (settings.cropMode === 'contain') {
    if (settings.padColor !== 'transparent' || !supportsAlpha) {
      ctx.fillStyle = settings.padColor === 'transparent' ? '#ffffff' : settings.padColor;
      ctx.fillRect(0, 0, safeW, safeH);
    }
  } else if (!supportsAlpha) {
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, safeW, safeH);
  }

  const srcW = source.width;
  const srcH = source.height;

  let sx = 0;
  let sy = 0;
  let sw = srcW;
  let sh = srcH;
  let dx = 0;
  let dy = 0;
  let dw = safeW;
  let dh = safeH;

  if (settings.cropMode === 'cover') {
    const srcAspect = srcW / srcH;
    const dstAspect = safeW / safeH;
    if (srcAspect > dstAspect) {
      sw = srcH * dstAspect;
      sh = srcH;
      sx = (srcW - sw) * settings.focalX;
      sy = 0;
    } else if (srcAspect < dstAspect) {
      sw = srcW;
      sh = srcW / dstAspect;
      sx = 0;
      sy = (srcH - sh) * settings.focalY;
    }
  } else if (settings.cropMode === 'contain') {
    const srcAspect = srcW / srcH;
    const dstAspect = safeW / safeH;
    if (srcAspect > dstAspect) {
      dw = safeW;
      dh = safeW / srcAspect;
      dx = 0;
      dy = (safeH - dh) / 2;
    } else {
      dh = safeH;
      dw = safeH * srcAspect;
      dx = (safeW - dw) / 2;
      dy = 0;
    }
  }

  // Step-down resampling when shrinking significantly to keep edges sharp
  if (sw > dw * 2 || sh > dh * 2) {
    const stepCanvas = document.createElement('canvas');
    let curW = Math.max(1, Math.round(sw));
    let curH = Math.max(1, Math.round(sh));
    stepCanvas.width = curW;
    stepCanvas.height = curH;
    const stepCtx = stepCanvas.getContext('2d');
    if (stepCtx) {
      stepCtx.imageSmoothingEnabled = true;
      stepCtx.imageSmoothingQuality = 'high';
      stepCtx.drawImage(source.element, sx, sy, sw, sh, 0, 0, curW, curH);

      while (curW * 0.5 > dw && curH * 0.5 > dh) {
        const nextW = Math.max(Math.round(curW * 0.5), dw);
        const nextH = Math.max(Math.round(curH * 0.5), dh);
        const tmp = document.createElement('canvas');
        tmp.width = nextW;
        tmp.height = nextH;
        const tmpCtx = tmp.getContext('2d');
        if (!tmpCtx) break;
        tmpCtx.imageSmoothingEnabled = true;
        tmpCtx.imageSmoothingQuality = 'high';
        tmpCtx.drawImage(stepCanvas, 0, 0, curW, curH, 0, 0, nextW, nextH);
        stepCanvas.width = nextW;
        stepCanvas.height = nextH;
        stepCtx.drawImage(tmp, 0, 0);
        curW = nextW;
        curH = nextH;
      }

      ctx.drawImage(stepCanvas, 0, 0, curW, curH, dx, dy, dw, dh);
      return canvas;
    }
  }

  ctx.drawImage(source.element, sx, sy, sw, sh, dx, dy, dw, dh);
  return canvas;
}

export async function processImage(
  source: SourceImage,
  settings: EditSettings,
): Promise<ProcessedResult> {
  const targetW = Math.max(1, Math.min(8000, Math.round(settings.width)));
  const targetH = Math.max(1, Math.min(8000, Math.round(settings.height)));

  if (settings.compressionMode === 'quality') {
    const canvas = renderCroppedCanvas(source, targetW, targetH, settings);
    const q = Math.max(1, Math.min(100, settings.quality)) / 100;
    const blob = await canvasToBlob(canvas, settings.format, q);
    return {
      blob,
      objectUrl: URL.createObjectURL(blob),
      width: targetW,
      height: targetH,
      sizeBytes: blob.size,
      effectiveQuality: settings.format === 'image/png' ? 100 : Math.round(q * 100),
      targetMet: true,
      note:
        settings.format === 'image/png'
          ? 'PNG는 무손실 포맷이므로 용량을 줄이려면 WebP/JPEG를 선택하거나 해상도를 낮추세요.'
          : undefined,
    };
  }

  // Target KB mode
  const targetBytes = Math.max(5, settings.targetKb) * 1024;
  let curW = targetW;
  let curH = targetH;
  let bestBlob: Blob | null = null;
  let bestQuality = settings.quality;

  const solveQualityForCanvas = async (canvas: HTMLCanvasElement) => {
    if (settings.format === 'image/png') {
      const b = await canvasToBlob(canvas, 'image/png', 1);
      return {blob: b, quality: 100};
    }

    let low = 0.05;
    let high = 0.96;
    let candidateBlob = await canvasToBlob(canvas, settings.format, high);
    let candidateQ = Math.round(high * 100);

    if (candidateBlob.size <= targetBytes) {
      return {blob: candidateBlob, quality: candidateQ};
    }

    const minBlob = await canvasToBlob(canvas, settings.format, low);
    if (minBlob.size > targetBytes) {
      return {blob: minBlob, quality: Math.round(low * 100)};
    }

    candidateBlob = minBlob;
    candidateQ = Math.round(low * 100);

    for (let i = 0; i < 7; i += 1) {
      const mid = (low + high) / 2;
      const midBlob = await canvasToBlob(canvas, settings.format, mid);
      if (midBlob.size <= targetBytes) {
        candidateBlob = midBlob;
        candidateQ = Math.round(mid * 100);
        low = mid;
      } else {
        high = mid;
      }
    }

    return {blob: candidateBlob, quality: candidateQ};
  };

  const initialCanvas = renderCroppedCanvas(source, curW, curH, settings);
  const firstPass = await solveQualityForCanvas(initialCanvas);
  bestBlob = firstPass.blob;
  bestQuality = firstPass.quality;

  if (bestBlob.size > targetBytes && settings.autoDownscaleForTarget) {
    for (let step = 0; step < 6 && bestBlob.size > targetBytes; step += 1) {
      const ratio = Math.sqrt(targetBytes / bestBlob.size) * 0.92;
      const scaleFactor = Math.min(0.88, Math.max(0.45, ratio));
      const nextW = Math.max(32, Math.round(curW * scaleFactor));
      const nextH = Math.max(32, Math.round(curH * scaleFactor));
      if (nextW === curW && nextH === curH) break;
      curW = nextW;
      curH = nextH;
      const scaledCanvas = renderCroppedCanvas(source, curW, curH, settings);
      const pass = await solveQualityForCanvas(scaledCanvas);
      bestBlob = pass.blob;
      bestQuality = pass.quality;
    }
  }

  const targetMet = bestBlob.size <= targetBytes;
  let note: string | undefined;
  if (!targetMet) {
    note =
      settings.format === 'image/png'
        ? 'PNG 무손실 포맷 특성상 목표 용량에 도달하지 못했습니다. WebP 또는 JPEG를 권장합니다.'
        : '최소 품질에서도 목표 용량을 초과했습니다. 해상도 자동 축소를 켜거나 크기를 줄여보세요.';
  } else if (curW !== targetW || curH !== targetH) {
    note = `목표 용량(${settings.targetKb} KB)에 맞추기 위해 해상도가 ${curW}×${curH}로 자동 조정되었습니다.`;
  }

  return {
    blob: bestBlob,
    objectUrl: URL.createObjectURL(bestBlob),
    width: curW,
    height: curH,
    sizeBytes: bestBlob.size,
    effectiveQuality: bestQuality,
    targetMet,
    note,
  };
}
