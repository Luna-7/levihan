import { useLayoutEffect, useRef, useState } from 'react';

let comicMusicAudio: HTMLAudioElement | null = null;
const MUSIC_FILE_RE = /^music-[A-Za-z0-9_-]{1,64}\.(mp3|m4a)$/i;

function getComicMusicAudio() {
  if (typeof document === 'undefined') return null;
  if (!comicMusicAudio) {
    comicMusicAudio = document.createElement('audio');
    comicMusicAudio.loop = true;
    comicMusicAudio.preload = 'metadata';
    comicMusicAudio.setAttribute('aria-label', '本子配乐');
    comicMusicAudio.setAttribute('aria-hidden', 'true');
    comicMusicAudio.tabIndex = -1;
    comicMusicAudio.className = 'comic-music-audio';
  }
  return comicMusicAudio;
}

function handlePlaybackFailure(error: unknown) {
  if ((error as { name?: string } | null)?.name !== 'NotAllowedError') return;
  document.dispatchEvent(new Event('comic-music-play-blocked'));
}

export function isComicMusicFile(file: unknown) {
  return MUSIC_FILE_RE.test(String(file || ''));
}

export function prepareComicMusic(source: string) {
  const audio = getComicMusicAudio();
  if (!audio || !source) {
    stopComicMusic();
    return;
  }

  audio.pause();
  if (audio.src !== source) {
    audio.src = source;
    audio.load();
  } else {
    audio.currentTime = 0;
  }
  document.dispatchEvent(new Event('comic-music-source-change'));
}

export function stopComicMusic() {
  const audio = comicMusicAudio;
  if (!audio) return;
  audio.pause();
  audio.removeAttribute('src');
  audio.load();
}

function toggleComicMusic() {
  const audio = getComicMusicAudio();
  if (!audio) return;
  if (audio.paused) {
    void audio.play().catch(handlePlaybackFailure);
  } else {
    audio.pause();
  }
}

function formatTime(seconds: number) {
  if (!Number.isFinite(seconds) || seconds < 0) return '0:00';
  const totalSeconds = Math.floor(seconds);
  return `${Math.floor(totalSeconds / 60)}:${String(totalSeconds % 60).padStart(2, '0')}`;
}

type ComicMusicPlayerProps = {
  title?: string;
};

export function ComicMusicPlayer({ title = '本子配乐' }: ComicMusicPlayerProps) {
  const audioHostRef = useRef<HTMLDivElement | null>(null);
  const [isPlaying, setIsPlaying] = useState(() => !!comicMusicAudio && !comicMusicAudio.paused);
  const [currentTime, setCurrentTime] = useState(() => comicMusicAudio?.currentTime || 0);
  const [duration, setDuration] = useState(() => (
    Number.isFinite(comicMusicAudio?.duration) ? comicMusicAudio?.duration || 0 : 0
  ));
  const [message, setMessage] = useState('');

  useLayoutEffect(() => {
    const audio = getComicMusicAudio();
    const host = audioHostRef.current;
    if (!audio || !host) return undefined;

    const onError = () => setMessage('音乐无法加载，请联系管理员检查文件。');
    const onPlaying = () => {
      setIsPlaying(true);
      setMessage('');
    };
    const onPause = () => setIsPlaying(false);
    const onTimeUpdate = () => setCurrentTime(audio.currentTime || 0);
    const onDurationChange = () => setDuration(Number.isFinite(audio.duration) ? audio.duration : 0);
    const onSourceChange = () => {
      setIsPlaying(!audio.paused);
      setCurrentTime(audio.currentTime || 0);
      setDuration(Number.isFinite(audio.duration) ? audio.duration : 0);
      setMessage('');
    };
    const onPlayBlocked = () => setMessage('音乐暂时无法播放，请重试。');

    host.appendChild(audio);
    audio.addEventListener('error', onError);
    audio.addEventListener('playing', onPlaying);
    audio.addEventListener('pause', onPause);
    audio.addEventListener('timeupdate', onTimeUpdate);
    audio.addEventListener('durationchange', onDurationChange);
    audio.addEventListener('loadedmetadata', onDurationChange);
    document.addEventListener('comic-music-source-change', onSourceChange);
    document.addEventListener('comic-music-play-blocked', onPlayBlocked);
    setIsPlaying(!audio.paused);
    setCurrentTime(audio.currentTime || 0);
    setDuration(Number.isFinite(audio.duration) ? audio.duration : 0);
    if (audio.error) onError();

    return () => {
      audio.removeEventListener('error', onError);
      audio.removeEventListener('playing', onPlaying);
      audio.removeEventListener('pause', onPause);
      audio.removeEventListener('timeupdate', onTimeUpdate);
      audio.removeEventListener('durationchange', onDurationChange);
      audio.removeEventListener('loadedmetadata', onDurationChange);
      document.removeEventListener('comic-music-source-change', onSourceChange);
      document.removeEventListener('comic-music-play-blocked', onPlayBlocked);
      if (audio.parentElement === host) host.removeChild(audio);
    };
  }, []);

  const progress = duration ? Math.min(currentTime, duration) : 0;

  return (
    <section className="comic-reader-content comic-book-music" aria-label="本子配乐播放器">
      <div className={`comic-book-music-art${isPlaying ? ' is-playing' : ''}`} aria-hidden="true">
        <div className="comic-turntable-stage">
          <div className="comic-vinyl-disc">
            <div className="comic-vinyl-rim">
              <div className="comic-vinyl-label">
                <div className="comic-vinyl-center" />
              </div>
            </div>
          </div>
          <div className="comic-turntable-arm" />
        </div>
      </div>
      <div className="comic-book-music-main">
        <div className="comic-book-music-head">
          <span className="comic-book-music-title" title={title}>{title}</span>
          <button
            type="button"
            className="comic-book-music-toggle"
            onClick={toggleComicMusic}
            aria-label={isPlaying ? '暂停配乐' : '播放配乐'}
            aria-pressed={isPlaying}
            title={isPlaying ? '暂停配乐' : '播放配乐'}
          >
            {isPlaying ? (
              <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
                <path d="M8 5.5h3v13H8zM14 5.5h3v13h-3z" fill="currentColor" />
              </svg>
            ) : (
              <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
                <path d="M8 5.2c0-.7.8-1.1 1.4-.7l10 6.5a1.2 1.2 0 0 1 0 2l-10 6.5c-.6.4-1.4 0-1.4-.7z" fill="currentColor" />
              </svg>
            )}
          </button>
        </div>
        <div className="comic-book-music-progress">
          <span aria-hidden="true">{formatTime(currentTime)}</span>
          <input
            type="range"
            min="0"
            max={duration || 1}
            step="0.1"
            value={progress}
            disabled={!duration}
            aria-label="音乐播放进度"
            onChange={(event) => {
              const audio = getComicMusicAudio();
              const nextTime = Number(event.currentTarget.value);
              if (audio && Number.isFinite(nextTime)) {
                audio.currentTime = nextTime;
                setCurrentTime(nextTime);
              }
            }}
          />
          <span aria-hidden="true">{duration ? formatTime(duration) : '--:--'}</span>
        </div>
        {message && <span className="comic-book-music-status" role="status" aria-live="polite">{message}</span>}
        <div className="comic-music-audio-host" ref={audioHostRef} />
      </div>
    </section>
  );
}
