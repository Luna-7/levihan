// @vitest-environment jsdom
import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('../features/auth/api', () => ({ getMe: vi.fn() }));
vi.mock('./api', async () => {
  const actual = await vi.importActual<typeof import('./api')>('./api');
  return { ...actual, getDashboard: vi.fn().mockResolvedValue({ counts: { works: 1, pendingSubmissions: 0, pendingComments: 0, pendingReports: 0, activeUsers: 1, failedUploads: 0, failedJobs: 0 }, todos: [], system: { databaseVersion: 'test', snapshotVersion: 1, storageHealth: 'healthy' }, recentAdminActions: [] }) };
});
import { getMe } from '../features/auth/api';
import { AdminApp, adminRouteFromHash } from './AdminApp';

afterEach(() => { cleanup(); window.location.hash = ''; vi.clearAllMocks(); });

describe('AdminApp', () => {
  it('shows login guidance for an expired session and denies a non-admin', async () => {
    vi.mocked(getMe).mockRejectedValueOnce(new Error('expired'));
    const { rerender } = render(<AdminApp />);
    await waitFor(() => expect(screen.getByText(/请先登录/)).toBeTruthy());
    vi.mocked(getMe).mockResolvedValueOnce({ user: { id: '550e8400-e29b-41d4-a716-446655440001', username: 'member' }, role: 'member', capabilities: ['comment'], ageConsent: null });
    rerender(<AdminApp key="member" />);
    await waitFor(() => expect(screen.getByText(/无权访问/)).toBeTruthy());
  });

  it('makes all required modules reachable through real hash navigation', async () => {
    vi.mocked(getMe).mockResolvedValue({ user: { id: '550e8400-e29b-41d4-a716-446655440001', username: 'admin' }, role: 'admin', capabilities: ['admin'], ageConsent: null });
    render(<AdminApp />);
    for (const label of ['仪表盘', '作品', '投稿', '评论与举报', '用户', '题库', '快照与清理', '审计']) {
      await waitFor(() => expect(screen.getByRole('link', { name: label })).toBeTruthy());
    }
    expect(adminRouteFromHash('#/not-real')).toBe('dashboard');
    fireEvent.click(screen.getByRole('link', { name: '题库' }));
    await waitFor(() => expect(window.location.hash).toBe('#/questions'));
    expect(screen.getByRole('heading', { name: '题库' })).toBeTruthy();
  });
});
