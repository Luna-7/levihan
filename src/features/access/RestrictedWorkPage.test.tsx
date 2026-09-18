// @vitest-environment jsdom
import React from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const access = vi.hoisted(() => ({ acceptAgeConsent: vi.fn(), getAgePolicy: vi.fn(), getRestrictedAccess: vi.fn() }));
const works = vi.hoisted(() => ({ getPublicWork: vi.fn() }));
vi.mock('./api', () => access);
vi.mock('../works/api', () => works);
import { RestrictedWorkPage } from './RestrictedWorkPage';

const id = '550e8400-e29b-41d4-a716-446655440002';
const metadata = { work: { accessId: id, slug: 'restricted', type: 'comic', title: 'R', summary: 'warning', rating: 'restricted', authorName: 'A', publishedAt: '2030-01-01T00:00:00.000Z', chapters: [], assets: [{ kind: 'preview', publicPath: 'media/works/w/safe.webp' }] } };
const signed = (expiresAt: string) => ({ work: { id, type: 'comic', title: 'R', rating: 'restricted' }, assets: [{ id, kind: 'page', mimeType: 'image/webp', pageNo: 1, url: 'https://private-123.cos.ap-test.myqcloud.com/protected/works/w/1.webp?q-signature=x', expiresAt }] });

afterEach(() => { cleanup(); vi.useRealTimers(); vi.resetAllMocks(); localStorage.clear(); sessionStorage.clear(); });

describe('RestrictedWorkPage', () => {
  it('loads the reachable age gate and keeps signed URLs only in component memory until close', async () => {
    works.getPublicWork.mockResolvedValue(metadata);
    access.getAgePolicy.mockResolvedValue({ policyVersion: '2026-09', warning: '成人内容警告', assurance: 'self_declaration_only' });
    access.acceptAgeConsent.mockResolvedValue({ policyVersion: '2026-09', acceptedAt: '2030-01-01T00:00:00.000Z' });
    access.getRestrictedAccess.mockResolvedValue(signed(new Date(Date.now() + 300_000).toISOString()));
    const local = vi.spyOn(Storage.prototype, 'setItem');
    render(<RestrictedWorkPage slug="restricted" onClose={vi.fn()} />);
    expect(await screen.findByRole('region', { name: '成人内容确认' })).toBeTruthy();
    fireEvent.click(screen.getByLabelText('我已年满18岁并接受当前内容警告'));
    fireEvent.click(screen.getByRole('button', { name: '确认并继续' }));
    const image = await screen.findByRole('img', { name: 'R 第 1 页' });
    expect(image.getAttribute('src')).toContain('/protected/works/');
    fireEvent.click(screen.getByRole('button', { name: '关闭阅读器' }));
    expect(screen.queryByRole('img', { name: 'R 第 1 页' })).toBeNull();
    expect(local).not.toHaveBeenCalled();
    expect(localStorage.length).toBe(0);
    expect(sessionStorage.length).toBe(0);
    local.mockRestore();
  });

  it('clears signed URLs on expiry and on a denied refresh', async () => {
    vi.useFakeTimers();
    works.getPublicWork.mockResolvedValue(metadata);
    access.getAgePolicy.mockResolvedValue({ policyVersion: '2026-09', warning: '成人内容警告', assurance: 'self_declaration_only' });
    access.acceptAgeConsent.mockResolvedValue({});
    access.getRestrictedAccess.mockResolvedValueOnce(signed(new Date(Date.now() + 1_000).toISOString()));
    render(<RestrictedWorkPage slug="restricted" onClose={vi.fn()} />);
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });
    fireEvent.click(screen.getByLabelText('我已年满18岁并接受当前内容警告'));
    fireEvent.click(screen.getByRole('button', { name: '确认并继续' }));
    await act(async () => { await Promise.resolve(); });
    expect(screen.getByRole('img', { name: 'R 第 1 页' })).toBeTruthy();
    await act(async () => { vi.advanceTimersByTime(1_001); });
    expect(screen.queryByRole('img', { name: 'R 第 1 页' })).toBeNull();

    access.getRestrictedAccess.mockResolvedValueOnce(signed(new Date(Date.now() + 300_000).toISOString()));
    fireEvent.click(screen.getByLabelText('我已年满18岁并接受当前内容警告'));
    fireEvent.click(screen.getByRole('button', { name: '确认并继续' }));
    await act(async () => { await Promise.resolve(); });
    access.getRestrictedAccess.mockRejectedValueOnce(Object.assign(new Error('denied'), { errorCode: 'ACCESS_DENIED' }));
    fireEvent.click(screen.getByRole('button', { name: '刷新访问' }));
    await act(async () => { await Promise.resolve(); });
    expect(screen.queryByRole('img', { name: 'R 第 1 页' })).toBeNull();
  });
});
