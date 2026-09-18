// @vitest-environment jsdom

import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const api = vi.hoisted(() => ({
  createRegistrationChallenge: vi.fn(),
  answerRegistrationChallenge: vi.fn(),
  register: vi.fn(),
  login: vi.fn(),
  logout: vi.fn(),
  recover: vi.fn(),
  confirmRecoveryCode: vi.fn(),
  regenerateRecoveryCode: vi.fn(),
  getMe: vi.fn(),
}));

vi.mock('./api', () => api);

import { UserEntry } from '../../components/UserEntry';

afterEach(() => { cleanup(); vi.resetAllMocks(); sessionStorage.clear(); });

function prepareChallenge() {
  api.getMe.mockRejectedValue(new Error('not authenticated'));
  api.createRegistrationChallenge.mockResolvedValue({
    challengeId: '550e8400-e29b-41d4-a716-446655440000', prompt: '利韩土豆仓的入口题？', options: ['春天', '夏天'], expiresAt: '2030-01-01T00:05:00.000Z',
  });
  api.answerRegistrationChallenge.mockResolvedValue({ registrationTicket: 'T'.repeat(43), expiresAt: '2030-01-01T00:10:00.000Z' });
}

describe('quiz-only user entry', () => {
  it('contains no phone, SMS, invitation, or key registration UI', async () => {
    prepareChallenge();
    render(<UserEntry onShowToast={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: '打开用户入口' }));
    const dialog = await screen.findByRole('dialog');
    expect(dialog.textContent).not.toMatch(/手机|短信|验证码|邀请|钥匙/);
    expect(screen.getByRole('button', { name: /注册/ })).toBeTruthy();
  });

  it('enforces the quiz before showing username and password registration', async () => {
    prepareChallenge();
    render(<UserEntry onShowToast={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: '打开用户入口' }));
    fireEvent.click(screen.getByRole('button', { name: '注册账号' }));
    expect(await screen.findByText('利韩土豆仓的入口题？')).toBeTruthy();
    expect(screen.queryByLabelText('用户名')).toBeNull();
    fireEvent.click(screen.getByLabelText('夏天'));
    fireEvent.click(screen.getByRole('button', { name: '提交答案' }));
    expect(await screen.findByLabelText('用户名')).toBeTruthy();
    expect(api.answerRegistrationChallenge).toHaveBeenCalledWith('550e8400-e29b-41d4-a716-446655440000', '夏天');
  });

  it('requires explicit recovery-code saved confirmation before entering the account UI', async () => {
    prepareChallenge();
    api.confirmRecoveryCode.mockResolvedValue({
      confirmed: true,
      user: { id: '550e8400-e29b-41d4-a716-446655440010', username: 'reader_01', role: 'member', capabilities: ['comment', 'favorite', 'submit'], ageConsent: null },
    });
    api.getMe.mockReset().mockRejectedValue(new Error('not authenticated'));
    api.register.mockResolvedValue({ userId: '550e8400-e29b-41d4-a716-446655440010', username: 'reader_01', recoveryCode: 'ABCD-EFGH-JKLM-NPQR' });
    render(<UserEntry onShowToast={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: '打开用户入口' }));
    fireEvent.click(screen.getByRole('button', { name: '注册账号' }));
    await screen.findByText('利韩土豆仓的入口题？');
    fireEvent.click(screen.getByLabelText('夏天'));
    fireEvent.click(screen.getByRole('button', { name: '提交答案' }));
    fireEvent.change(await screen.findByLabelText('用户名'), { target: { value: 'Reader_01' } });
    fireEvent.change(screen.getByLabelText('密码'), { target: { value: 'a-secure-password' } });
    fireEvent.click(screen.getByRole('button', { name: '创建账号' }));
    expect(await screen.findByText('ABCD-EFGH-JKLM-NPQR')).toBeTruthy();
    const enter = screen.getByRole('button', { name: '我已保存，进入账号' });
    expect((enter as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByLabelText('我已安全保存恢复码'));
    expect((enter as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(enter);
    await waitFor(() => expect(api.confirmRecoveryCode).toHaveBeenCalledWith('ABCD-EFGH-JKLM-NPQR'));
    await waitFor(() => expect(screen.getByRole('button', { name: '打开用户入口' }).textContent).toContain('reader_01'));
    expect(sessionStorage.getItem('levihan.pendingRecoveryCode')).toBeNull();
  });

  it('cannot close the recovery-code gate before the server confirms it', async () => {
    prepareChallenge();
    api.register.mockResolvedValue({ userId: '550e8400-e29b-41d4-a716-446655440010', username: 'reader_01', recoveryCode: 'ABCD-EFGH-JKLM-NPQR' });
    render(<UserEntry onShowToast={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: '打开用户入口' }));
    fireEvent.click(screen.getByRole('button', { name: '注册账号' }));
    await screen.findByText('利韩土豆仓的入口题？');
    fireEvent.click(screen.getByLabelText('夏天'));
    fireEvent.click(screen.getByRole('button', { name: '提交答案' }));
    fireEvent.change(await screen.findByLabelText('用户名'), { target: { value: 'reader_01' } });
    fireEvent.change(screen.getByLabelText('密码'), { target: { value: 'a-secure-password' } });
    fireEvent.click(screen.getByRole('button', { name: '创建账号' }));
    const dialog = await screen.findByRole('dialog');
    expect(screen.queryByRole('button', { name: '×' })).toBeNull();
    fireEvent.mouseDown(dialog.parentElement as HTMLElement);
    expect(screen.getByRole('dialog')).toBeTruthy();
  });

  it('never restores a recovery code from storage and can reauthenticate to regenerate it', async () => {
    sessionStorage.setItem('levihan.pendingRecoveryCode', 'ABCD-EFGH-JKLM-NPQR');
    api.getMe.mockRejectedValue(new Error('unconfirmed session'));
    api.regenerateRecoveryCode.mockResolvedValue({ recoveryCode: 'WXYZ-2345-6789-ABCD' });
    render(<UserEntry onShowToast={vi.fn()} />);
    await waitFor(() => expect(sessionStorage.getItem('levihan.pendingRecoveryCode')).toBeNull());
    fireEvent.click(screen.getByRole('button', { name: '打开用户入口' }));
    expect(screen.queryByText('ABCD-EFGH-JKLM-NPQR')).toBeNull();
    fireEvent.change(screen.getByLabelText('密码'), { target: { value: 'a-secure-password' } });
    fireEvent.click(screen.getByRole('button', { name: '重新生成未确认恢复码' }));
    expect(await screen.findByText('WXYZ-2345-6789-ABCD')).toBeTruthy();
    expect(api.regenerateRecoveryCode).toHaveBeenCalledWith('a-secure-password');
    expect(sessionStorage.getItem('levihan.pendingRecoveryCode')).toBeNull();
  });

  it('still mounts when compatibility cleanup is blocked by browser storage policy', () => {
    api.getMe.mockRejectedValue(new Error('not authenticated'));
    vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(() => { throw new DOMException('blocked', 'SecurityError'); });
    expect(() => render(<UserEntry onShowToast={vi.fn()} />)).not.toThrow();
    expect(screen.getByRole('button', { name: '打开用户入口' })).toBeTruthy();
  });
});
