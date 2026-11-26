/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import {useCallback, useEffect, useState} from 'react';
import {AuthGate} from './components/AuthGate.tsx';
import {ChangePasswordModal} from './components/ChangePasswordModal.tsx';
import {SavedVault} from './components/SavedVault.tsx';
import {StudioEditor} from './components/StudioEditor.tsx';
import {TopBar} from './components/TopBar.tsx';
import type {ActiveTab} from './components/TopBar.tsx';
import type {AuthMode, SavedPhotoRecord, SourceImage} from './types.ts';
import {
  fetchSavedPhotos,
  getAuthStatus,
  logoutSession,
} from './utils/api.ts';
import {loadImageFromBlob} from './utils/imageProcessor.ts';

export default function App() {
  const [authLoading, setAuthLoading] = useState(true);
  const [authMode, setAuthMode] = useState<AuthMode>('unclaimed');
  const [token, setToken] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<ActiveTab>('editor');
  const [savedPhotos, setSavedPhotos] = useState<SavedPhotoRecord[]>([]);
  const [loadingVault, setLoadingVault] = useState(false);
  const [source, setSource] = useState<SourceImage | null>(null);
  const [showChangePassword, setShowChangePassword] = useState(false);

  const refreshAuthStatus = useCallback(async (currentToken: string | null) => {
    try {
      const status = await getAuthStatus(currentToken);
      setAuthMode(status.mode);
      if (!status.authenticated) {
        setToken(null);
      }
    } catch {
      setToken(null);
    } finally {
      setAuthLoading(false);
    }
  }, []);

  useEffect(() => {
    void refreshAuthStatus(null);
  }, [refreshAuthStatus]);

  useEffect(() => {
    if (!token) {
      setSavedPhotos([]);
      return;
    }
    let cancelled = false;
    setLoadingVault(true);
    fetchSavedPhotos(token)
      .then((list) => {
        if (!cancelled) setSavedPhotos(list);
      })
      .catch(() => {
        if (!cancelled) {
          void refreshAuthStatus(token);
        }
      })
      .finally(() => {
        if (!cancelled) setLoadingVault(false);
      });
    return () => {
      cancelled = true;
    };
  }, [token, refreshAuthStatus]);

  const handleSourceLoaded = useCallback((next: SourceImage) => {
    setSource((prev) => {
      if (prev) URL.revokeObjectURL(prev.objectUrl);
      return next;
    });
  }, []);

  const handleLoadIntoEditor = useCallback(
    async (blob: Blob, name: string) => {
      try {
        const loaded = await loadImageFromBlob(blob, name);
        handleSourceLoaded(loaded);
        setActiveTab('editor');
      } catch {
        // Fallback handled in Vault
      }
    },
    [handleSourceLoaded],
  );

  const handleLogout = useCallback(async () => {
    const activeToken = token;
    setToken(null);
    setSavedPhotos([]);
    setShowChangePassword(false);
    setSource((prev) => {
      if (prev) URL.revokeObjectURL(prev.objectUrl);
      return null;
    });
    if (activeToken) {
      await logoutSession(activeToken).catch(() => undefined);
    }
    await refreshAuthStatus(null);
  }, [token, refreshAuthStatus]);

  const handleAuthExpired = useCallback(() => {
    setToken(null);
    void refreshAuthStatus(null);
  }, [refreshAuthStatus]);

  if (authLoading) {
    return (
      <div className="min-h-screen bg-[#F7F7F5] flex items-center justify-center">
        <p className="text-sm text-zinc-500">스튜디오 상태를 확인하는 중...</p>
      </div>
    );
  }

  if (!token) {
    return (
      <AuthGate
        mode={authMode}
        onAuthenticated={(nextToken, nextMode) => {
          setAuthMode(nextMode);
          setToken(nextToken);
          setActiveTab('editor');
        }}
      />
    );
  }

  return (
    <div className="min-h-screen bg-[#F7F7F5] text-[#18181B] flex flex-col">
      <TopBar
        activeTab={activeTab}
        onTabChange={setActiveTab}
        savedCount={savedPhotos.length}
        authMode={authMode}
        onOpenChangePassword={() => setShowChangePassword(true)}
        onLogout={() => void handleLogout()}
      />

      <main className="flex-1">
        <div className={activeTab === 'editor' ? 'block' : 'hidden'}>
          <StudioEditor
            token={token}
            source={source}
            onSourceLoaded={handleSourceLoaded}
            onSaved={(record) => setSavedPhotos((prev) => [record, ...prev])}
            onOpenVault={() => setActiveTab('vault')}
            onAuthExpired={handleAuthExpired}
          />
        </div>
        {activeTab === 'vault' && (
          <SavedVault
            token={token}
            photos={savedPhotos}
            loading={loadingVault}
            onPhotosChange={setSavedPhotos}
            onLoadIntoEditor={(blob, name) => void handleLoadIntoEditor(blob, name)}
            onGoToEditor={() => setActiveTab('editor')}
            onAuthExpired={handleAuthExpired}
          />
        )}
      </main>

      {showChangePassword && (
        <ChangePasswordModal
          token={token}
          onClose={() => setShowChangePassword(false)}
          onPasswordChanged={(nextToken) => setToken(nextToken)}
        />
      )}
    </div>
  );
}
