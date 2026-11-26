import type {AuthMode} from '../types.ts';

export type ActiveTab = 'editor' | 'vault';

interface TopBarProps {
  activeTab: ActiveTab;
  onTabChange: (tab: ActiveTab) => void;
  savedCount: number;
  authMode: AuthMode;
  onOpenChangePassword: () => void;
  onLogout: () => void;
}

export function TopBar({
  activeTab,
  onTabChange,
  savedCount,
  authMode,
  onOpenChangePassword,
  onLogout,
}: TopBarProps) {
  return (
    <header className="sticky top-0 z-30 bg-white/95 backdrop-blur border-b border-[#E4E4E0]">
      <div className="max-w-[1440px] mx-auto px-4 sm:px-6 h-14 flex items-center justify-between gap-8">
        <button
          type="button"
          onClick={() => onTabChange('editor')}
          className="text-lg font-bold tracking-tight text-zinc-900 whitespace-nowrap shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 rounded"
        >
          FrameStudio
        </button>

        <nav className="flex items-center gap-6 text-sm font-medium overflow-x-auto">
          <button
            type="button"
            onClick={() => onTabChange('editor')}
            className={`py-4 border-b-2 transition-colors whitespace-nowrap shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 ${
              activeTab === 'editor'
                ? 'border-blue-600 text-zinc-900 font-semibold'
                : 'border-transparent text-zinc-600 hover:text-zinc-900'
            }`}
          >
            사진 편집기
          </button>

          <button
            type="button"
            onClick={() => onTabChange('vault')}
            className={`py-4 border-b-2 transition-colors whitespace-nowrap shrink-0 tabular-nums focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 ${
              activeTab === 'vault'
                ? 'border-blue-600 text-zinc-900 font-semibold'
                : 'border-transparent text-zinc-600 hover:text-zinc-900'
            }`}
          >
            저장 보관함 ({savedCount})
          </button>

          {authMode === 'claimed' && (
            <button
              type="button"
              onClick={onOpenChangePassword}
              className="py-4 border-b-2 border-transparent text-zinc-600 hover:text-zinc-900 transition-colors whitespace-nowrap shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600"
            >
              비밀번호 변경
            </button>
          )}
        </nav>

        <div className="flex items-center shrink-0">
          <button
            type="button"
            onClick={onLogout}
            className="px-4 py-2 text-xs font-semibold text-zinc-800 bg-zinc-100 hover:bg-zinc-200 border border-zinc-300 rounded-lg transition-colors whitespace-nowrap shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600"
          >
            잠금 로그아웃
          </button>
        </div>
      </div>
    </header>
  );
}
