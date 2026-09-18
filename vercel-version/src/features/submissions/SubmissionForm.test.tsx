// @vitest-environment jsdom
import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('./api', () => ({
  createSubmissionOperationKey: () => 'operation-key-1',
  listMySubmissions: vi.fn().mockResolvedValue({ items: [], nextCursor: null }),
  getMySubmission: vi.fn(),
  createSubmission: vi.fn().mockResolvedValue({ id: '550e8400-e29b-41d4-a716-446655440001', type: 'novel', title: '春', summary: '', status: 'draft', version: 1, assetCount: 0, payload: { description: '', rating: 'general' }, assets: [], acceptedWorkId: null }),
  updateSubmission: vi.fn(), submitSubmission: vi.fn(), withdrawSubmission: vi.fn(), initSubmissionUpload: vi.fn(), uploadSubmissionFile: vi.fn(), completeSubmissionUpload: vi.fn(), sha256File: vi.fn().mockResolvedValue('a'.repeat(64)),
}));
import { completeSubmissionUpload, createSubmission, getMySubmission, initSubmissionUpload, listMySubmissions, uploadSubmissionFile } from './api';
import { SubmissionForm } from './SubmissionForm';

afterEach(() => cleanup());

describe('SubmissionForm', () => {
  it('is reachable as an authenticated workflow and saves a draft with explicit retry feedback', async () => {
    render(<SubmissionForm onClose={() => {}} />);
    fireEvent.change(screen.getByLabelText('作品标题'), { target: { value: '春' } });
    fireEvent.click(screen.getByRole('button', { name: '保存草稿' }));
    await waitFor(() => expect(createSubmission).toHaveBeenCalled());
    expect(screen.getByText(/草稿已保存/)).toBeTruthy();
    expect(screen.getByText(/失败时可使用同一操作编号重试/)).toBeTruthy();
  });

  it('never writes signed upload URLs or submission data to browser storage', async () => {
    const local = vi.spyOn(Storage.prototype, 'setItem');
    render(<SubmissionForm onClose={() => {}} />);
    await waitFor(() => expect(screen.getByText('我的投稿')).toBeTruthy());
    expect(local).not.toHaveBeenCalled();
  });

  it('restores an existing draft after refresh through the authenticated detail endpoint', async () => {
    const draft = { id: '550e8400-e29b-41d4-a716-446655440001', type: 'novel' as const, title: '旧稿', summary: '摘要', status: 'draft' as const, version: 2, assetCount: 1, payload: { description: '已保存说明', rating: 'mature' as const }, assets: [], acceptedWorkId: null };
    vi.mocked(listMySubmissions).mockResolvedValueOnce({ items: [draft], nextCursor: null });
    vi.mocked(getMySubmission).mockResolvedValueOnce(draft);
    render(<SubmissionForm onClose={() => {}} />);
    await waitFor(() => expect(screen.getByRole('button', { name: '继续编辑' })).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: '继续编辑' }));
    await waitFor(() => expect(getMySubmission).toHaveBeenCalledWith(draft.id));
    expect((screen.getByLabelText('作品标题') as HTMLInputElement).value).toBe('旧稿');
    expect(screen.getByText(/草稿已恢复/)).toBeTruthy();
  });

  it('resumes completion when an idempotent upload replay is already promoting', async () => {
    const draft = { id: '550e8400-e29b-41d4-a716-446655440001', type: 'comic' as const, title: '旧稿', summary: '', status: 'draft' as const, version: 2, assetCount: 0, payload: { description: '', rating: 'general' as const }, assets: [], acceptedWorkId: null };
    vi.mocked(listMySubmissions).mockResolvedValueOnce({ items: [draft], nextCursor: null }); vi.mocked(getMySubmission).mockResolvedValueOnce(draft);
    vi.mocked(initSubmissionUpload).mockResolvedValueOnce({ uploadId: draft.id, fileId: draft.id, status: 'processing' }); vi.mocked(completeSubmissionUpload).mockResolvedValueOnce({ fileId: draft.id, status: 'verified' });
    render(<SubmissionForm onClose={() => {}} />); await waitFor(() => screen.getByRole('button', { name: '继续编辑' })); fireEvent.click(screen.getByRole('button', { name: '继续编辑' })); await waitFor(() => expect(getMySubmission).toHaveBeenCalledWith(draft.id));
    const file = new File(['image'], 'page.webp', { type: 'image/webp' }); fireEvent.change(screen.getByLabelText('私有素材'), { target: { files: [file] } });
    await waitFor(() => expect(completeSubmissionUpload).toHaveBeenCalledWith(draft.id, draft.id, 'operation-key-1'));
    expect(uploadSubmissionFile).not.toHaveBeenCalled(); expect(screen.getByText(/素材已私有上传并验证/)).toBeTruthy();
  });
});
