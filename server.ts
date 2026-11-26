import 'dotenv/config';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import express from 'express';
import type {NextFunction, Request, Response} from 'express';

type AuthMode = 'env' | 'claimed' | 'unclaimed';
type ImageMime = 'image/jpeg' | 'image/webp' | 'image/png';
type CropMode = 'cover' | 'contain' | 'stretch';

interface SavedPhotoRecord {
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

interface StoreData {
  passwordHash: string | null;
  tokenVersion: number;
  photos: SavedPhotoRecord[];
}

const PORT = Number(process.env.PORT) || 3000;
const DATA_DIR = path.resolve(process.cwd(), 'data');
const IMAGES_DIR = path.resolve(DATA_DIR, 'images');
const STORE_PATH = path.resolve(DATA_DIR, 'store.json');
const MAX_IMAGE_BYTES = 20 * 1024 * 1024; // 20 MB decoded limit
const SESSION_TTL_MS = 1000 * 60 * 60 * 24; // 24 hours
const SESSION_SECRET =
  process.env.SESSION_SECRET && process.env.SESSION_SECRET.trim().length >= 16
    ? process.env.SESSION_SECRET.trim()
    : crypto.randomBytes(32).toString('hex');

const revokedTokens = new Set<string>();
const loginAttempts = new Map<string, {count: number; resetAt: number}>();
let storeQueue: Promise<unknown> = Promise.resolve();

function withStoreLock<T>(fn: () => Promise<T>): Promise<T> {
  const next = storeQueue.then(fn, fn);
  storeQueue = next.catch(() => undefined);
  return next;
}

async function ensureDataDirs(): Promise<void> {
  await fs.mkdir(DATA_DIR, {recursive: true});
  await fs.mkdir(IMAGES_DIR, {recursive: true});
}

async function readStore(): Promise<StoreData> {
  await ensureDataDirs();
  try {
    const raw = await fs.readFile(STORE_PATH, 'utf8');
    const parsed = JSON.parse(raw) as Partial<StoreData>;
    return {
      passwordHash: typeof parsed.passwordHash === 'string' ? parsed.passwordHash : null,
      tokenVersion: typeof parsed.tokenVersion === 'number' ? parsed.tokenVersion : 1,
      photos: Array.isArray(parsed.photos) ? parsed.photos : [],
    };
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === 'ENOENT') {
      return {passwordHash: null, tokenVersion: 1, photos: []};
    }
    throw err;
  }
}

async function writeStoreAtomic(data: StoreData): Promise<void> {
  await ensureDataDirs();
  const tmpPath = `${STORE_PATH}.${crypto.randomBytes(6).toString('hex')}.tmp`;
  await fs.writeFile(tmpPath, JSON.stringify(data, null, 2), 'utf8');
  await fs.rename(tmpPath, STORE_PATH);
}

function getEnvPassword(): string {
  return (process.env.APP_PASSWORD || '').trim();
}

function getAuthMode(store: StoreData): AuthMode {
  if (getEnvPassword().length > 0) {
    return 'env';
  }
  if (store.passwordHash) {
    return 'claimed';
  }
  return 'unclaimed';
}

function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16).toString('hex');
  const derived = crypto.scryptSync(password, salt, 64).toString('hex');
  return `scrypt:${salt}:${derived}`;
}

function verifyScryptPassword(password: string, storedHash: string): boolean {
  const parts = storedHash.split(':');
  if (parts.length !== 3 || parts[0] !== 'scrypt') {
    return false;
  }
  const [, salt, hashHex] = parts;
  if (!salt || !hashHex) {
    return false;
  }
  const expectedBuf = Buffer.from(hashHex, 'hex');
  const actualBuf = crypto.scryptSync(password, salt, 64);
  if (expectedBuf.length !== actualBuf.length) {
    return false;
  }
  return crypto.timingSafeEqual(expectedBuf, actualBuf);
}

function verifyEnvPassword(input: string, envPass: string): boolean {
  const a = crypto.createHash('sha256').update(input, 'utf8').digest();
  const b = crypto.createHash('sha256').update(envPass, 'utf8').digest();
  return crypto.timingSafeEqual(a, b);
}

interface TokenPayload {
  sub: 'owner';
  mode: AuthMode;
  v: number;
  iat: number;
  exp: number;
}

function signToken(mode: AuthMode, tokenVersion: number): string {
  const now = Date.now();
  const payload: TokenPayload = {
    sub: 'owner',
    mode,
    v: tokenVersion,
    iat: now,
    exp: now + SESSION_TTL_MS,
  };
  const encodedPayload = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
  const sig = crypto
    .createHmac('sha256', SESSION_SECRET)
    .update(encodedPayload)
    .digest('base64url');
  return `${encodedPayload}.${sig}`;
}

function verifyToken(token: string, currentMode: AuthMode, tokenVersion: number): boolean {
  if (!token || revokedTokens.has(token)) {
    return false;
  }
  const parts = token.split('.');
  if (parts.length !== 2) {
    return false;
  }
  const [encodedPayload, sig] = parts;
  if (!encodedPayload || !sig) {
    return false;
  }
  const expectedSig = crypto
    .createHmac('sha256', SESSION_SECRET)
    .update(encodedPayload)
    .digest('base64url');
  const sigBuf = Buffer.from(sig, 'utf8');
  const expectedBuf = Buffer.from(expectedSig, 'utf8');
  if (sigBuf.length !== expectedBuf.length || !crypto.timingSafeEqual(sigBuf, expectedBuf)) {
    return false;
  }
  try {
    const parsed = JSON.parse(
      Buffer.from(encodedPayload, 'base64url').toString('utf8'),
    ) as Partial<TokenPayload>;
    if (
      parsed.sub !== 'owner' ||
      typeof parsed.exp !== 'number' ||
      parsed.exp < Date.now() ||
      parsed.v !== tokenVersion ||
      parsed.mode !== currentMode
    ) {
      return false;
    }
    return true;
  } catch {
    return false;
  }
}

function extractBearerToken(req: Request): string | null {
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) {
    return null;
  }
  return header.slice(7).trim() || null;
}

function checkRateLimit(req: Request): {allowed: boolean; retryAfterSec: number} {
  const key = req.ip || 'unknown';
  const now = Date.now();
  const windowMs = 10 * 60 * 1000;
  const maxAttempts = 12;
  const current = loginAttempts.get(key);
  if (!current || current.resetAt <= now) {
    loginAttempts.set(key, {count: 1, resetAt: now + windowMs});
    return {allowed: true, retryAfterSec: 0};
  }
  if (current.count >= maxAttempts) {
    return {
      allowed: false,
      retryAfterSec: Math.max(1, Math.ceil((current.resetAt - now) / 1000)),
    };
  }
  current.count += 1;
  return {allowed: true, retryAfterSec: 0};
}

function clearRateLimit(req: Request): void {
  const key = req.ip || 'unknown';
  loginAttempts.delete(key);
}

function resolveConfinedImagePath(fileName: string): string {
  const safeBase = path.basename(fileName);
  const resolved = path.resolve(IMAGES_DIR, safeBase);
  if (!resolved.startsWith(IMAGES_DIR + path.sep)) {
    throw new Error('Invalid image file path');
  }
  return resolved;
}

function verifyMagicBytes(buf: Buffer, mime: ImageMime): boolean {
  if (buf.length < 12) return false;
  if (mime === 'image/jpeg') {
    return buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff;
  }
  if (mime === 'image/png') {
    return (
      buf[0] === 0x89 &&
      buf[1] === 0x50 &&
      buf[2] === 0x4e &&
      buf[3] === 0x47 &&
      buf[4] === 0x0d &&
      buf[5] === 0x0a &&
      buf[6] === 0x1a &&
      buf[7] === 0x0a
    );
  }
  if (mime === 'image/webp') {
    return (
      buf.subarray(0, 4).toString('ascii') === 'RIFF' &&
      buf.subarray(8, 12).toString('ascii') === 'WEBP'
    );
  }
  return false;
}

function mimeToExt(mime: ImageMime): string {
  if (mime === 'image/jpeg') return 'jpg';
  if (mime === 'image/webp') return 'webp';
  return 'png';
}

function sanitizeText(value: unknown, fallback: string, maxLen: number): string {
  if (typeof value !== 'string') return fallback;
  const cleaned = value.replace(/[\u0000-\u001f\u007f]/g, '').trim();
  if (!cleaned) return fallback;
  return cleaned.slice(0, maxLen);
}

function isValidUuid(id: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);
}

async function startServer(): Promise<void> {
  await ensureDataDirs();
  const app = express();
  app.set('trust proxy', 1);

  app.use((_req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    next();
  });

  app.use(express.json({limit: '30mb'}));

  async function requireAuth(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const store = await readStore();
      const mode = getAuthMode(store);
      if (mode === 'unclaimed') {
        res.status(401).json({error: '초기 비밀번호 설정이 필요합니다.'});
        return;
      }
      const token = extractBearerToken(req);
      if (!token || !verifyToken(token, mode, store.tokenVersion)) {
        res.status(401).json({error: '인증이 만료되었거나 올바르지 않습니다.'});
        return;
      }
      next();
    } catch (err) {
      next(err);
    }
  }

  app.get('/api/auth/status', async (req, res, next) => {
    try {
      const store = await readStore();
      const mode = getAuthMode(store);
      const token = extractBearerToken(req);
      const authenticated =
        mode !== 'unclaimed' && token !== null && verifyToken(token, mode, store.tokenVersion);
      res.json({mode, authenticated});
    } catch (err) {
      next(err);
    }
  });

  app.post('/api/auth/setup', async (req, res, next) => {
    try {
      const rate = checkRateLimit(req);
      if (!rate.allowed) {
        res.status(429).json({
          error: `요청이 너무 많습니다. ${rate.retryAfterSec}초 후 다시 시도하세요.`,
        });
        return;
      }

      const password = typeof req.body?.password === 'string' ? req.body.password : '';
      if (password.length < 4 || password.length > 128) {
        res.status(400).json({error: '비밀번호는 4자 이상 128자 이하로 설정해 주세요.'});
        return;
      }

      const result = await withStoreLock(async () => {
        const store = await readStore();
        const mode = getAuthMode(store);
        if (mode !== 'unclaimed') {
          return {conflict: true as const};
        }
        store.passwordHash = hashPassword(password);
        store.tokenVersion += 1;
        await writeStoreAtomic(store);
        const token = signToken('claimed', store.tokenVersion);
        return {conflict: false as const, token};
      });

      if (result.conflict) {
        res.status(409).json({error: '이미 비밀번호가 설정되어 있습니다.'});
        return;
      }

      clearRateLimit(req);
      res.status(201).json({token: result.token, mode: 'claimed'});
    } catch (err) {
      next(err);
    }
  });

  app.post('/api/auth/login', async (req, res, next) => {
    try {
      const rate = checkRateLimit(req);
      if (!rate.allowed) {
        res.status(429).json({
          error: `로그인 시도가 너무 많습니다. ${rate.retryAfterSec}초 후 다시 시도하세요.`,
        });
        return;
      }

      const password = typeof req.body?.password === 'string' ? req.body.password : '';
      if (!password || password.length > 128) {
        res.status(400).json({error: '비밀번호를 입력해 주세요.'});
        return;
      }

      const store = await readStore();
      const mode = getAuthMode(store);
      if (mode === 'unclaimed') {
        res.status(409).json({error: '먼저 초기 비밀번호를 설정해야 합니다.'});
        return;
      }

      let valid = false;
      if (mode === 'env') {
        valid = verifyEnvPassword(password, getEnvPassword());
      } else if (store.passwordHash) {
        valid = verifyScryptPassword(password, store.passwordHash);
      }

      if (!valid) {
        res.status(401).json({error: '비밀번호가 일치하지 않습니다.'});
        return;
      }

      clearRateLimit(req);
      const token = signToken(mode, store.tokenVersion);
      res.json({token, mode});
    } catch (err) {
      next(err);
    }
  });

  app.post('/api/auth/change-password', requireAuth, async (req, res, next) => {
    try {
      const currentPassword =
        typeof req.body?.currentPassword === 'string' ? req.body.currentPassword : '';
      const newPassword =
        typeof req.body?.newPassword === 'string' ? req.body.newPassword : '';

      if (newPassword.length < 4 || newPassword.length > 128) {
        res.status(400).json({error: '새 비밀번호는 4자 이상 128자 이하로 입력해 주세요.'});
        return;
      }

      const outcome = await withStoreLock(async () => {
        const store = await readStore();
        const mode = getAuthMode(store);
        if (mode === 'env') {
          return {status: 403 as const, error: '환경 변수로 지정된 비밀번호는 앱 내에서 변경할 수 없습니다.'};
        }
        if (!store.passwordHash || !verifyScryptPassword(currentPassword, store.passwordHash)) {
          return {status: 401 as const, error: '현재 비밀번호가 일치하지 않습니다.'};
        }
        store.passwordHash = hashPassword(newPassword);
        store.tokenVersion += 1;
        await writeStoreAtomic(store);
        const token = signToken('claimed', store.tokenVersion);
        return {status: 200 as const, token};
      });

      if (outcome.status !== 200) {
        res.status(outcome.status).json({error: outcome.error});
        return;
      }

      const oldToken = extractBearerToken(req);
      if (oldToken) {
        revokedTokens.add(oldToken);
      }

      res.json({token: outcome.token, mode: 'claimed'});
    } catch (err) {
      next(err);
    }
  });

  app.post('/api/auth/logout', requireAuth, (req, res) => {
    const token = extractBearerToken(req);
    if (token) {
      revokedTokens.add(token);
    }
    res.json({ok: true});
  });

  app.get('/api/photos', requireAuth, async (_req, res, next) => {
    try {
      const store = await readStore();
      const sorted = [...store.photos].sort(
        (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
      );
      res.json({photos: sorted});
    } catch (err) {
      next(err);
    }
  });

  app.post('/api/photos', requireAuth, async (req, res, next) => {
    try {
      const body = req.body as Record<string, unknown>;
      const imageDataUrl = typeof body.imageDataUrl === 'string' ? body.imageDataUrl : '';
      const match = /^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=]+)$/.exec(
        imageDataUrl,
      );
      if (!match) {
        res.status(400).json({error: '올바른 이미지 데이터(JPEG/PNG/WebP)가 아닙니다.'});
        return;
      }

      const format = match[1] as ImageMime;
      const base64Body = match[2];
      const buffer = Buffer.from(base64Body, 'base64');

      if (buffer.length === 0 || buffer.length > MAX_IMAGE_BYTES) {
        res.status(400).json({error: '이미지 파일 크기는 최대 20MB까지 저장할 수 있습니다.'});
        return;
      }

      if (!verifyMagicBytes(buffer, format)) {
        res.status(400).json({error: '이미지 파일 시그니처가 유효하지 않습니다.'});
        return;
      }

      const width = Number(body.width);
      const height = Number(body.height);
      const originalWidth = Number(body.originalWidth);
      const originalHeight = Number(body.originalHeight);
      const originalSizeBytes = Number(body.originalSizeBytes);
      const quality = Number(body.quality);
      const targetKbRaw = body.targetKb;
      const targetKb =
        targetKbRaw === null || targetKbRaw === undefined
          ? null
          : Number.isFinite(Number(targetKbRaw)) && Number(targetKbRaw) > 0
            ? Math.round(Number(targetKbRaw))
            : null;

      if (
        !Number.isInteger(width) ||
        width < 1 ||
        width > 12000 ||
        !Number.isInteger(height) ||
        height < 1 ||
        height > 12000 ||
        !Number.isInteger(originalWidth) ||
        originalWidth < 1 ||
        originalWidth > 24000 ||
        !Number.isInteger(originalHeight) ||
        originalHeight < 1 ||
        originalHeight > 24000 ||
        !Number.isFinite(originalSizeBytes) ||
        originalSizeBytes < 0 ||
        !Number.isFinite(quality) ||
        quality < 1 ||
        quality > 100
      ) {
        res.status(400).json({error: '이미지 크기 또는 품질 메타데이터가 유효하지 않습니다.'});
        return;
      }

      const cropModeRaw = body.cropMode;
      const cropMode: CropMode =
        cropModeRaw === 'cover' || cropModeRaw === 'contain' || cropModeRaw === 'stretch'
          ? cropModeRaw
          : 'cover';

      const id = crypto.randomUUID();
      const fileName = `${id}.${mimeToExt(format)}`;
      const filePath = resolveConfinedImagePath(fileName);
      const now = new Date().toISOString();

      await ensureDataDirs();
      await fs.writeFile(filePath, buffer);

      const record: SavedPhotoRecord = {
        id,
        title: sanitizeText(body.title, '편집된 사진', 100),
        originalName: sanitizeText(body.originalName, 'photo', 140),
        originalWidth,
        originalHeight,
        originalSizeBytes: Math.round(originalSizeBytes),
        width,
        height,
        sizeBytes: buffer.length,
        format,
        aspectRatioLabel: sanitizeText(body.aspectRatioLabel, '원본 비율', 40),
        cropMode,
        quality: Math.round(quality),
        targetKb,
        fileName,
        createdAt: now,
        updatedAt: now,
      };

      await withStoreLock(async () => {
        const store = await readStore();
        store.photos.unshift(record);
        await writeStoreAtomic(store);
      });

      res.status(201).json({photo: record});
    } catch (err) {
      next(err);
    }
  });

  app.patch('/api/photos/:id', requireAuth, async (req, res, next) => {
    try {
      const id = req.params.id;
      if (!isValidUuid(id)) {
        res.status(400).json({error: '잘못된 항목 ID입니다.'});
        return;
      }
      const nextTitle = sanitizeText(req.body?.title, '', 100);
      if (!nextTitle) {
        res.status(400).json({error: '제목을 입력해 주세요.'});
        return;
      }

      const updated = await withStoreLock(async () => {
        const store = await readStore();
        const item = store.photos.find((p) => p.id === id);
        if (!item) return null;
        item.title = nextTitle;
        item.updatedAt = new Date().toISOString();
        await writeStoreAtomic(store);
        return item;
      });

      if (!updated) {
        res.status(404).json({error: '저장된 사진을 찾을 수 없습니다.'});
        return;
      }
      res.json({photo: updated});
    } catch (err) {
      next(err);
    }
  });

  app.get('/api/photos/:id/file', requireAuth, async (req, res, next) => {
    try {
      const id = req.params.id;
      if (!isValidUuid(id)) {
        res.status(400).json({error: '잘못된 항목 ID입니다.'});
        return;
      }
      const store = await readStore();
      const item = store.photos.find((p) => p.id === id);
      if (!item) {
        res.status(404).json({error: '파일을 찾을 수 없습니다.'});
        return;
      }
      const filePath = resolveConfinedImagePath(item.fileName);
      const data = await fs.readFile(filePath);
      const ext = mimeToExt(item.format);
      const asciiFallback = `${item.id}.${ext}`;
      res.setHeader('Content-Type', item.format);
      res.setHeader('Content-Disposition', `inline; filename="${asciiFallback}"`);
      res.setHeader('Cache-Control', 'private, max-age=300');
      res.send(data);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
        res.status(404).json({error: '저장된 이미지 파일을 찾을 수 없습니다.'});
        return;
      }
      next(err);
    }
  });

  app.delete('/api/photos/:id', requireAuth, async (req, res, next) => {
    try {
      const id = req.params.id;
      if (!isValidUuid(id)) {
        res.status(400).json({error: '잘못된 항목 ID입니다.'});
        return;
      }

      const removed = await withStoreLock(async () => {
        const store = await readStore();
        const index = store.photos.findIndex((p) => p.id === id);
        if (index === -1) return null;
        const [item] = store.photos.splice(index, 1);
        await writeStoreAtomic(store);
        return item;
      });

      if (!removed) {
        res.status(404).json({error: '삭제할 항목을 찾을 수 없습니다.'});
        return;
      }

      const filePath = resolveConfinedImagePath(removed.fileName);
      await fs.unlink(filePath).catch((err) => {
        if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
          throw err;
        }
      });

      res.json({ok: true});
    } catch (err) {
      next(err);
    }
  });

  if (process.env.NODE_ENV !== 'production') {
    const {createServer: createViteServer} = await import('vite');
    const vite = await createViteServer({
      server: {middlewareMode: true},
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distDir = path.resolve(process.cwd(), 'dist');
    app.use(express.static(distDir));
    app.get('*', (_req, res) => {
      res.sendFile(path.resolve(distDir, 'index.html'));
    });
  }

  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    console.error('[server error]', err);
    if (!res.headersSent) {
      res.status(500).json({error: '서버 처리 중 오류가 발생했습니다.'});
    }
  });

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`FrameStudio server listening on http://0.0.0.0:${PORT}`);
  });
}

startServer().catch((err) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
