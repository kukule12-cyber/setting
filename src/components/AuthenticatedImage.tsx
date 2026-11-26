import {useEffect, useState} from 'react';
import {ImageOff} from 'lucide-react';
import {fetchPhotoBlob} from '../utils/api.ts';

interface AuthenticatedImageProps {
  token: string;
  photoId: string;
  alt: string;
  className?: string;
}

export function AuthenticatedImage({
  token,
  photoId,
  alt,
  className = '',
}: AuthenticatedImageProps) {
  const [src, setSrc] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let active = true;
    let objectUrl: string | null = null;
    setFailed(false);
    setSrc(null);

    fetchPhotoBlob(token, photoId)
      .then((blob) => {
        if (!active) return;
        objectUrl = URL.createObjectURL(blob);
        setSrc(objectUrl);
      })
      .catch(() => {
        if (active) setFailed(true);
      });

    return () => {
      active = false;
      if (objectUrl) {
        URL.revokeObjectURL(objectUrl);
      }
    };
  }, [token, photoId]);

  if (failed) {
    return (
      <div
        className={`flex flex-col items-center justify-center gap-1.5 bg-zinc-100 text-zinc-500 p-4 text-center ${className}`}
      >
        <ImageOff className="w-5 h-5" />
        <span className="text-xs truncate max-w-full">{alt}</span>
      </div>
    );
  }

  if (!src) {
    return <div className={`bg-zinc-100 animate-pulse ${className}`} />;
  }

  return (
    <img
      src={src}
      alt={alt}
      referrerPolicy="no-referrer"
      onError={() => setFailed(true)}
      className={className}
    />
  );
}
