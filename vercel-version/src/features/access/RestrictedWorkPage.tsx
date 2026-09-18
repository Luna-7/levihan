import React, { useEffect, useState } from 'react';
import { getPublicWork } from '../works/api';
import { AgeGate } from './AgeGate';
import { getAgePolicy, getRestrictedAccess, type RestrictedAccessResponse } from './api';
import { MangaCommentSection } from '../../components/MangaCommentSection';
import { useReadingProgress } from '../../hooks/useReadingProgress';

type Metadata = Awaited<ReturnType<typeof getPublicWork>>['work'];
type Policy = Awaited<ReturnType<typeof getAgePolicy>>;

export function RestrictedWorkPage({ slug, onClose }: { slug: string; onClose: () => void }) {
  const [metadata, setMetadata] = useState<Metadata | null>(null);
  const [policy, setPolicy] = useState<Policy | null>(null);
  const [access, setAccess] = useState<RestrictedAccessResponse | null>(null);
  const [message, setMessage] = useState('');
  const syncedProgress = useReadingProgress(access ? slug : null);

  useEffect(() => {
    let active = true;
    setAccess(null);
    setMessage('');
    Promise.all([getPublicWork(slug), getAgePolicy()]).then(([work, nextPolicy]) => {
      if (!active) return;
      if (work.work.rating !== 'restricted' || !work.work.accessId) throw new Error('Not restricted');
      setMetadata(work.work);
      setPolicy(nextPolicy);
    }).catch(() => { if (active) setMessage('内容已下架、规则已更新或暂时无法访问'); });
    return () => { active = false; setAccess(null); };
  }, [slug]);

  useEffect(() => {
    if (!access || access.assets.length === 0) return undefined;
    const expiresAt = Math.min(...access.assets.map((asset) => new Date(asset.expiresAt).getTime()));
    const timer = window.setTimeout(() => setAccess(null), Math.max(0, expiresAt - Date.now()));
    return () => window.clearTimeout(timer);
  }, [access]);

  const close = () => { setAccess(null); onClose(); };
  const refresh = async () => {
    if (!metadata?.accessId) return;
    setAccess(null);
    try { setAccess(await getRestrictedAccess(metadata.accessId)); }
    catch { setMessage('登录、年龄声明或内容状态已变化，请重新确认'); }
  };
  const finish = async () => {
    if (!access) return;
    if (!['comic', 'novel'].includes(access.work.type)) { setMessage('此内容类型不支持阅读进度'); return; }
    const comicPage = Math.max(1, ...access.assets.map((asset) => asset.pageNo || 0));
    const novelChapter = Math.max(1, ...access.assets.map((asset) => asset.chapterPosition || 0));
    const position = access.work.type === 'comic' ? { kind: 'comic' as const, page: comicPage } : { kind: 'novel' as const, chapter: novelChapter, offset: 0 };
    try {
      const result = await syncedProgress.save(position, 100);
      setMessage(result.accepted ? '阅读进度已同步到账号' : '其他设备已有更新进度，请确认后重试');
    } catch { setMessage('跨设备进度暂未同步'); }
  };

  if (message && !metadata) return <main className="p-6"><p role="alert">{message}</p><button type="button" onClick={close}>返回</button></main>;
  if (!metadata || !policy) return <main className="p-6" aria-busy="true">正在加载内容规则…</main>;
  if (!access) return <main className="p-6">
    <h1>{metadata.title}</h1>
    <p>{metadata.summary}</p>
    <AgeGate workId={metadata.accessId!} policyVersion={policy.policyVersion} warning={policy.warning} onGranted={(value) => { setMessage(''); setAccess(value); }} onDenied={() => setAccess(null)} />
    <button type="button" onClick={close}>返回</button>
  </main>;

  return <main className="p-6" aria-label="受限内容阅读器">
    <header><h1>{access.work.title}</h1><button type="button" onClick={close}>关闭阅读器</button></header>
    {message && <p role="alert">{message}</p>}
    <button type="button" onClick={refresh}>刷新访问</button>
    <section>
      {access.assets.map((asset, index) => asset.mimeType.startsWith('image/')
        ? <img key={asset.id} src={asset.url} alt={`${access.work.title} 第 ${asset.pageNo || index + 1} 页`} referrerPolicy="no-referrer" />
        : <a key={asset.id} href={asset.url} referrerPolicy="no-referrer">读取内容 {index + 1}</a>)}
    </section>
    {['comic', 'novel'].includes(access.work.type) && <button type="button" disabled={syncedProgress.saving} onClick={() => void finish()}>完成并同步进度</button>}
    <MangaCommentSection bookId={slug} bookTitle={access.work.title} onShowToast={setMessage} />
  </main>;
}
