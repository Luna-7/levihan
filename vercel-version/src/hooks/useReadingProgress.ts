import { useCallback, useEffect, useRef, useState } from 'react';
import { getReadingProgress, syncReadingProgress, type ReadingPosition, type ReadingProgress } from '../features/interactions/api';

export function useReadingProgress(workRef: string | null, logicVersion = 1) {
  const [progress, setProgress] = useState<ReadingProgress | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const clientVersion = useRef(0);
  const serverVersion = useRef(0);

  useEffect(() => {
    let current = true;
    if (!workRef) { setProgress(null); setLoading(false); setError(null); return () => { current = false; }; }
    setLoading(true); setError(null);
    getReadingProgress(workRef).then((value) => {
      if (!current) return;
      setProgress(value); clientVersion.current = value?.clientVersion || 0; serverVersion.current = value?.version || 0;
    }).catch((cause: unknown) => { if (current) setError(cause instanceof Error ? cause : new Error('读取进度失败')); })
      .finally(() => { if (current) setLoading(false); });
    return () => { current = false; };
  }, [workRef]);

  const save = useCallback(async (position: ReadingPosition, percent: number) => {
    if (!workRef) throw new Error('未选择作品');
    const nextVersion = clientVersion.current + 1;
    const mutationId = globalThis.crypto.randomUUID();
    setSaving(true); setError(null);
    try {
      const result = await syncReadingProgress(workRef, { position, percent, logicVersion, clientVersion: nextVersion, baseVersion: serverVersion.current, mutationId });
      clientVersion.current = Math.max(clientVersion.current, result.clientVersion);
      serverVersion.current = result.version;
      const { accepted: _accepted, ...authoritative } = result;
      setProgress(authoritative);
      return result;
    } catch (cause) {
      const normalized = cause instanceof Error ? cause : new Error('同步进度失败'); setError(normalized); throw normalized;
    } finally { setSaving(false); }
  }, [logicVersion, workRef]);

  return { progress, loading, saving, error, save };
}
