// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MangaCommentSection } from './MangaCommentSection';
import * as api from '../features/interactions/api';

vi.mock('../features/interactions/api', async () => ({ listComments: vi.fn(), createComment: vi.fn() }));
vi.mock('../utils/audio', () => ({ soundManager: { playScrollOpen: vi.fn() } }));
const id = '550e8400-e29b-41d4-a716-446655440001';

describe('MangaCommentSection', () => {
  beforeEach(() => { vi.clearAllMocks(); localStorage.clear(); sessionStorage.clear(); });
  afterEach(() => cleanup());
  it('loads published comments from the unified API and never uses browser storage', async () => {
    vi.mocked(api.listComments).mockResolvedValue({ items: [{ id, authorName: '调查兵', body: '好看', createdAt: '2030-01-01T00:00:00.000Z' }], count: 1, nextCursor: null });
    render(<MangaCommentSection bookId="work-slug" bookTitle="作品" onShowToast={vi.fn()} />);
    expect(await screen.findByText('好看')).toBeTruthy();
    expect(screen.getByText('评论 (1)')).toBeTruthy();
    expect(api.listComments).toHaveBeenCalledWith('work-slug');
    expect(localStorage.length).toBe(0); expect(sessionStorage.length).toBe(0);
  });

  it('shows a safe pending message without publishing a pending comment locally', async () => {
    vi.stubGlobal('crypto', { randomUUID: () => id });
    vi.mocked(api.listComments).mockResolvedValue({ items: [], count: 0, nextCursor: null });
    vi.mocked(api.createComment).mockResolvedValue({ id, status: 'pending', createdAt: '2030-01-01T00:00:00.000Z' });
    const toast = vi.fn();
    render(<MangaCommentSection bookId="work-slug" bookTitle="作品" onShowToast={toast} />);
    await waitFor(() => expect(api.listComments).toHaveBeenCalled());
    fireEvent.change(screen.getByPlaceholderText('写下你的评论...'), { target: { value: '待审核评论' } });
    fireEvent.click(screen.getByText('发表评论'));
    await waitFor(() => expect(toast).toHaveBeenCalledWith('评论已提交，审核通过后显示'));
    expect(screen.queryByText('待审核评论')).toBeNull();
  });
});
