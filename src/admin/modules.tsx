import React, { useEffect, useState } from 'react';
import {
  archiveWork, completeAdminUpload, createOperationKey, createWork, getAdminWork,
  initAdminUpload, listAdminWorks, publishWork, rebuildCatalogSnapshot, restoreWork,
  reviewWork, updateWork, uploadToCos,
} from '../features/works/api';
import {
  adminRequest, adminWrite, createQuestion, listAudit, listJobs, listModeration,
  listQuestions, listUsers, operationKey, retryJob, setQuestionStatus, setUserStatus,
  updateQuestion, type AdminJob, type AdminQuestion, type AdminUser, type AuditItem,
  type ModerationItem,
} from './api';

function message(error: unknown) { return error instanceof Error ? error.message : '操作失败'; }
type AdminUploadInit = Awaited<ReturnType<typeof initAdminUpload>>;

export async function resumeAdminUpload(ticket: AdminUploadInit, file: File) {
  if ('uploadUrl' in ticket) await uploadToCos(ticket, file);
  if ('status' in ticket && ticket.status === 'verified' && 'assetId' in ticket) return ticket;
  return completeAdminUpload(ticket.uploadId, createOperationKey());
}

export function WorksAdmin() {
  type Work = Awaited<ReturnType<typeof getAdminWork>>['work'];
  const [items, setItems] = useState<Work[]>([]); const [cursor, setCursor] = useState<string | null>(null);
  const [status, setStatus] = useState<'draft' | 'review' | 'published' | 'archived' | ''>('');
  const [selected, setSelected] = useState<Work | null>(null); const [notice, setNotice] = useState('');
  const [slug, setSlug] = useState(''); const [title, setTitle] = useState(''); const [summary, setSummary] = useState('');
  const [type, setType] = useState<'comic' | 'novel' | 'art' | 'resource'>('comic'); const [rating, setRating] = useState<'general' | 'mature' | 'restricted'>('general'); const [author, setAuthor] = useState('');
  const [chapterTitle, setChapterTitle] = useState(''); const [selectedChapterId, setSelectedChapterId] = useState(''); const [assetKind, setAssetKind] = useState<'cover' | 'page' | 'body' | 'attachment' | 'preview'>('cover'); const [pageNo, setPageNo] = useState(1);
  const load = (next?: string) => void listAdminWorks({ status: status || undefined, limit: 20, cursor: next }).then((result) => { setItems((old) => next ? [...old, ...result.items] : result.items); setCursor(result.nextCursor); }).catch((error) => setNotice(message(error)));
  useEffect(() => load(), [status]);
  async function make() { try { await createWork({ slug, type, title, summary, rating, authorName: author }, createOperationKey()); setSlug(''); setTitle(''); load(); } catch (error) { setNotice(message(error)); } }
  async function select(work: Work) { try { const result = await getAdminWork(work.id); setSelected(result.work); setSelectedChapterId(result.work.chapters?.[0]?.id || ''); setTitle(result.work.title); setSummary(result.work.summary); setRating(result.work.rating); setAuthor(result.work.authorName); } catch (error) { setNotice(message(error)); } }
  async function save() { if (!selected) return; try { const chapters = selected.chapters?.map((chapter) => ({ id: chapter.id, title: chapter.title, position: chapter.position, version: chapter.version })) || []; if (chapterTitle) chapters.push({ id: null, title: chapterTitle, position: chapters.length + 1, version: null }); await updateWork(selected.id, { version: selected.version, title, summary, rating, authorName: author, chapters }, createOperationKey()); setChapterTitle(''); await select(selected); load(); } catch (error) { setNotice(message(error)); } }
  function renameChapter(id: string, value: string) { if (!selected) return; setSelected({ ...selected, chapters: selected.chapters?.map((chapter) => chapter.id === id ? { ...chapter, title: value } : chapter) }); }
  function moveChapter(id: string, delta: number) { if (!selected?.chapters) return; const chapters = [...selected.chapters].sort((a, b) => a.position - b.position); const index = chapters.findIndex((chapter) => chapter.id === id); const other = index + delta; if (index < 0 || other < 0 || other >= chapters.length) return; [chapters[index], chapters[other]] = [chapters[other], chapters[index]]; setSelected({ ...selected, chapters: chapters.map((chapter, position) => ({ ...chapter, position: position + 1 })) }); }
  async function upload(file: File) { if (!selected) return; if (selected.chapters?.length && ['page', 'body', 'attachment'].includes(assetKind) && !selectedChapterId) { setNotice('请选择素材所属章节'); return; } try { const digest = await crypto.subtle.digest('SHA-256', await file.arrayBuffer()); const checksum = [...new Uint8Array(digest)].map((value) => value.toString(16).padStart(2, '0')).join(''); const ticket = await initAdminUpload({ workId: selected.id, ...(selectedChapterId ? { chapterId: selectedChapterId } : {}), filename: file.name.toLowerCase(), mimeType: file.type, sizeBytes: file.size, checksum, kind: assetKind, ...(assetKind === 'page' ? { pageNo } : {}), accessLevel: selected.rating === 'restricted' ? 'private' : 'public' }, createOperationKey()); await resumeAdminUpload(ticket, file); await select(selected); setNotice('素材已验证'); } catch (error) { setNotice(message(error)); } }
  async function transition(work: Work) { if (!window.confirm('这是危险操作，确认继续？')) return; try { if (work.status === 'draft') await reviewWork(work.id, work.version, createOperationKey()); else if (work.status === 'review') await publishWork(work.id, work.version, createOperationKey()); else if (work.status === 'published') await archiveWork(work.id, work.version, createOperationKey()); else await restoreWork(work.id, work.version, createOperationKey()); load(); } catch (error) { setNotice(message(error)); } }
  return <>
    <p role="alert">{notice}</p>
    <label>状态筛选
      <select value={status} onChange={(event) => setStatus(event.target.value as typeof status)}>
        <option value="">全部</option><option value="draft">draft</option><option value="review">review</option><option value="published">published</option><option value="archived">archived</option>
      </select>
    </label>
    <fieldset>
      <legend>创建/编辑作品</legend>
      <label>Slug<input value={slug} disabled={Boolean(selected)} onChange={(event) => setSlug(event.target.value)} /></label>
      <label>标题<input value={title} onChange={(event) => setTitle(event.target.value)} /></label>
      <label>摘要<textarea value={summary} onChange={(event) => setSummary(event.target.value)} /></label>
      <label>作者<input value={author} onChange={(event) => setAuthor(event.target.value)} /></label>
      <label>类型<select value={type} disabled={Boolean(selected)} onChange={(event) => setType(event.target.value as typeof type)}>{['comic', 'novel', 'art', 'resource'].map((value) => <option key={value}>{value}</option>)}</select></label>
      <label>分级<select value={rating} onChange={(event) => setRating(event.target.value as typeof rating)}>{['general', 'mature', 'restricted'].map((value) => <option key={value}>{value}</option>)}</select></label>
      {selected ? <button onClick={() => void save()}>保存作品/章节</button> : <button onClick={() => void make()}>新建作品</button>}
    </fieldset>
    <button onClick={() => void rebuildCatalogSnapshot(createOperationKey()).then(() => setNotice('快照已重建')).catch((error) => setNotice(message(error)))}>重建公开快照</button>
    <ul>{items.map((work) => <li key={work.id}>{work.title} · {work.rating} · {work.status} · v{work.version} <button onClick={() => void select(work)}>编辑章节/素材</button> <button onClick={() => void transition(work)}>{work.status === 'published' ? '下线' : '推进状态'}</button></li>)}</ul>
    {cursor && <button onClick={() => load(cursor)}>下一页</button>}
    {selected && <fieldset>
      <legend>{selected.title} 发布检查</legend>
      <p>章节 {selected.chapters?.length || 0} · 已验证素材 {selected.assets?.filter((asset) => ['active', 'verified'].includes(asset.status)).length || 0} · 私有素材 {selected.assets?.filter((asset) => asset.storageZone === 'private').length || 0}</p>
      <ol>{[...(selected.chapters || [])].sort((a, b) => a.position - b.position).map((chapter) => <li key={chapter.id}><input aria-label={`章节 ${chapter.position}`} value={chapter.title} onChange={(event) => renameChapter(chapter.id, event.target.value)} /><button onClick={() => moveChapter(chapter.id, -1)}>上移</button><button onClick={() => moveChapter(chapter.id, 1)}>下移</button></li>)}</ol>
      <label>新增章节<input value={chapterTitle} onChange={(event) => setChapterTitle(event.target.value)} /></label>
      {selected.chapters?.length ? <label>素材所属章节
        <select aria-label="素材所属章节" value={selectedChapterId} onChange={(event) => setSelectedChapterId(event.target.value)}>
          <option value="">请选择</option>
          {[...selected.chapters].sort((a, b) => a.position - b.position).map((chapter) => <option key={chapter.id} value={chapter.id}>{chapter.position}. {chapter.title}</option>)}
        </select>
      </label> : null}
      <label>素材类型<select value={assetKind} onChange={(event) => setAssetKind(event.target.value as typeof assetKind)}>{['cover', 'page', 'body', 'attachment', 'preview'].map((value) => <option key={value}>{value}</option>)}</select></label>
      {assetKind === 'page' && <label>页序<input type="number" min={1} value={pageNo} onChange={(event) => setPageNo(Number(event.target.value))} /></label>}
      <label>上传素材<input aria-label="上传素材" type="file" onChange={(event) => { const file = event.target.files?.[0]; if (file) void upload(file); }} /></label>
    </fieldset>}
  </>;
}

type SubmissionItem = { id: string; title: string; status: string; version: number; internalNote?: string };
export function SubmissionsAdmin() {
  const [items, setItems] = useState<SubmissionItem[]>([]); const [cursor, setCursor] = useState<string | null>(null); const [status, setStatus] = useState(''); const [reason, setReason] = useState(''); const [note, setNote] = useState(''); const [notice, setNotice] = useState('');
  const load = (next?: string) => { const query = new URLSearchParams({ limit: '20' }); if (status) query.set('status', status); if (next) query.set('cursor', next); void adminRequest<{ items: SubmissionItem[]; nextCursor: string | null }>(`/admin/submissions?${query}`).then((result) => { setItems((old) => next ? [...old, ...result.items] : result.items); setCursor(result.nextCursor); }).catch((error) => setNotice(message(error))); };
  useEffect(() => load(), [status]);
  async function review(item: SubmissionItem, action: 'start_review' | 'accept' | 'reject') { if ((action === 'accept' || action === 'reject') && !window.confirm('确认提交审核结论？')) return; try { await adminWrite(`/admin/submissions/${item.id}`, { version: item.version, action, ...(action === 'reject' ? { rejectionReason: reason } : {}), ...(note ? { internalNote: note } : {}) }, operationKey(), 'PATCH'); load(); } catch (error) { setNotice(message(error)); } }
  return <><p role="alert">{notice}</p><label>状态筛选<select value={status} onChange={(event) => setStatus(event.target.value)}><option value="">全部</option><option value="submitted">submitted</option><option value="under_review">under_review</option></select></label><label>拒绝原因<input value={reason} onChange={(event) => setReason(event.target.value)} /></label><label>内部备注<textarea value={note} onChange={(event) => setNote(event.target.value)} /></label><ul>{items.map((item) => <li key={item.id}>{item.title} · {item.status} · v{item.version} {item.internalNote && <details><summary>内部备注</summary>{item.internalNote}</details>}<button onClick={() => void review(item, 'start_review')}>开始审核</button><button onClick={() => void review(item, 'accept')}>接受</button><button onClick={() => void review(item, 'reject')}>拒绝</button></li>)}</ul>{cursor && <button onClick={() => load(cursor)}>下一页</button>}</>;
}

export function ModerationAdmin() {
  const [comments, setComments] = useState<ModerationItem[]>([]); const [reports, setReports] = useState<ModerationItem[]>([]); const [commentCursor, setCommentCursor] = useState<string | null>(null); const [reportCursor, setReportCursor] = useState<string | null>(null); const [reason, setReason] = useState('后台审核'); const [notice, setNotice] = useState('');
  const load = (kind: 'comments' | 'reports', cursor?: string) => void listModeration(kind, { status: 'pending', cursor }).then((result) => { if (kind === 'comments') { setComments((old) => cursor ? [...old, ...result.items] : result.items); setCommentCursor(result.nextCursor); } else { setReports((old) => cursor ? [...old, ...result.items] : result.items); setReportCursor(result.nextCursor); } }).catch((error) => setNotice(message(error)));
  useEffect(() => { load('comments'); load('reports'); }, []);
  async function comment(item: ModerationItem, action: 'hide' | 'restore') { if (!window.confirm(`确认${action}评论？`)) return; try { await adminWrite(`/admin/comments/${item.id}/${action}`, { reason }, operationKey()); load('comments'); } catch (error) { setNotice(message(error)); } }
  async function report(item: ModerationItem, status: 'resolved' | 'rejected') { if (!window.confirm(`确认将举报设为 ${status}？`)) return; try { await adminWrite(`/admin/reports/${item.id}`, { status, reason }, operationKey()); load('reports'); } catch (error) { setNotice(message(error)); } }
  return <><p role="alert">{notice}</p><label>处置原因<input value={reason} onChange={(event) => setReason(event.target.value)} /></label><h2>评论</h2><ul>{comments.map((item) => <li key={item.id}>{item.body} · {item.status} <button onClick={() => void comment(item, item.status === 'hidden' ? 'restore' : 'hide')}>{item.status === 'hidden' ? '恢复' : '隐藏'}</button></li>)}</ul>{commentCursor && <button onClick={() => load('comments', commentCursor)}>评论下一页</button>}<h2>举报</h2><ul>{reports.map((item) => <li key={item.id}>{item.reason} · {item.status} <button onClick={() => void report(item, 'resolved')}>解决</button><button onClick={() => void report(item, 'rejected')}>驳回</button></li>)}</ul>{reportCursor && <button onClick={() => load('reports', reportCursor)}>举报下一页</button>}</>;
}

export function UsersAdmin() {
  const [items, setItems] = useState<AdminUser[]>([]); const [cursor, setCursor] = useState<string | null>(null); const [notice, setNotice] = useState(''); const [statusFilter, setStatusFilter] = useState(''); const [search, setSearch] = useState('');
  const load = (next?: string) => void listUsers({ status: statusFilter || undefined, search: search || undefined, cursor: next }).then((result) => { setItems((old) => next ? [...old, ...result.items] : result.items); setCursor(result.nextCursor); }).catch((error) => setNotice(message(error)));
  useEffect(() => load(), [statusFilter]);
  async function change(user: AdminUser) { const status = user.status === 'active' ? 'suspended' : 'active'; if (!window.confirm(`确认${status === 'active' ? '恢复' : '停用'} ${user.username}？`)) return; setItems((all) => all.map((item) => item.id === user.id ? { ...item, status } : item)); try { const result = await setUserStatus(user.id, user.version, status, 'admin console'); setItems((all) => all.map((item) => item.id === user.id ? result.user : item)); } catch (error) { setItems((all) => all.map((item) => item.id === user.id ? user : item)); setNotice(message(error)); } }
  async function restricted(user: AdminUser, action: 'revoke' | 'restore') { if (!window.confirm(`确认${action === 'revoke' ? '限制' : '恢复'} ${user.username} 的 R18 访问？`)) return; try { await adminWrite(`/admin/users/${user.id}/restricted-access/${action}`, { reason: 'admin console moderation' }, operationKey()); setNotice(action === 'revoke' ? 'R18 访问已限制' : 'R18 访问已恢复'); } catch (error) { setNotice(message(error)); } }
  return <><p role="alert">{notice}</p><label>用户名<input value={search} onChange={(event) => setSearch(event.target.value)} /></label><button onClick={() => load()}>搜索</button><label>状态筛选<select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}><option value="">全部</option><option value="active">active</option><option value="suspended">suspended</option></select></label><ul>{items.map((user) => <li key={user.id}>{user.username} · {user.role} · {user.status} · 会话 {user.activeSessions} · 最近登录 {user.lastLoginAt || '无'} <button onClick={() => void change(user)}>{user.status === 'active' ? '停用' : '恢复'}</button><button onClick={() => void restricted(user, 'revoke')}>限制 R18</button><button onClick={() => void restricted(user, 'restore')}>恢复 R18</button></li>)}</ul>{cursor && <button onClick={() => load(cursor)}>下一页</button>}</>;
}

export function QuestionsAdmin() {
  const [items, setItems] = useState<AdminQuestion[]>([]); const [cursor, setCursor] = useState<string | null>(null); const [editing, setEditing] = useState<AdminQuestion | null>(null); const [notice, setNotice] = useState('');
  const [prompt, setPrompt] = useState(''); const [options, setOptions] = useState('是\n否'); const [answers, setAnswers] = useState(''); const [rule, setRule] = useState<AdminQuestion['normalizationRule']>('trim_lowercase'); const [weight, setWeight] = useState(1);
  const load = (next?: string) => void listQuestions({ cursor: next }).then((result) => { setItems((old) => next ? [...old, ...result.items] : result.items); setCursor(result.nextCursor); }).catch((error) => setNotice(message(error)));
  useEffect(() => load(), []);
  async function save() { const optionList = options.split('\n').map((value) => value.trim()).filter(Boolean); const answerList = answers.split('\n').map((value) => value.trim()).filter(Boolean); try { if (editing) await updateQuestion(editing.id, { version: editing.version, prompt, options: optionList, samplingWeight: weight, ...(answerList.length ? { acceptedAnswers: answerList, normalizationRule: rule } : {}) }); else await createQuestion({ prompt, options: optionList, acceptedAnswers: answerList, normalizationRule: rule, samplingWeight: weight }); setEditing(null); setPrompt(''); setAnswers(''); load(); } catch (error) { setNotice(message(error)); } }
  async function status(item: AdminQuestion) { if (!window.confirm('启停题目会影响新注册答题，确认？')) return; try { await setQuestionStatus(item.id, item.version, item.status === 'active' ? 'disabled' : 'active'); load(); } catch (error) { setNotice(message(error)); } }
  return <><p role="alert">{notice}</p><label>题目<input value={prompt} onChange={(event) => setPrompt(event.target.value)} /></label><label>选项（每行一个）<textarea value={options} onChange={(event) => setOptions(event.target.value)} /></label><label>可接受答案（每行一个）<textarea value={answers} onChange={(event) => setAnswers(event.target.value)} /></label><label>规范化<select value={rule} onChange={(event) => setRule(event.target.value as typeof rule)}><option value="trim">trim</option><option value="trim_lowercase">trim_lowercase</option><option value="trim_lowercase_collapse_whitespace">trim_lowercase_collapse_whitespace</option></select></label><label>抽中权重<input type="number" min={1} max={1000} value={weight} onChange={(event) => setWeight(Number(event.target.value))} /></label><button onClick={() => void save()}>{editing ? '保存新版本' : '创建草稿'}</button><p>编辑会生成新版本，历史答题不变。</p><ul>{items.map((item) => <li key={item.id}>{item.prompt} · v{item.version} · {item.status} <button onClick={() => { setEditing(item); setPrompt(item.prompt); setOptions(item.options.join('\n')); setAnswers(''); setRule(item.normalizationRule); setWeight(item.samplingWeight); }}>新版本</button><button onClick={() => void status(item)}>{item.status === 'active' ? '停用' : '启用'}</button></li>)}</ul>{cursor && <button onClick={() => load(cursor)}>下一页</button>}</>;
}

export function JobsAdmin() { const [items, setItems] = useState<AdminJob[]>([]); const [cursor, setCursor] = useState<string | null>(null); const [notice, setNotice] = useState(''); const load = (next?: string) => void listJobs({ cursor: next }).then((result) => { setItems((old) => next ? [...old, ...result.items] : result.items); setCursor(result.nextCursor); }).catch((error) => setNotice(message(error))); useEffect(() => load(), []); return <><p role="alert">{notice}</p><ul>{items.map((item) => <li key={item.id}>{item.kind} · {item.status} · {item.error || '正常'} {(item.status === 'failed' || item.kind === 'cleanup') && <button onClick={() => { if (window.confirm('确认安全重试？')) void retryJob(item.id, item.version).then(() => load()).catch((error) => setNotice(message(error))); }}>重试</button>}</li>)}</ul>{cursor && <button onClick={() => load(cursor)}>下一页</button>}</>; }
export function AuditAdmin() { const [items, setItems] = useState<AuditItem[]>([]); const [cursor, setCursor] = useState<string | null>(null); const [action, setAction] = useState(''); const [notice, setNotice] = useState(''); const load = (next?: string) => void listAudit({ action: action || undefined, cursor: next }).then((result) => { setItems((old) => next ? [...old, ...result.items] : result.items); setCursor(result.nextCursor); }).catch((error) => setNotice(message(error))); useEffect(() => load(), [action]); return <><p role="alert">{notice}</p><label>动作筛选<input value={action} onChange={(event) => setAction(event.target.value)} /></label><ul>{items.map((item) => <li key={item.id}>{item.action} · {item.targetType} · {item.createdAt}</li>)}</ul>{cursor && <button onClick={() => load(cursor)}>下一页</button>}</>; }
