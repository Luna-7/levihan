// @vitest-environment jsdom
import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
vi.mock('../features/works/api', () => ({ archiveWork: vi.fn(), completeAdminUpload: vi.fn().mockResolvedValue({ assetId: '550e8400-e29b-41d4-a716-446655440001', status: 'verified' }), createOperationKey: () => 'work-operation', createWork: vi.fn(), getAdminWork: vi.fn(), initAdminUpload: vi.fn(), listAdminWorks: vi.fn().mockResolvedValue({ items: [], nextCursor: null }), publishWork: vi.fn(), rebuildCatalogSnapshot: vi.fn(), restoreWork: vi.fn(), reviewWork: vi.fn(), updateWork: vi.fn(), uploadToCos: vi.fn() }));
vi.mock('./api', () => ({ adminRequest: vi.fn(), adminWrite: vi.fn(), createQuestion: vi.fn(), getHealth: vi.fn(), getSettings: vi.fn(), listAudit: vi.fn(), listJobs: vi.fn(), listModeration: vi.fn(), listQuestions: vi.fn(), listUsers: vi.fn(), operationKey: () => 'admin-operation', promoteUser: vi.fn(), retryJob: vi.fn(), setQuestionStatus: vi.fn(), setUserStatus: vi.fn(), updateQuestion: vi.fn(), updateSetting: vi.fn() }));
import { getHealth, getSettings, listQuestions, listUsers, updateQuestion, setUserStatus, updateSetting } from './api';
import { QuestionsAdmin, SettingsAdmin, UsersAdmin, WorksAdmin, resumeAdminUpload } from './modules';
import { completeAdminUpload, getAdminWork, initAdminUpload, listAdminWorks, uploadToCos } from '../features/works/api';
const user = { id: '550e8400-e29b-41d4-a716-446655440001', username: 'member', role: 'member' as const, status: 'active' as const, version: 1, createdAt: '2030-01-01T00:00:00Z', lastLoginAt: null, activeSessions: 1 };
afterEach(() => { cleanup(); vi.clearAllMocks(); vi.unstubAllGlobals(); });
describe('admin module interactions', () => {
  it('requires confirmation and rolls an optimistic user status change back on conflict', async () => {
    vi.mocked(listUsers).mockResolvedValue({ items: [user], nextCursor: null }); vi.mocked(setUserStatus).mockRejectedValue(new Error('数据已变化，请刷新'));
    vi.spyOn(window, 'confirm').mockReturnValue(true); render(<UsersAdmin />); await waitFor(() => screen.getByText(/member · member · active/));
    fireEvent.click(screen.getByRole('button', { name: '停用' })); expect(window.confirm).toHaveBeenCalledOnce();
    await waitFor(() => expect(screen.getByText(/数据已变化，请刷新/)).toBeTruthy()); expect(screen.getByText(/member · member · active/)).toBeTruthy();
  });
  it('loads the next compound-cursor page without replacing the first page', async () => {
    vi.mocked(listUsers).mockResolvedValueOnce({ items: [user], nextCursor: '2030-01-01T00:00:00Z|550e8400-e29b-41d4-a716-446655440001' }).mockResolvedValueOnce({ items: [{ ...user, id: '550e8400-e29b-41d4-a716-446655440002', username: 'second' }], nextCursor: null });
    render(<UsersAdmin />); await waitFor(() => screen.getByRole('button', { name: '下一页' })); fireEvent.click(screen.getByRole('button', { name: '下一页' }));
    await waitFor(() => expect(screen.getByText(/second · member · active/)).toBeTruthy()); expect(listUsers).toHaveBeenLastCalledWith(expect.objectContaining({ cursor: expect.stringContaining('|') })); expect(screen.getByText(/member · member · active/)).toBeTruthy();
  });
  it('makes immutable question version editing reachable', async () => {
    const question = { id: user.id, prompt: '旧题', options: ['是','否'], normalizationRule: 'trim_lowercase' as const, status: 'active' as const, version: 2, samplingWeight: 1, createdAt: user.createdAt, updatedAt: user.createdAt };
    vi.mocked(listQuestions).mockResolvedValue({ items: [question], nextCursor: null }); vi.mocked(updateQuestion).mockResolvedValue({ question: { ...question, id: '550e8400-e29b-41d4-a716-446655440002', prompt: '新题', status: 'draft', version: 3 } });
    render(<QuestionsAdmin />); await waitFor(() => screen.getByRole('button', { name: '新版本' })); fireEvent.click(screen.getByRole('button', { name: '新版本' })); fireEvent.change(screen.getByLabelText('题目'), { target: { value: '新题' } }); fireEvent.click(screen.getByRole('button', { name: '保存新版本' }));
    await waitFor(() => expect(updateQuestion).toHaveBeenCalledWith(question.id, expect.objectContaining({ version: 2, prompt: '新题' })));
  });
  it('resumes a processing work upload through the completion endpoint', async () => {
    await resumeAdminUpload({ uploadId: user.id, fileId: user.id, status: 'processing' }, new File(['x'], 'page.webp', { type: 'image/webp' }));
    expect(completeAdminUpload).toHaveBeenCalledWith(user.id, 'work-operation'); expect(uploadToCos).not.toHaveBeenCalled();
  });
  it('binds a page upload to the chapter selected in the work editor', async () => {
    const workId = '550e8400-e29b-41d4-a716-446655440010';
    const chapterOne = '550e8400-e29b-41d4-a716-446655440011';
    const chapterTwo = '550e8400-e29b-41d4-a716-446655440012';
    const work = {
      id: workId, slug: 'chaptered', type: 'comic' as const, title: '连载', summary: '', rating: 'general' as const,
      status: 'draft' as const, version: 1, authorName: '作者', publishedAt: null,
      chapters: [
        { id: chapterOne, title: '第一章', position: 1, version: 1, status: 'draft' as const },
        { id: chapterTwo, title: '第二章', position: 2, version: 1, status: 'draft' as const },
      ], assets: [],
    };
    vi.mocked(listAdminWorks).mockResolvedValue({ items: [work], nextCursor: null });
    vi.mocked(getAdminWork).mockResolvedValue({ work });
    vi.mocked(initAdminUpload).mockResolvedValue({ uploadId: user.id, fileId: user.id, status: 'processing' });
    vi.stubGlobal('crypto', { subtle: { digest: vi.fn().mockResolvedValue(new Uint8Array(32).buffer) } });
    const file = new File(['page'], 'page.webp', { type: 'image/webp' });
    Object.defineProperty(file, 'arrayBuffer', { value: vi.fn().mockResolvedValue(new Uint8Array([1]).buffer) });

    render(<WorksAdmin />);
    await waitFor(() => screen.getByRole('button', { name: '编辑章节/素材' }));
    fireEvent.click(screen.getByRole('button', { name: '编辑章节/素材' }));
    await waitFor(() => screen.getByLabelText('素材所属章节'));
    fireEvent.change(screen.getByLabelText('素材所属章节'), { target: { value: chapterTwo } });
    fireEvent.change(screen.getByLabelText('素材类型'), { target: { value: 'page' } });
    fireEvent.change(screen.getByLabelText('上传素材'), { target: { files: [file] } });

    await waitFor(() => expect(initAdminUpload).toHaveBeenCalledWith(expect.objectContaining({ workId, chapterId: chapterTwo, kind: 'page', pageNo: 1 }), 'work-operation'));
    expect(completeAdminUpload).toHaveBeenCalledWith(user.id, 'work-operation');
  });

  it('renders and can create every whitelisted setting when a fresh database returns no rows', async () => {
    vi.mocked(getSettings).mockResolvedValue({ items: [] });
    vi.mocked(getHealth).mockResolvedValue({ database: { ok: true, databaseVersion: 'v2', snapshot: {}, migration: {}, jobs: {} }, storage: { ok: true, region: 'ap-test', publicBucketConfigured: true, privateBucketConfigured: true, publicCorsConfigured: true, privateCorsConfigured: true } });
    vi.mocked(updateSetting).mockImplementation(async (setting, value) => ({ setting: { ...setting, value, version: 1, updatedAt: '2030-01-01T00:00:00Z' } }));
    render(<SettingsAdmin />);
    const editors = await screen.findAllByRole('textbox');
    expect(editors).toHaveLength(3);
    expect(screen.getByLabelText('announcement')).toBeTruthy();
    expect(screen.getByLabelText('adult_content_policy')).toBeTruthy();
    expect(screen.getByLabelText('feature_flags')).toBeTruthy();
    fireEvent.click(screen.getAllByRole('button', { name: '保存设置' })[0]);
    await waitFor(() => expect(updateSetting).toHaveBeenCalledWith(expect.objectContaining({ key: 'announcement', version: 1 }), expect.any(Object)));
  });

  it('synchronizes an editor to asynchronously loaded server values before saving', async () => {
    const serverSetting = { key: 'announcement' as const, value: { enabled: true, text: '线上维护公告' }, version: 7, updatedAt: '2030-01-01T00:00:00Z' };
    vi.mocked(getSettings).mockResolvedValue({ items: [serverSetting] });
    vi.mocked(getHealth).mockResolvedValue({ database: { ok: true, databaseVersion: 'v2', snapshot: {}, migration: {}, jobs: {} }, storage: { ok: true, region: 'ap-test', publicBucketConfigured: true, privateBucketConfigured: true, publicCorsConfigured: true, privateCorsConfigured: true } });
    vi.mocked(updateSetting).mockResolvedValue({ setting: { ...serverSetting, version: 8 } });
    render(<SettingsAdmin />);
    await waitFor(() => expect((screen.getByLabelText('announcement') as HTMLTextAreaElement).value).toContain('线上维护公告'));
    fireEvent.click(screen.getAllByRole('button', { name: '保存设置' })[0]);
    await waitFor(() => expect(updateSetting).toHaveBeenCalledWith(expect.objectContaining({ key: 'announcement', version: 7 }), { enabled: true, text: '线上维护公告' }));
  });
});
