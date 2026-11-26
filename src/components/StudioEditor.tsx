import {useCallback, useEffect, useMemo, useRef, useState} from 'react';
import {
  ArrowLeftRight,
  Check,
  Download,
  FolderOpen,
  Lock,
  RotateCcw,
  Save,
  Unlock,
  Upload,
} from 'lucide-react';
import type {
  CropMode,
  EditSettings,
  ImageMime,
  ProcessedResult,
  SavedPhotoRecord,
  SourceImage,
} from '../types.ts';
import {saveProcessedPhoto} from '../utils/api.ts';
import {
  ASPECT_PRESETS,
  blobToDataUrl,
  formatBytes,
  formatExt,
  formatSavingsPercent,
  formatShortFormat,
  getAspectRatioLabel,
  loadImageFromBlob,
  processImage,
  resolveTargetAspectRatio,
} from '../utils/imageProcessor.ts';
import {SAMPLE_PHOTOS} from '../utils/samples.ts';

interface StudioEditorProps {
  token: string;
  source: SourceImage | null;
  onSourceLoaded: (next: SourceImage) => void;
  onSaved: (record: SavedPhotoRecord) => void;
  onOpenVault: () => void;
  onAuthExpired: () => void;
}

type PreviewViewMode = 'after' | 'split' | 'before';

function stripExtension(name: string): string {
  return name.replace(/\.[^/.]+$/, '');
}

function createInitialSettings(src: SourceImage): EditSettings {
  return {
    aspectPresetId: 'original',
    customRatioW: src.width,
    customRatioH: src.height,
    cropMode: 'cover',
    focalX: 0.5,
    focalY: 0.5,
    padColor: '#ffffff',
    width: src.width,
    height: src.height,
    lockAspect: true,
    format: 'image/webp',
    compressionMode: 'quality',
    quality: 85,
    targetKb: 250,
    autoDownscaleForTarget: true,
  };
}

export function StudioEditor({
  token,
  source,
  onSourceLoaded,
  onSaved,
  onOpenVault,
  onAuthExpired,
}: StudioEditorProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [settings, setSettings] = useState<EditSettings | null>(
    source ? createInitialSettings(source) : null,
  );
  const [title, setTitle] = useState(source ? stripExtension(source.name) : '');
  const [result, setResult] = useState<ProcessedResult | null>(null);
  const [processing, setProcessing] = useState(false);
  const [loadingSource, setLoadingSource] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [previewMode, setPreviewMode] = useState<PreviewViewMode>('after');
  const [splitPercent, setSplitPercent] = useState(50);
  const [isDraggingOver, setIsDraggingOver] = useState(false);
  const [isPanningFocal, setIsPanningFocal] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveMessage, setSaveMessage] = useState<{type: 'ok' | 'err'; text: string} | null>(
    null,
  );

  // Sync settings when a new source is passed from outside (e.g. "Load from Vault")
  useEffect(() => {
    if (!source) {
      setSettings(null);
      setResult((prev) => {
        if (prev) URL.revokeObjectURL(prev.objectUrl);
        return null;
      });
      return;
    }
    setSettings(createInitialSettings(source));
    setTitle(stripExtension(source.name));
    setSaveMessage(null);
  }, [source]);

  // Debounced Canvas image processing
  useEffect(() => {
    if (!source || !settings) return;
    let cancelled = false;
    setProcessing(true);

    const timer = window.setTimeout(async () => {
      try {
        const nextResult = await processImage(source, settings);
        if (cancelled) {
          URL.revokeObjectURL(nextResult.objectUrl);
          return;
        }
        setResult((prev) => {
          if (prev) URL.revokeObjectURL(prev.objectUrl);
          return nextResult;
        });
      } catch (err) {
        if (!cancelled) {
          setLoadError(
            err instanceof Error ? err.message : '이미지 변환 중 오류가 발생했습니다.',
          );
        }
      } finally {
        if (!cancelled) setProcessing(false);
      }
    }, 110);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [source, settings]);

  const handleFileBlob = useCallback(
    async (blob: Blob, name: string) => {
      setLoadError(null);
      setLoadingSource(true);
      try {
        const loaded = await loadImageFromBlob(blob, name);
        onSourceLoaded(loaded);
      } catch (err) {
        setLoadError(
          err instanceof Error ? err.message : '이미지를 불러올 수 없습니다.',
        );
      } finally {
        setLoadingSource(false);
      }
    },
    [onSourceLoaded],
  );

  const handleFileInput = (files: FileList | null) => {
    if (!files || files.length === 0) return;
    const file = files[0];
    if (!file.type.startsWith('image/')) {
      setLoadError('이미지 파일(JPG, PNG, WebP 등)만 업로드할 수 있습니다.');
      return;
    }
    void handleFileBlob(file, file.name);
  };

  const handleSampleSelect = async (url: string, fileName: string) => {
    setLoadError(null);
    setLoadingSource(true);
    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error('샘플 이미지를 불러오지 못했습니다.');
      const blob = await res.blob();
      await handleFileBlob(blob, fileName);
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : '샘플 로딩 실패');
      setLoadingSource(false);
    }
  };

  const targetAspect = useMemo(() => {
    if (!source || !settings) return 1;
    return resolveTargetAspectRatio(settings, source);
  }, [source, settings]);

  const isCroppingActive = useMemo(() => {
    if (!source || !settings) return false;
    if (settings.cropMode !== 'cover') return false;
    const srcAspect = source.width / source.height;
    return Math.abs(srcAspect - targetAspect) > 0.01;
  }, [source, settings, targetAspect]);

  const updateSettings = (updater: (prev: EditSettings) => EditSettings) => {
    setSaveMessage(null);
    setSettings((prev) => (prev ? updater(prev) : prev));
  };

  const handleAspectPreset = (presetId: string) => {
    if (!source) return;
    updateSettings((prev) => {
      const next: EditSettings = {...prev, aspectPresetId: presetId, lockAspect: true};
      const ratio = resolveTargetAspectRatio(next, source);
      const nextHeight = Math.max(1, Math.round(prev.width / ratio));
      return {...next, height: nextHeight};
    });
  };

  const handleSwapAspect = () => {
    if (!source || !settings) return;
    updateSettings((prev) => {
      const currentRatio = resolveTargetAspectRatio(prev, source);
      const inverted = 1 / currentRatio;
      const nextHeight = Math.max(1, Math.round(prev.width / inverted));
      if (prev.aspectPresetId === 'custom') {
        return {
          ...prev,
          customRatioW: prev.customRatioH,
          customRatioH: prev.customRatioW,
          height: nextHeight,
        };
      }
      // Switch to matching preset if available, otherwise custom
      const swapMap: Record<string, string> = {
        '16:9': '9:16',
        '9:16': '16:9',
      };
      if (swapMap[prev.aspectPresetId]) {
        const nextId = swapMap[prev.aspectPresetId];
        return {...prev, aspectPresetId: nextId, height: nextHeight};
      }
      const wBase = Math.round(inverted * 100);
      return {
        ...prev,
        aspectPresetId: 'custom',
        customRatioW: wBase,
        customRatioH: 100,
        height: nextHeight,
      };
    });
  };

  const handleWidthChange = (rawVal: string) => {
    const val = Math.max(1, Math.min(8000, Number(rawVal) || 1));
    if (!source) return;
    updateSettings((prev) => {
      if (!prev.lockAspect) {
        return {...prev, width: val};
      }
      const ratio = resolveTargetAspectRatio(prev, source);
      return {...prev, width: val, height: Math.max(1, Math.round(val / ratio))};
    });
  };

  const handleHeightChange = (rawVal: string) => {
    const val = Math.max(1, Math.min(8000, Number(rawVal) || 1));
    if (!source) return;
    updateSettings((prev) => {
      if (!prev.lockAspect) {
        return {...prev, height: val};
      }
      const ratio = resolveTargetAspectRatio(prev, source);
      return {...prev, height: val, width: Math.max(1, Math.round(val * ratio))};
    });
  };

  const handleScalePercent = (percent: number) => {
    if (!source) return;
    updateSettings((prev) => {
      const ratio = resolveTargetAspectRatio(prev, source);
      const nextW = Math.max(1, Math.round((source.width * percent) / 100));
      const nextH = prev.lockAspect
        ? Math.max(1, Math.round(nextW / ratio))
        : Math.max(1, Math.round((source.height * percent) / 100));
      return {...prev, width: nextW, height: nextH};
    });
  };

  const handlePresetWidth = (targetW: number) => {
    if (!source) return;
    updateSettings((prev) => {
      const ratio = resolveTargetAspectRatio(prev, source);
      return {
        ...prev,
        width: targetW,
        height: Math.max(1, Math.round(targetW / ratio)),
      };
    });
  };

  const handleReset = () => {
    if (!source) return;
    setSettings(createInitialSettings(source));
    setTitle(stripExtension(source.name));
    setSaveMessage(null);
  };

  const handleSaveToVault = async () => {
    if (!source || !settings || !result) return;
    setSaving(true);
    setSaveMessage(null);
    try {
      const dataUrl = await blobToDataUrl(result.blob);
      const saved = await saveProcessedPhoto(token, {
        title: title.trim() || stripExtension(source.name) || '편집된 사진',
        originalName: source.name,
        originalWidth: source.width,
        originalHeight: source.height,
        originalSizeBytes: source.sizeBytes,
        width: result.width,
        height: result.height,
        format: settings.format,
        aspectRatioLabel: getAspectRatioLabel(settings),
        cropMode: settings.cropMode,
        quality: result.effectiveQuality,
        targetKb: settings.compressionMode === 'targetKb' ? settings.targetKb : null,
        imageDataUrl: dataUrl,
      });
      onSaved(saved);
      setSaveMessage({type: 'ok', text: '보관함에 저장되었습니다.'});
    } catch (err) {
      const msg = err instanceof Error ? err.message : '저장에 실패했습니다.';
      if (msg.includes('인증')) {
        onAuthExpired();
        return;
      }
      setSaveMessage({type: 'err', text: msg});
    } finally {
      setSaving(false);
    }
  };

  const handleDownload = () => {
    if (!result || !settings || !source) return;
    const ext = formatExt(settings.format);
    const safeBase = (title.trim() || stripExtension(source.name) || 'photo').replace(
      /[\\/:*?"<>|]/g,
      '_',
    );
    const a = document.createElement('a');
    a.href = result.objectUrl;
    a.download = `${safeBase}_${result.width}x${result.height}.${ext}`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  };

  const handleFocalPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!isPanningFocal || !isCroppingActive || !settings) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const x = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width));
    const y = Math.min(1, Math.max(0, (e.clientY - rect.top) / rect.height));
    updateSettings((prev) => ({
      ...prev,
      focalX: Number(x.toFixed(2)),
      focalY: Number(y.toFixed(2)),
    }));
  };

  const hiddenFileInput = (
    <input
      ref={fileInputRef}
      type="file"
      accept="image/*"
      className="hidden"
      onChange={(e) => {
        handleFileInput(e.target.files);
        e.target.value = '';
      }}
    />
  );

  // Empty / Initial upload view
  if (!source || !settings) {
    return (
      <div className="max-w-[1160px] mx-auto px-4 sm:px-6 py-10">
        {hiddenFileInput}
        <div className="mb-8">
          <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-zinc-900">
            사진 크기 · 비율 · 용량 조절 스튜디오
          </h1>
          <p className="mt-2 text-sm sm:text-base text-zinc-600 max-w-2xl">
            사진을 업로드하면 원하는 화면 비율과 픽셀 해상도, 목표 KB 용량에 맞춰 즉시 변환하고
            비밀번호로 보호된 보관함에 저장할 수 있습니다.
          </p>
        </div>

        <div
          onDragOver={(e) => {
            e.preventDefault();
            setIsDraggingOver(true);
          }}
          onDragLeave={() => setIsDraggingOver(false)}
          onDrop={(e) => {
            e.preventDefault();
            setIsDraggingOver(false);
            handleFileInput(e.dataTransfer.files);
          }}
          className={`bg-white border-2 border-dashed rounded-xl p-10 sm:p-14 text-center transition-colors ${
            isDraggingOver
              ? 'border-blue-600 bg-blue-50/40'
              : 'border-zinc-300 hover:border-zinc-400'
          }`}
        >
          <div className="mx-auto w-12 h-12 rounded-xl bg-zinc-100 border border-zinc-200 flex items-center justify-center text-zinc-700 mb-4">
            <Upload className="w-5 h-5" />
          </div>
          <h2 className="text-lg font-semibold text-zinc-900 bg-[#fcf3f3]">
            여기로 사진을 끌어다 놓거나 파일을 선택하세요
          </h2>
          <p className="mt-1.5 text-sm text-zinc-500">
            JPEG · PNG · WebP · GIF 이미지 지원 (브라우저에서 즉시 고화질 변환)
          </p>
          <div className="mt-6">
            <button
              type="button"
              disabled={loadingSource}
              onClick={() => fileInputRef.current?.click()}
              className="px-5 py-2.5 text-sm font-semibold text-white bg-blue-600 hover:bg-blue-700 rounded-lg transition-colors whitespace-nowrap focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 focus-visible:ring-offset-2"
            >
              {loadingSource ? '사진 불러오는 중...' : '컴퓨터에서 사진 선택'}
            </button>
          </div>
          {loadError && (
            <p role="alert" className="mt-4 text-sm text-red-600">
              {loadError}
            </p>
          )}
        </div>

        <div className="mt-10">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-sm font-semibold text-zinc-800">
              바로 테스트해 볼 샘플 사진
            </h2>
            <span className="text-xs text-zinc-500">클릭하면 에디터에 즉시 로드됩니다</span>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-5">
            {SAMPLE_PHOTOS.map((sample) => (
              <button
                key={sample.id}
                type="button"
                onClick={() => void handleSampleSelect(sample.url, sample.fileName)}
                className="group text-left bg-white border border-[#E4E4E0] hover:border-blue-600 rounded-xl overflow-hidden transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600"
              >
                <div className="aspect-[4/3] bg-zinc-100 overflow-hidden">
                  <img
                    src={sample.url}
                    alt={sample.label}
                    referrerPolicy="no-referrer"
                    className="w-full h-full object-cover group-hover:scale-[1.02] transition-transform duration-200"
                  />
                </div>
                <div className="p-3.5">
                  <div className="text-sm font-semibold text-zinc-900">{sample.label}</div>
                  <div className="text-xs text-zinc-500 mt-0.5">{sample.caption}</div>
                </div>
              </button>
            ))}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-[1440px] mx-auto px-4 sm:px-6 py-6">
      {hiddenFileInput}

      <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_380px] gap-6 items-start">
        {/* Left/Center Viewport */}
        <section className="space-y-4">
          {/* Viewport Toolbar */}
          <div className="bg-white border border-[#E4E4E0] rounded-xl px-4 py-3 flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-1 p-1 bg-zinc-100 rounded-lg">
              {(
                [
                  {id: 'after', label: '변환 결과'},
                  {id: 'split', label: '원본 비교'},
                  {id: 'before', label: '원본 보기'},
                ] as const
              ).map((tab) => (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => setPreviewMode(tab.id)}
                  className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 ${
                    previewMode === tab.id
                      ? 'bg-white text-zinc-900 shadow-xs'
                      : 'text-zinc-600 hover:text-zinc-900'
                  }`}
                >
                  {tab.label}
                </button>
              ))}
            </div>

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={handleReset}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-zinc-700 hover:text-zinc-900 bg-zinc-100 hover:bg-zinc-200 rounded-lg transition-colors whitespace-nowrap shrink-0"
              >
                <RotateCcw className="w-3.5 h-3.5" />
                <span>초기화</span>
              </button>
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-zinc-800 bg-white border border-zinc-300 hover:bg-zinc-50 rounded-lg transition-colors whitespace-nowrap shrink-0"
              >
                <FolderOpen className="w-3.5 h-3.5" />
                <span>다른 사진 열기</span>
              </button>
            </div>
          </div>

          {/* Preview Canvas Stage */}
          <div
            onDragOver={(e) => {
              e.preventDefault();
              setIsDraggingOver(true);
            }}
            onDragLeave={() => setIsDraggingOver(false)}
            onDrop={(e) => {
              e.preventDefault();
              setIsDraggingOver(false);
              handleFileInput(e.dataTransfer.files);
            }}
            className={`relative checkerboard-bg border rounded-xl overflow-hidden flex items-center justify-center min-h-[420px] lg:min-h-[540px] p-6 select-none ${
              isDraggingOver ? 'border-blue-500 ring-2 ring-blue-500/40' : 'border-[#E4E4E0]'
            }`}
          >
            {previewMode === 'before' && (
              <img
                src={source.objectUrl}
                alt="원본 사진"
                referrerPolicy="no-referrer"
                className="max-w-full max-h-[500px] object-contain shadow-lg"
              />
            )}

            {previewMode === 'after' && (
              <div
                onPointerDown={(e) => {
                  if (isCroppingActive) {
                    setIsPanningFocal(true);
                    handleFocalPointerMove(e);
                  }
                }}
                onPointerMove={handleFocalPointerMove}
                onPointerUp={() => setIsPanningFocal(false)}
                onPointerLeave={() => setIsPanningFocal(false)}
                className={`relative flex items-center justify-center ${
                  isCroppingActive ? 'cursor-crosshair' : ''
                }`}
              >
                {result ? (
                  <img
                    src={result.objectUrl}
                    alt="변환된 사진 미리보기"
                    referrerPolicy="no-referrer"
                    draggable={false}
                    className="max-w-full max-h-[500px] object-contain shadow-lg"
                  />
                ) : (
                  <div className="text-xs text-zinc-400">미리보기 생성 중...</div>
                )}
              </div>
            )}

            {previewMode === 'split' && (
              <div className="relative max-w-full max-h-[500px] flex items-center justify-center">
                <img
                  src={result ? result.objectUrl : source.objectUrl}
                  alt="변환 결과"
                  referrerPolicy="no-referrer"
                  className="max-w-full max-h-[500px] object-contain block"
                />
                <div
                  className="absolute inset-0 overflow-hidden"
                  style={{clipPath: `inset(0 ${100 - splitPercent}% 0 0)`}}
                >
                  <img
                    src={source.objectUrl}
                    alt="원본"
                    referrerPolicy="no-referrer"
                    className="w-full h-full object-contain block"
                  />
                </div>
                <div
                  className="absolute top-0 bottom-0 w-0.5 bg-white shadow"
                  style={{left: `${splitPercent}%`}}
                />
              </div>
            )}

            {processing && (
              <div className="absolute top-3 right-3 px-2.5 py-1 bg-zinc-900/80 text-white text-xs rounded-md">
                변환 중...
              </div>
            )}

            {isCroppingActive && previewMode === 'after' && (
              <div className="absolute bottom-3 left-1/2 -translate-x-1/2 px-3 py-1 bg-zinc-900/80 text-zinc-100 text-xs rounded-md pointer-events-none whitespace-nowrap">
                화면을 클릭·드래그해 자르기 중심 위치를 조절하세요
              </div>
            )}
          </div>

          {previewMode === 'split' && (
            <div className="bg-white border border-[#E4E4E0] rounded-xl px-4 py-3 flex items-center gap-4">
              <span className="text-xs font-medium text-zinc-600 whitespace-nowrap">
                원본 / 결과 비교 위치
              </span>
              <input
                type="range"
                min={0}
                max={100}
                value={splitPercent}
                onChange={(e) => setSplitPercent(Number(e.target.value))}
                aria-label="원본 및 결과 비교 슬라이더"
                className="w-full accent-blue-600"
              />
              <span className="text-xs font-mono tabular-nums text-zinc-700 w-10 text-right">
                {splitPercent}%
              </span>
            </div>
          )}

          {/* Real-Time Comparison Metrics Strip (Unboxed Tabular Text) */}
          <div className="bg-white border border-[#E4E4E0] rounded-xl px-5 py-4 space-y-2">
            <div className="flex flex-wrap items-center justify-between gap-4 text-sm">
              <div className="flex flex-wrap items-center gap-2 text-zinc-600 tabular-nums">
                <span className="font-medium text-zinc-800">원본</span>
                <span className="font-mono text-xs sm:text-sm">
                  {source.width} × {source.height}
                </span>
                <span aria-hidden="true">·</span>
                <span className="font-mono text-xs sm:text-sm">
                  {formatBytes(source.sizeBytes)}
                </span>
                <span aria-hidden="true">·</span>
                <span className="truncate max-w-[180px] text-xs text-zinc-500">
                  {source.name}
                </span>
              </div>

              {result && (
                <div className="flex flex-wrap items-center gap-2 tabular-nums">
                  <span className="font-semibold text-zinc-900">변환 결과</span>
                  <span className="font-mono text-xs sm:text-sm font-semibold text-zinc-900">
                    {result.width} × {result.height}
                  </span>
                  <span aria-hidden="true" className="text-zinc-400">
                    ·
                  </span>
                  <span className="font-mono text-xs sm:text-sm font-semibold text-blue-600">
                    {formatBytes(result.sizeBytes)}
                  </span>
                  <span
                    className={`font-mono text-xs font-medium ${
                      result.sizeBytes <= source.sizeBytes
                        ? 'text-emerald-700'
                        : 'text-amber-700'
                    }`}
                  >
                    ({formatSavingsPercent(source.sizeBytes, result.sizeBytes)})
                  </span>
                  <span aria-hidden="true" className="text-zinc-400">
                    ·
                  </span>
                  <span className="text-xs font-medium text-zinc-700">
                    {formatShortFormat(settings.format)} (Q{result.effectiveQuality})
                  </span>
                </div>
              )}
            </div>

            {result?.note && (
              <p className="text-xs text-amber-700 pt-1 border-t border-zinc-100">
                {result.note}
              </p>
            )}
            {loadError && (
              <p className="text-xs text-red-600 pt-1 border-t border-zinc-100">
                {loadError}
              </p>
            )}
          </div>

          {/* Quick Sample Switcher Strip */}
          <div className="flex flex-wrap items-center gap-2 text-xs text-zinc-500 pt-1">
            <span>샘플 빠른 전환:</span>
            {SAMPLE_PHOTOS.map((s) => (
              <button
                key={s.id}
                type="button"
                onClick={() => void handleSampleSelect(s.url, s.fileName)}
                className="px-2.5 py-1 bg-white border border-zinc-200 hover:border-zinc-400 rounded-md text-zinc-700 transition-colors whitespace-nowrap"
              >
                {s.label}
              </button>
            ))}
          </div>
        </section>

        {/* Right Inspector Controls */}
        <aside className="bg-white border border-[#E4E4E0] rounded-xl divide-y divide-zinc-200">
          {/* 1. Aspect Ratio */}
          <div className="p-5 space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-bold text-zinc-900">1. 화면 비율</h2>
              <button
                type="button"
                onClick={handleSwapAspect}
                className="inline-flex items-center gap-1 text-xs font-medium text-zinc-600 hover:text-zinc-900 whitespace-nowrap"
              >
                <ArrowLeftRight className="w-3.5 h-3.5" />
                <span>가로·세로 전환</span>
              </button>
            </div>

            <div className="grid grid-cols-3 gap-1.5">
              {ASPECT_PRESETS.map((preset) => {
                const active = settings.aspectPresetId === preset.id;
                return (
                  <button
                    key={preset.id}
                    type="button"
                    onClick={() => handleAspectPreset(preset.id)}
                    className={`px-2 py-2 rounded-lg border text-left transition-colors ${
                      active
                        ? 'border-blue-600 bg-blue-50/70 text-blue-700'
                        : 'border-zinc-200 hover:border-zinc-300 text-zinc-800'
                    }`}
                  >
                    <div className="text-xs font-semibold leading-tight whitespace-nowrap truncate">
                      {preset.label}
                    </div>
                    <div className="text-[11px] text-zinc-500 leading-tight mt-0.5 whitespace-nowrap truncate">
                      {preset.subLabel}
                    </div>
                  </button>
                );
              })}
            </div>

            {settings.aspectPresetId === 'custom' && (
              <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-2 pt-1">
                <input
                  type="number"
                  min={1}
                  max={1000}
                  value={settings.customRatioW}
                  onChange={(e) => {
                    const nextW = Math.max(1, Number(e.target.value) || 1);
                    updateSettings((prev) => {
                      const ratio = nextW / Math.max(1, prev.customRatioH);
                      return {
                        ...prev,
                        customRatioW: nextW,
                        height: Math.max(1, Math.round(prev.width / ratio)),
                      };
                    });
                  }}
                  aria-label="커스텀 가로 비율"
                  className="h-9 px-2.5 text-sm font-mono tabular-nums border border-zinc-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-600"
                />
                <span className="text-zinc-400 font-mono">:</span>
                <input
                  type="number"
                  min={1}
                  max={1000}
                  value={settings.customRatioH}
                  onChange={(e) => {
                    const nextH = Math.max(1, Number(e.target.value) || 1);
                    updateSettings((prev) => {
                      const ratio = Math.max(1, prev.customRatioW) / nextH;
                      return {
                        ...prev,
                        customRatioH: nextH,
                        height: Math.max(1, Math.round(prev.width / ratio)),
                      };
                    });
                  }}
                  aria-label="커스텀 세로 비율"
                  className="h-9 px-2.5 text-sm font-mono tabular-nums border border-zinc-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-600"
                />
              </div>
            )}

            <div>
              <span className="block text-xs font-medium text-zinc-600 mb-1.5">
                비율 맞춤 방식
              </span>
              <div className="grid grid-cols-3 gap-1 p-1 bg-zinc-100 rounded-lg">
                {(
                  [
                    {id: 'cover', label: '자르기'},
                    {id: 'contain', label: '여백 채우기'},
                    {id: 'stretch', label: '늘리기'},
                  ] as {id: CropMode; label: string}[]
                ).map((mode) => (
                  <button
                    key={mode.id}
                    type="button"
                    onClick={() => updateSettings((prev) => ({...prev, cropMode: mode.id}))}
                    className={`py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap ${
                      settings.cropMode === mode.id
                        ? 'bg-white text-zinc-900 shadow-xs'
                        : 'text-zinc-600 hover:text-zinc-900'
                    }`}
                  >
                    {mode.label}
                  </button>
                ))}
              </div>
            </div>

            {settings.cropMode === 'contain' && (
              <div className="space-y-1.5">
                <span className="block text-xs font-medium text-zinc-600">여백 배경색</span>
                <div className="flex items-center gap-2">
                  {[
                    {value: '#ffffff', label: '흰색'},
                    {value: '#000000', label: '검정'},
                    {value: '#f4f4f5', label: '밝은 회색'},
                    {value: 'transparent', label: '투명'},
                  ].map((opt) => (
                    <button
                      key={opt.value}
                      type="button"
                      onClick={() =>
                        updateSettings((prev) => ({...prev, padColor: opt.value}))
                      }
                      className={`px-2.5 py-1 text-xs rounded-md border whitespace-nowrap ${
                        settings.padColor === opt.value
                          ? 'border-blue-600 bg-blue-50 text-blue-700 font-medium'
                          : 'border-zinc-200 text-zinc-700 hover:border-zinc-300'
                      }`}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {isCroppingActive && (
              <div className="space-y-2 pt-1">
                <div className="flex items-center justify-between text-xs text-zinc-600">
                  <span>자르기 기준 위치</span>
                  <button
                    type="button"
                    onClick={() =>
                      updateSettings((prev) => ({...prev, focalX: 0.5, focalY: 0.5}))
                    }
                    className="text-blue-600 hover:underline"
                  >
                    가운데 정렬
                  </button>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <label className="text-[11px] text-zinc-500">
                    가로 ({Math.round(settings.focalX * 100)}%)
                    <input
                      type="range"
                      min={0}
                      max={100}
                      value={Math.round(settings.focalX * 100)}
                      onChange={(e) =>
                        updateSettings((prev) => ({
                          ...prev,
                          focalX: Number(e.target.value) / 100,
                        }))
                      }
                      className="w-full accent-blue-600 mt-1"
                    />
                  </label>
                  <label className="text-[11px] text-zinc-500">
                    세로 ({Math.round(settings.focalY * 100)}%)
                    <input
                      type="range"
                      min={0}
                      max={100}
                      value={Math.round(settings.focalY * 100)}
                      onChange={(e) =>
                        updateSettings((prev) => ({
                          ...prev,
                          focalY: Number(e.target.value) / 100,
                        }))
                      }
                      className="w-full accent-blue-600 mt-1"
                    />
                  </label>
                </div>
              </div>
            )}
          </div>

          {/* 2. Pixel Dimensions */}
          <div className="p-5 space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-bold text-zinc-900">2. 크기 (해상도 px)</h2>
              <button
                type="button"
                onClick={() =>
                  updateSettings((prev) => ({...prev, lockAspect: !prev.lockAspect}))
                }
                className={`inline-flex items-center gap-1 text-xs font-medium whitespace-nowrap ${
                  settings.lockAspect ? 'text-blue-600' : 'text-zinc-500'
                }`}
              >
                {settings.lockAspect ? (
                  <>
                    <Lock className="w-3.5 h-3.5" />
                    <span>비율 잠금</span>
                  </>
                ) : (
                  <>
                    <Unlock className="w-3.5 h-3.5" />
                    <span>자유 크기</span>
                  </>
                )}
              </button>
            </div>

            <div className="grid grid-cols-[1fr_auto_1fr] items-end gap-2">
              <div>
                <label
                  htmlFor="dim-width"
                  className="block text-xs text-zinc-600 mb-1"
                >
                  너비 (W)
                </label>
                <input
                  id="dim-width"
                  type="number"
                  min={1}
                  max={8000}
                  value={settings.width}
                  onChange={(e) => handleWidthChange(e.target.value)}
                  className="w-full h-10 px-3 text-sm font-mono tabular-nums border border-zinc-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-600"
                />
              </div>
              <span className="pb-2.5 text-zinc-400 text-sm">×</span>
              <div>
                <label
                  htmlFor="dim-height"
                  className="block text-xs text-zinc-600 mb-1"
                >
                  높이 (H)
                </label>
                <input
                  id="dim-height"
                  type="number"
                  min={1}
                  max={8000}
                  value={settings.height}
                  onChange={(e) => handleHeightChange(e.target.value)}
                  className="w-full h-10 px-3 text-sm font-mono tabular-nums border border-zinc-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-600"
                />
              </div>
            </div>

            <div className="space-y-2">
              <div className="flex items-center gap-1.5">
                {[25, 50, 75, 100].map((pct) => (
                  <button
                    key={pct}
                    type="button"
                    onClick={() => handleScalePercent(pct)}
                    className="flex-1 py-1.5 text-xs font-mono tabular-nums border border-zinc-200 hover:border-zinc-400 rounded-md text-zinc-700 transition-colors"
                  >
                    {pct}%
                  </button>
                ))}
              </div>
              <div className="flex flex-wrap items-center gap-1.5">
                {[1920, 1280, 1080, 800, 400].map((w) => (
                  <button
                    key={w}
                    type="button"
                    onClick={() => handlePresetWidth(w)}
                    className="px-2.5 py-1 text-[11px] font-mono tabular-nums bg-zinc-100 hover:bg-zinc-200 rounded text-zinc-700 transition-colors"
                  >
                    W {w}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* 3. File Size & Format */}
          <div className="p-5 space-y-4">
            <h2 className="text-sm font-bold text-zinc-900">3. 용량 및 파일 포맷</h2>

            <div className="grid grid-cols-3 gap-1 p-1 bg-zinc-100 rounded-lg">
              {(
                [
                  {id: 'image/webp', label: 'WebP'},
                  {id: 'image/jpeg', label: 'JPEG'},
                  {id: 'image/png', label: 'PNG'},
                ] as {id: ImageMime; label: string}[]
              ).map((fmt) => (
                <button
                  key={fmt.id}
                  type="button"
                  onClick={() => updateSettings((prev) => ({...prev, format: fmt.id}))}
                  className={`py-1.5 text-xs font-semibold rounded-md transition-colors ${
                    settings.format === fmt.id
                      ? 'bg-white text-zinc-900 shadow-xs'
                      : 'text-zinc-600 hover:text-zinc-900'
                  }`}
                >
                  {fmt.label}
                </button>
              ))}
            </div>

            <div className="grid grid-cols-2 gap-1 p-1 bg-zinc-100 rounded-lg">
              <button
                type="button"
                onClick={() =>
                  updateSettings((prev) => ({...prev, compressionMode: 'quality'}))
                }
                className={`py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap ${
                  settings.compressionMode === 'quality'
                    ? 'bg-white text-zinc-900 shadow-xs'
                    : 'text-zinc-600 hover:text-zinc-900'
                }`}
              >
                품질 직접 조절
              </button>
              <button
                type="button"
                onClick={() =>
                  updateSettings((prev) => ({...prev, compressionMode: 'targetKb'}))
                }
                className={`py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap ${
                  settings.compressionMode === 'targetKb'
                    ? 'bg-white text-zinc-900 shadow-xs'
                    : 'text-zinc-600 hover:text-zinc-900'
                }`}
              >
                목표 용량 맞춤 (KB)
              </button>
            </div>

            {settings.compressionMode === 'quality' ? (
              <div>
                <div className="flex items-center justify-between text-xs mb-1.5">
                  <span className="text-zinc-600">압축 품질</span>
                  <span className="font-mono font-semibold tabular-nums text-zinc-900">
                    {settings.format === 'image/png' ? '100% (무손실)' : `${settings.quality}%`}
                  </span>
                </div>
                <input
                  type="range"
                  min={5}
                  max={100}
                  disabled={settings.format === 'image/png'}
                  value={settings.quality}
                  onChange={(e) =>
                    updateSettings((prev) => ({
                      ...prev,
                      quality: Number(e.target.value),
                    }))
                  }
                  className="w-full accent-blue-600 disabled:opacity-40"
                />
              </div>
            ) : (
              <div className="space-y-3">
                <div>
                  <label
                    htmlFor="target-kb"
                    className="block text-xs text-zinc-600 mb-1"
                  >
                    최대 목표 용량 (KB)
                  </label>
                  <div className="relative">
                    <input
                      id="target-kb"
                      type="number"
                      min={10}
                      max={20000}
                      value={settings.targetKb}
                      onChange={(e) =>
                        updateSettings((prev) => ({
                          ...prev,
                          targetKb: Math.max(10, Number(e.target.value) || 10),
                        }))
                      }
                      className="w-full h-10 pl-3 pr-11 text-sm font-mono tabular-nums border border-zinc-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-600"
                    />
                    <span className="absolute inset-y-0 right-3 flex items-center text-xs font-mono text-zinc-500">
                      KB
                    </span>
                  </div>
                </div>

                <div className="flex items-center gap-1.5">
                  {[100, 200, 500, 1024].map((kb) => (
                    <button
                      key={kb}
                      type="button"
                      onClick={() => updateSettings((prev) => ({...prev, targetKb: kb}))}
                      className="flex-1 py-1 text-[11px] font-mono tabular-nums bg-zinc-100 hover:bg-zinc-200 rounded text-zinc-700 transition-colors"
                    >
                      {kb >= 1024 ? '1MB' : `${kb}KB`}
                    </button>
                  ))}
                </div>

                <label className="flex items-center gap-2 text-xs text-zinc-700 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={settings.autoDownscaleForTarget}
                    onChange={(e) =>
                      updateSettings((prev) => ({
                        ...prev,
                        autoDownscaleForTarget: e.target.checked,
                      }))
                    }
                    className="rounded border-zinc-300 text-blue-600 focus:ring-blue-600"
                  />
                  <span>용량 초과 시 해상도 자동 축소</span>
                </label>
              </div>
            )}
          </div>

          {/* 4. Save & Download */}
          <div className="p-5 space-y-3">
            <div>
              <label
                htmlFor="save-title"
                className="block text-xs font-medium text-zinc-600 mb-1"
              >
                저장 이름
              </label>
              <input
                id="save-title"
                type="text"
                maxLength={100}
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="예: 블로그 썸네일 16:9"
                className="w-full h-10 px-3 text-sm border border-zinc-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-600"
              />
            </div>

            {saveMessage && (
              <div
                className={`text-xs rounded-lg px-3 py-2 flex items-center justify-between gap-2 ${
                  saveMessage.type === 'ok'
                    ? 'bg-emerald-50 text-emerald-800 border border-emerald-200'
                    : 'bg-red-50 text-red-700 border border-red-200'
                }`}
              >
                <span className="flex items-center gap-1.5">
                  {saveMessage.type === 'ok' && <Check className="w-3.5 h-3.5" />}
                  {saveMessage.text}
                </span>
                {saveMessage.type === 'ok' && (
                  <button
                    type="button"
                    onClick={onOpenVault}
                    className="font-semibold underline whitespace-nowrap"
                  >
                    보관함 보기
                  </button>
                )}
              </div>
            )}

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 pt-1">
              <button
                type="button"
                disabled={saving || !result || processing}
                onClick={handleSaveToVault}
                className="h-11 px-4 inline-flex items-center justify-center gap-2 text-sm font-semibold text-white bg-blue-600 hover:bg-blue-700 disabled:opacity-60 rounded-lg transition-colors whitespace-nowrap"
              >
                <Save className="w-4 h-4" />
                <span>{saving ? '저장 중...' : '보관함에 저장'}</span>
              </button>

              <button
                type="button"
                disabled={!result || processing}
                onClick={handleDownload}
                className="h-11 px-4 inline-flex items-center justify-center gap-2 text-sm font-semibold text-zinc-800 bg-zinc-100 hover:bg-zinc-200 border border-zinc-300 disabled:opacity-60 rounded-lg transition-colors whitespace-nowrap"
              >
                <Download className="w-4 h-4" />
                <span>파일 다운로드</span>
              </button>
            </div>
          </div>
        </aside>
      </div>
    </div>
  );
}
