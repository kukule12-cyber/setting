import type {AuthMode, CropMode, ImageMime, SavedPhotoRecord} from '../types.ts';

export class ApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

async function parseJson<T>(res: Response): Promise<T> {
  const text = await res.text();
  let data: Record<string, unknown> = {};
  if (text) {
    try {
      data = JSON.parse(text) as Record<string, unknown>;
    } catch {
      data = {};
    }
  }
  if (!res.ok) {
    const msg =
      typeof data.error === 'string' && data.error.trim().length > 0
        ? data.error
        : `요청 처리에 실패했습니다 (${res.status})`;
    throw new ApiError(msg, res.status);
  }
  return data as T;
}

export async function getAuthStatus(
  token: string | null,
): Promise<{mode: AuthMode; authenticated: boolean}> {
  const headers: Record<string, string> = {};
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }
  const res = await fetch('/api/auth/status', {headers});
  return parseJson(res);
}

export async function setupInitialPassword(
  password: string,
): Promise<{token: string; mode: AuthMode}> {
  const res = await fetch('/api/auth/setup', {
    method: 'POST',
    headers: {'Content-Type': 'application/json'},
    body: JSON.stringify({password}),
  });
  return parseJson(res);
}

export async function loginWithPassword(
  password: string,
): Promise<{token: string; mode: AuthMode}> {
  const res = await fetch('/api/auth/login', {
    method: 'POST',
    headers: {'Content-Type': 'application/json'},
    body: JSON.stringify({password}),
  });
  return parseJson(res);
}

export async function changePassword(
  token: string,
  currentPassword: string,
  newPassword: string,
): Promise<{token: string; mode: AuthMode}> {
  const res = await fetch('/api/auth/change-password', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({currentPassword, newPassword}),
  });
  return parseJson(res);
}

export async function logoutSession(token: string): Promise<void> {
  await fetch('/api/auth/logout', {
    method: 'POST',
    headers: {Authorization: `Bearer ${token}`},
  });
}

export async function fetchSavedPhotos(token: string): Promise<SavedPhotoRecord[]> {
  const res = await fetch('/api/photos', {
    headers: {Authorization: `Bearer ${token}`},
  });
  const data = await parseJson<{photos: SavedPhotoRecord[]}>(res);
  return data.photos;
}

export interface SavePhotoPayload {
  title: string;
  originalName: string;
  originalWidth: number;
  originalHeight: number;
  originalSizeBytes: number;
  width: number;
  height: number;
  format: ImageMime;
  aspectRatioLabel: string;
  cropMode: CropMode;
  quality: number;
  targetKb: number | null;
  imageDataUrl: string;
}

export async function saveProcessedPhoto(
  token: string,
  payload: SavePhotoPayload,
): Promise<SavedPhotoRecord> {
  const res = await fetch('/api/photos', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(payload),
  });
  const data = await parseJson<{photo: SavedPhotoRecord}>(res);
  return data.photo;
}

export async function renameSavedPhoto(
  token: string,
  id: string,
  title: string,
): Promise<SavedPhotoRecord> {
  const res = await fetch(`/api/photos/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({title}),
  });
  const data = await parseJson<{photo: SavedPhotoRecord}>(res);
  return data.photo;
}

export async function deleteSavedPhoto(token: string, id: string): Promise<void> {
  const res = await fetch(`/api/photos/${encodeURIComponent(id)}`, {
    method: 'DELETE',
    headers: {Authorization: `Bearer ${token}`},
  });
  await parseJson<{ok: boolean}>(res);
}

export async function fetchPhotoBlob(token: string, id: string): Promise<Blob> {
  const res = await fetch(`/api/photos/${encodeURIComponent(id)}/file`, {
    headers: {Authorization: `Bearer ${token}`},
  });
  if (!res.ok) {
    throw new ApiError('이미지 파일을 불러오지 못했습니다.', res.status);
  }
  return res.blob();
}
