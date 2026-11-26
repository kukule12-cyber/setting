import {useState} from 'react';
import {Eye, EyeOff, KeyRound, Lock} from 'lucide-react';
import type {AuthMode} from '../types.ts';
import {loginWithPassword, setupInitialPassword} from '../utils/api.ts';

interface AuthGateProps {
  mode: AuthMode;
  onAuthenticated: (token: string, nextMode: AuthMode) => void;
}

export function AuthGate({mode, onAuthenticated}: AuthGateProps) {
  const isSetup = mode === 'unclaimed';
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (password.length < 4) {
      setError('비밀번호는 최소 4자 이상 입력해 주세요.');
      return;
    }

    if (isSetup && password !== confirmPassword) {
      setError('비밀번호 확인이 일치하지 않습니다.');
      return;
    }

    setSubmitting(true);
    try {
      const result = isSetup
        ? await setupInitialPassword(password)
        : await loginWithPassword(password);
      setPassword('');
      setConfirmPassword('');
      onAuthenticated(result.token, result.mode);
    } catch (err) {
      setError(err instanceof Error ? err.message : '로그인에 실패했습니다.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="min-h-screen bg-[#F7F7F5] text-[#18181B] flex flex-col items-center justify-center px-4 py-12">
      <div className="w-full max-w-[420px]">
        <div className="mb-8 text-center">
          <p className="text-xs font-medium tracking-wide text-zinc-500 mb-2">
            FrameStudio
          </p>
          <h1 className="text-2xl font-bold tracking-tight text-zinc-900">
            {isSetup ? '스튜디오 비밀번호 설정' : '스튜디오 로그인'}
          </h1>
          <p className="mt-2 text-sm text-zinc-600 leading-relaxed">
            {isSetup
              ? '처음 접속하셨습니다. 저장된 사진과 작업 기록을 보호할 전용 비밀번호를 설정해 주세요.'
              : '비밀번호를 입력하면 사진 편집 스튜디오와 저장 보관함에 접근할 수 있습니다.'}
          </p>
        </div>

        <form
          onSubmit={handleSubmit}
          className="bg-white border border-[#E4E4E0] rounded-xl p-6 space-y-5"
        >
          <div>
            <label
              htmlFor="studio-password"
              className="block text-sm font-medium text-zinc-800 mb-1.5"
            >
              {isSetup ? '새 비밀번호' : '비밀번호'}
            </label>
            <div className="relative">
              <span className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-zinc-400">
                {isSetup ? <KeyRound className="w-4 h-4" /> : <Lock className="w-4 h-4" />}
              </span>
              <input
                id="studio-password"
                type={showPassword ? 'text' : 'password'}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoFocus
                autoComplete={isSetup ? 'new-password' : 'current-password'}
                placeholder={isSetup ? '4자 이상 입력' : '비밀번호 입력'}
                className="w-full h-11 pl-10 pr-11 text-sm bg-white border border-zinc-300 rounded-lg text-zinc-900 placeholder:text-zinc-400 focus:outline-none focus:ring-2 focus:ring-blue-600 focus:border-blue-600 transition-colors"
                required
              />
              <button
                type="button"
                onClick={() => setShowPassword((prev) => !prev)}
                aria-label={showPassword ? '비밀번호 숨기기' : '비밀번호 보기'}
                className="absolute inset-y-0 right-1.5 px-2 flex items-center text-zinc-400 hover:text-zinc-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 rounded"
              >
                {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
          </div>

          {isSetup && (
            <div>
              <label
                htmlFor="studio-password-confirm"
                className="block text-sm font-medium text-zinc-800 mb-1.5"
              >
                비밀번호 확인
              </label>
              <input
                id="studio-password-confirm"
                type={showPassword ? 'text' : 'password'}
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                autoComplete="new-password"
                placeholder="비밀번호를 한 번 더 입력"
                className="w-full h-11 px-3.5 text-sm bg-white border border-zinc-300 rounded-lg text-zinc-900 placeholder:text-zinc-400 focus:outline-none focus:ring-2 focus:ring-blue-600 focus:border-blue-600 transition-colors"
                required
              />
            </div>
          )}

          {error && (
            <div
              role="alert"
              className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg px-3.5 py-2.5"
            >
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={submitting}
            className="w-full h-11 px-4 text-sm font-semibold text-white bg-blue-600 hover:bg-blue-700 disabled:opacity-60 disabled:cursor-not-allowed rounded-lg transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-blue-600 whitespace-nowrap"
          >
            {submitting
              ? '확인 중...'
              : isSetup
                ? '비밀번호 저장 후 시작하기'
                : '잠금 해제 및 입장'}
          </button>

          <p className="text-xs text-zinc-500 text-center pt-1">
            {mode === 'env'
              ? '환경 변수에 설정된 비밀번호로 보호되고 있습니다.'
              : '비밀번호는 서버에서 안전하게 암호화되어 검증됩니다.'}
          </p>
        </form>
      </div>
    </div>
  );
}
