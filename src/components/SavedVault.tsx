import {useEffect, useMemo, useState} from 'react';
import {
  Check,
  Download,
  Pencil,
  Search,
  SlidersHorizontal,
  Trash2,
  X,
} from 'lucide-react';
import type {ImageMime, SavedPhotoRecord} from '../types.ts';
import {
  deleteSavedPhoto,
  fetchPhotoBlob,
  renameSavedPhoto,
} from '../utils/api.ts';
import {
  formatBytes,
  formatExt,
  formatSavingsPercent,
  formatShortFormat,
} from '../utils/imageProcessor.ts';
import {AuthenticatedImage} from './AuthenticatedImage.tsx';

interface SavedVaultProps {
  token: string;
  photos: SavedPhotoRecord[];
  loading: boolean;
  onPhotosChange: (next: SavedPhotoRecord[]) => void;
  onLoadIntoEditor: (blob: Blob, name: string) => void;
  onGoToEditor: () => void;
  onAuthExpired: () => void;
}

type FormatFilter = 'all' | ImageMime;
type SortOrder = 'newest' | 'smallest' | 'largest_dim';

export function SavedVault({
  token,
  photos,
  loading,
  onPhotosChange,
  onLoadIntoEditor,
  onGoToEditor,
  onAuthExpired,
}: SavedVaultProps) {
  const [query, setQuery] = useState('');
  const [formatFilter, setFormatFilter] = useState<FormatFilter>('all');
  const [sortOrder, setSortOrder] = useState<SortOrder>('newest');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingTitle, setEditingTitle] = useState('');
  const [busyId, setBusyId] = useState<string | null>(null);
  const [lightboxPhoto, setLightboxPhoto] = useState<SavedPhotoRecord | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        setLightboxPhoto(null);
      }
    }
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, []);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = photos.filter((item) => {
      if (formatFilter !== 'all' && item.format !== formatFilter) return false;
      if (q) {
        const hay = `${item.title} ${item.originalName} ${item.aspectRatioLabel}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });

    if (sortOrder === 'smallest') {
      list.sort((a, b) => a.sizeBytes - b.sizeBytes);
    } else if (sortOrder === 'largest_dim') {
      list.sort((a, b) => b.width * b.height - a.width * a.height);
    } else {
      list.sort(
        (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
      );
    }
    return list;
  }, [photos, query, formatFilter, sortOrder]);

  const totalSavedBytes = useMemo(
    () => photos.reduce((sum, p) => sum + p.sizeBytes, 0),
    [photos],
  );

  const handleRenameSubmit = async (id: string) => {
    const trimmed = editingTitle.trim();
    if (!trimmed) {
      setEditingId(null);
      return;
    }
    setBusyId(id);
    setError(null);
    try {
      const updated = await renameSavedPhoto(token, id, trimmed);
      onPhotosChange(photos.map((p) => (p.id === id ? updated : p)));
      setEditingId(null);
    } catch (err) {
      const msg = err instanceof Error ? err.message : '이름 변경에 실패했습니다.';
      if (msg.includes('인증')) {
        onAuthExpired();
        return;
      }
      setError(msg);
    } finally {
      setBusyId(null);
    }
  };

  const handleDownload = async (item: SavedPhotoRecord) => {
    setBusyId(item.id);
    setError(null);
    try {
      const blob = await fetchPhotoBlob(token, item.id);
      const url = URL.createObjectURL(blob);
      const ext = formatExt(item.format);
      const safeTitle = item.title.replace(/[\\/:*?"<>|]/g, '_');
      const a = document.createElement('a');
      a.href = url;
      a.download = `${safeTitle}_${item.width}x${item.height}.${ext}`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (err) {
      const msg = err instanceof Error ? err.message : '다운로드에 실패했습니다.';
      if (msg.includes('인증')) {
        onAuthExpired();
        return;
      }
      setError(msg);
    } finally {
      setBusyId(null);
    }
  };

  const handleReEdit = async (item: SavedPhotoRecord) => {
    setBusyId(item.id);
    setError(null);
    try {
      const blob = await fetchPhotoBlob(token, item.id);
      const ext = formatExt(item.format);
      onLoadIntoEditor(blob, `${item.title}.${ext}`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : '이미지를 불러오지 못했습니다.';
      if (msg.includes('인증')) {
        onAuthExpired();
        return;
      }
      setError(msg);
    } finally {
      setBusyId(null);
    }
  };

  const handleDelete = async (item: SavedPhotoRecord) => {
    setBusyId(item.id);
    setError(null);
    try {
      await deleteSavedPhoto(token, item.id);
      onPhotosChange(photos.filter((p) => p.id !== item.id));
      if (lightboxPhoto?.id === item.id) {
        setLightboxPhoto(null);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : '삭제에 실패했습니다.';
      if (msg.includes('인증')) {
        onAuthExpired();
        return;
      }
      setError(msg);
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="max-w-[1440px] mx-auto px-4 sm:px-6 py-8">
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-4 pb-6 border-b border-zinc-200">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-zinc-900">
            저장된 사진 보관함
          </h1>
          <p className="mt-1 text-sm text-zinc-600 tabular-nums">
            총 {photos.length}개 항목 · 전체 저장 용량 {formatBytes(totalSavedBytes)}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <div className="relative">
            <Search className="w-4 h-4 text-zinc-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="제목 또는 비율 검색"
              className="h-9 pl-9 pr-3 w-52 text-sm bg-white border border-zinc-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-600"
            />
          </div>

          <div className="flex items-center gap-1 p-1 bg-zinc-200/70 rounded-lg">
            {(
              [
                {id: 'all', label: '전체'},
                {id: 'image/webp', label: 'WebP'},
                {id: 'image/jpeg', label: 'JPEG'},
                {id: 'image/png', label: 'PNG'},
              ] as {id: FormatFilter; label: string}[]
            ).map((f) => (
              <button
                key={f.id}
                type="button"
                onClick={() => setFormatFilter(f.id)}
                className={`px-2.5 py-1 text-xs font-medium rounded-md transition-colors whitespace-nowrap ${
                  formatFilter === f.id
                    ? 'bg-white text-zinc-900 shadow-xs'
                    : 'text-zinc-600 hover:text-zinc-900'
                }`}
              >
                {f.label}
              </button>
            ))}
          </div>

          <select
            value={sortOrder}
            onChange={(e) => setSortOrder(e.target.value as SortOrder)}
            aria-label="정렬 순서"
            className="h-9 px-3 text-xs font-medium bg-white border border-zinc-300 rounded-lg text-zinc-800 focus:outline-none focus:ring-2 focus:ring-blue-600"
          >
            <option value="newest">최신순</option>
            <option value="smallest">용량 작은순</option>
            <option value="largest_dim">해상도 큰순</option>
          </select>
        </div>
      </div>

      {error && (
        <div
          role="alert"
          className="mt-4 text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg px-4 py-2.5"
        >
          {error}
        </div>
      )}

      {loading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6 mt-8">
          {[1, 2, 3].map((n) => (
            <div
              key={n}
              className="bg-white border border-[#E4E4E0] rounded-xl overflow-hidden animate-pulse"
            >
              <div className="aspect-[4/3] bg-zinc-100" />
              <div className="p-4 space-y-2.5">
                <div className="h-4 w-2/3 bg-zinc-200 rounded" />
                <div className="h-3 w-4/5 bg-zinc-100 rounded" />
              </div>
            </div>
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <div className="mt-12 bg-white border border-[#E4E4E0] rounded-xl p-12 text-center max-w-lg mx-auto">
          <h2 className="text-base font-semibold text-zinc-900">
            {photos.length === 0
              ? '아직 저장된 사진이 없습니다'
              : '검색 조건에 맞는 사진이 없습니다'}
          </h2>
          <p className="mt-2 text-sm text-zinc-500">
            {photos.length === 0
              ? '편집기에서 사진의 크기, 비율, 용량을 조절한 뒤 보관함에 저장해 보세요.'
              : '검색어나 포맷 필터를 변경해 다시 확인해 주세요.'}
          </p>
          {photos.length === 0 && (
            <button
              type="button"
              onClick={onGoToEditor}
              className="mt-5 px-4 py-2 text-sm font-semibold text-white bg-blue-600 hover:bg-blue-700 rounded-lg transition-colors whitespace-nowrap"
            >
              편집기로 이동하기
            </button>
          )}
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6 mt-8">
          {filtered.map((item) => {
            const isEditing = editingId === item.id;
            const dateStr = new Date(item.createdAt).toLocaleDateString('ko-KR', {
              year: 'numeric',
              month: '2-digit',
              day: '2-digit',
            });

            return (
              <article
                key={item.id}
                className="bg-white border border-[#E4E4E0] rounded-xl overflow-hidden flex flex-col"
              >
                <button
                  type="button"
                  onClick={() => setLightboxPhoto(item)}
                  className="aspect-[4/3] w-full checkerboard-bg overflow-hidden focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600"
                >
                  <AuthenticatedImage
                    token={token}
                    photoId={item.id}
                    alt={item.title}
                    className="w-full h-full object-contain hover:scale-[1.02] transition-transform duration-200"
                  />
                </button>

                <div className="p-4 flex-1 flex flex-col justify-between gap-4">
                  <div className="space-y-1.5">
                    {isEditing ? (
                      <form
                        onSubmit={(e) => {
                          e.preventDefault();
                          void handleRenameSubmit(item.id);
                        }}
                        className="flex items-center gap-1.5"
                      >
                        <input
                          type="text"
                          value={editingTitle}
                          onChange={(e) => setEditingTitle(e.target.value)}
                          autoFocus
                          maxLength={100}
                          className="flex-1 h-8 px-2.5 text-sm border border-blue-600 rounded-md focus:outline-none"
                        />
                        <button
                          type="submit"
                          aria-label="제목 저장"
                          className="p-1.5 text-blue-600 hover:bg-blue-50 rounded"
                        >
                          <Check className="w-4 h-4" />
                        </button>
                        <button
                          type="button"
                          onClick={() => setEditingId(null)}
                          aria-label="취소"
                          className="p-1.5 text-zinc-500 hover:bg-zinc-100 rounded"
                        >
                          <X className="w-4 h-4" />
                        </button>
                      </form>
                    ) : (
                      <div className="flex items-center justify-between gap-2">
                        <h2 className="text-base font-semibold text-zinc-900 truncate">
                          {item.title}
                        </h2>
                        <button
                          type="button"
                          onClick={() => {
                            setEditingId(item.id);
                            setEditingTitle(item.title);
                          }}
                          aria-label="이름 변경"
                          className="p-1 text-zinc-400 hover:text-zinc-700 rounded shrink-0"
                        >
                          <Pencil className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    )}

                    <div className="flex flex-wrap items-center gap-1.5 text-xs text-zinc-700 font-mono tabular-nums">
                      <span>
                        {item.width} × {item.height}
                      </span>
                      <span aria-hidden="true" className="text-zinc-400">
                        ·
                      </span>
                      <span className="font-semibold text-blue-600">
                        {formatBytes(item.sizeBytes)}
                      </span>
                      <span className="text-emerald-700">
                        ({formatSavingsPercent(item.originalSizeBytes, item.sizeBytes)})
                      </span>
                      <span aria-hidden="true" className="text-zinc-400">
                        ·
                      </span>
                      <span>{formatShortFormat(item.format)}</span>
                    </div>

                    <div className="flex flex-wrap items-center gap-1.5 text-xs text-zinc-500 tabular-nums">
                      <span>
                        원본 {item.originalWidth}×{item.originalHeight} (
                        {formatBytes(item.originalSizeBytes)})
                      </span>
                      <span aria-hidden="true">·</span>
                      <span>비율 {item.aspectRatioLabel}</span>
                      <span aria-hidden="true">·</span>
                      <span>{dateStr}</span>
                    </div>
                  </div>

                  <div className="pt-3 border-t border-zinc-100 flex items-center justify-between gap-2">
                    <button
                      type="button"
                      disabled={busyId === item.id}
                      onClick={() => void handleReEdit(item)}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-zinc-800 bg-zinc-100 hover:bg-zinc-200 rounded-lg transition-colors whitespace-nowrap"
                    >
                      <SlidersHorizontal className="w-3.5 h-3.5" />
                      <span>다시 편집</span>
                    </button>

                    <div className="flex items-center gap-1.5">
                      <button
                        type="button"
                        disabled={busyId === item.id}
                        onClick={() => void handleDownload(item)}
                        aria-label="다운로드"
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-blue-700 bg-blue-50 hover:bg-blue-100 rounded-lg transition-colors whitespace-nowrap"
                      >
                        <Download className="w-3.5 h-3.5" />
                        <span>다운로드</span>
                      </button>

                      <button
                        type="button"
                        disabled={busyId === item.id}
                        onClick={() => void handleDelete(item)}
                        aria-label="삭제"
                        className="p-1.5 text-zinc-500 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                </div>
              </article>
            );
          })}
        </div>
      )}

      {/* Lightbox Detail Modal */}
      {lightboxPhoto && (
        <div
          className="fixed inset-0 z-50 bg-black/75 flex items-center justify-center p-4 sm:p-8"
          onClick={(e) => {
            if (e.target === e.currentTarget) setLightboxPhoto(null);
          }}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-label={lightboxPhoto.title}
            className="w-full max-w-4xl bg-white rounded-xl overflow-hidden border border-zinc-800"
          >
            <div className="px-5 py-3.5 border-b border-zinc-200 flex items-center justify-between gap-4">
              <div className="min-w-0">
                <h3 className="text-base font-bold text-zinc-900 truncate">
                  {lightboxPhoto.title}
                </h3>
                <p className="text-xs text-zinc-500 font-mono tabular-nums">
                  {lightboxPhoto.width} × {lightboxPhoto.height} ·{' '}
                  {formatBytes(lightboxPhoto.sizeBytes)} ·{' '}
                  {formatShortFormat(lightboxPhoto.format)} (Q{lightboxPhoto.quality}) · 비율{' '}
                  {lightboxPhoto.aspectRatioLabel}
                </p>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <button
                  type="button"
                  onClick={() => void handleDownload(lightboxPhoto)}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-white bg-blue-600 hover:bg-blue-700 rounded-lg transition-colors whitespace-nowrap"
                >
                  <Download className="w-3.5 h-3.5" />
                  <span>다운로드</span>
                </button>
                <button
                  type="button"
                  onClick={() => setLightboxPhoto(null)}
                  aria-label="닫기"
                  className="p-2 text-zinc-500 hover:text-zinc-900 hover:bg-zinc-100 rounded-lg"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            </div>

            <div className="checkerboard-bg p-4 flex items-center justify-center max-h-[75vh]">
              <AuthenticatedImage
                token={token}
                photoId={lightboxPhoto.id}
                alt={lightboxPhoto.title}
                className="max-w-full max-h-[68vh] object-contain"
              />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
