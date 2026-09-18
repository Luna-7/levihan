// @vitest-environment jsdom
import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useReadingProgress } from './useReadingProgress';
import * as api from '../features/interactions/api';

vi.mock('../features/interactions/api', async () => ({ getReadingProgress: vi.fn(), syncReadingProgress: vi.fn() }));
const mutationId = '550e8400-e29b-41d4-a716-446655440002';

describe('useReadingProgress', () => {
  beforeEach(() => { vi.clearAllMocks(); vi.stubGlobal('crypto', { randomUUID: () => mutationId }); });
  it('loads server progress and syncs a versioned mutation without browser persistence', async () => {
    vi.mocked(api.getReadingProgress).mockResolvedValue(null);
    vi.mocked(api.syncReadingProgress).mockResolvedValue({ accepted: true, position: { kind: 'comic', page: 3 }, percent: 30, logicVersion: 1, clientVersion: 1, mutationId, version: 1, updatedAt: '2030-01-01T00:00:00.000Z' });
    const { result } = renderHook(() => useReadingProgress('work-slug'));
    await waitFor(() => expect(result.current.loading).toBe(false));
    await act(() => result.current.save({ kind: 'comic', page: 3 }, 30));
    expect(api.syncReadingProgress).toHaveBeenCalledWith('work-slug', expect.objectContaining({ mutationId, clientVersion: 1, logicVersion: 1, baseVersion: 0 }));
    expect(result.current.progress?.position).toEqual({ kind: 'comic', page: 3 });
    expect(localStorage.length).toBe(0); expect(sessionStorage.length).toBe(0);
  });

  it('uses authoritative server state when an older device mutation is rejected', async () => {
    vi.mocked(api.getReadingProgress).mockResolvedValue(null);
    vi.mocked(api.syncReadingProgress).mockResolvedValue({ accepted: false, position: { kind: 'novel', chapter: 4, offset: 9 }, percent: 60, logicVersion: 2, clientVersion: 8, mutationId, version: 9, updatedAt: '2030-01-01T00:00:00.000Z' });
    const { result } = renderHook(() => useReadingProgress('work-slug'));
    await waitFor(() => expect(result.current.loading).toBe(false));
    await act(() => result.current.save({ kind: 'novel', chapter: 1, offset: 1 }, 10));
    expect(result.current.progress?.logicVersion).toBe(2);
    expect(result.current.progress?.position).toEqual({ kind: 'novel', chapter: 4, offset: 9 });
  });
});
