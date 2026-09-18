// @vitest-environment jsdom
import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const api = vi.hoisted(() => ({ acceptAgeConsent: vi.fn(), getRestrictedAccess: vi.fn() }));
vi.mock('./api', () => api);
import { AgeGate } from './AgeGate';

afterEach(() => { cleanup(); vi.resetAllMocks(); localStorage.clear(); sessionStorage.clear(); });

describe('AgeGate', () => {
  it('requires explicit adult self-declaration and explains its legal limitation', async () => {
    api.acceptAgeConsent.mockResolvedValue({ policyVersion: '2026-09', acceptedAt: '2030-01-01T00:00:00.000Z' });
    api.getRestrictedAccess.mockResolvedValue({ work: { id: '550e8400-e29b-41d4-a716-446655440002', type: 'comic', title: 'X', rating: 'restricted' }, assets: [] });
    const onGranted = vi.fn();
    render(<AgeGate workId="550e8400-e29b-41d4-a716-446655440002" policyVersion="2026-09" warning="包含成人向内容" onGranted={onGranted} />);
    expect(screen.getByText(/不是实名年龄核验/)).toBeTruthy();
    const confirm = screen.getByRole('button', { name: '确认并继续' }) as HTMLButtonElement;
    expect(confirm.disabled).toBe(true);
    fireEvent.click(screen.getByLabelText('我已年满18岁并接受当前内容警告'));
    fireEvent.click(confirm);
    await waitFor(() => expect(onGranted).toHaveBeenCalled());
    expect(localStorage.length).toBe(0);
    expect(sessionStorage.length).toBe(0);
  });

  it.each([
    ['STATE_CONFLICT', '内容规则已更新，请刷新后重新确认'],
    ['AUTH_REQUIRED', '请先登录'],
    ['AGE_CONSENT_REQUIRED', '需要重新确认年龄声明'],
    ['NOT_FOUND', '内容已下架或不存在'],
  ])('shows a safe recovery message for %s', async (errorCode, message) => {
    api.acceptAgeConsent.mockRejectedValue(Object.assign(new Error('unsafe backend detail'), { errorCode }));
    render(<AgeGate workId="550e8400-e29b-41d4-a716-446655440002" policyVersion="2026-09" warning="警告" onGranted={vi.fn()} />);
    fireEvent.click(screen.getByLabelText('我已年满18岁并接受当前内容警告'));
    fireEvent.click(screen.getByRole('button', { name: '确认并继续' }));
    expect(await screen.findByText(message)).toBeTruthy();
    expect(screen.queryByText('unsafe backend detail')).toBeNull();
  });
});
