// @vitest-environment jsdom
import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
const api = vi.hoisted(() => ({ AuthApiError: class AuthApiError extends Error { constructor(public errorCode: string, message: string) { super(message); } }, beginLegacyMigration: vi.fn(), prepareLegacyMigration: vi.fn(), installLegacyMigration: vi.fn(), confirmRecoveryCode: vi.fn(), recover: vi.fn() }));
vi.mock('./api', () => api);
import { LegacyMigrationPage } from './LegacyMigrationPage';
afterEach(() => { cleanup(); vi.resetAllMocks(); localStorage.clear(); sessionStorage.clear(); });
describe('legacy account migration page', () => {
  it('runs claim, prepare, explicit save, install and confirm without persisting secrets', async () => {
    api.beginLegacyMigration.mockResolvedValue({ ready: true, expiresAt: '2030-01-01T00:10:00Z' }); api.prepareLegacyMigration.mockResolvedValue({ recoveryCode: 'ABCD-EFGH-JKLM-NPQR', prepareNonce: 'n'.repeat(43), expiresAt: '2030-01-01T00:10:00Z' }); api.installLegacyMigration.mockResolvedValue({ installed: true, userId: 'u1' }); api.confirmRecoveryCode.mockResolvedValue({ user: { username: 'legacy_user' } });
    render(<LegacyMigrationPage onClose={vi.fn()} />); fireEvent.change(screen.getByLabelText('一次性迁移凭据'), { target: { value: 'm'.repeat(43) } }); fireEvent.click(screen.getByRole('button', { name: '验证并生成恢复码' }));
    expect(await screen.findByText('ABCD-EFGH-JKLM-NPQR')).toBeTruthy(); expect(localStorage.length).toBe(0); expect(sessionStorage.length).toBe(0);
    fireEvent.click(screen.getByLabelText('我已安全保存迁移恢复码')); fireEvent.change(screen.getByLabelText('迁移账号新密码'), { target: { value: 'a-secure-password' } }); fireEvent.click(screen.getByRole('button', { name: '安装密码并完成迁移' }));
    await waitFor(() => expect(api.installLegacyMigration).toHaveBeenCalledWith(expect.objectContaining({ recoveryCode: 'ABCD-EFGH-JKLM-NPQR', prepareNonce: 'n'.repeat(43) }))); expect(localStorage.length).toBe(0); expect(sessionStorage.length).toBe(0);
  });
  it('keeps the saved recovery code in memory and offers recovery after an uncertain install response', async () => {
    api.beginLegacyMigration.mockResolvedValue({ ready: true }); api.prepareLegacyMigration.mockResolvedValue({ recoveryCode: 'ABCD-EFGH-JKLM-NPQR', prepareNonce: 'n'.repeat(43), expiresAt: 'x' }); api.installLegacyMigration.mockRejectedValue(new Error('network lost after commit'));
    render(<LegacyMigrationPage onClose={vi.fn()} />); fireEvent.change(screen.getByLabelText('一次性迁移凭据'), { target: { value: 'm'.repeat(43) } }); fireEvent.click(screen.getByRole('button', { name: '验证并生成恢复码' })); await screen.findByText('ABCD-EFGH-JKLM-NPQR'); fireEvent.click(screen.getByLabelText('我已安全保存迁移恢复码')); fireEvent.change(screen.getByLabelText('迁移账号新密码'), { target: { value: 'a-secure-password' } }); fireEvent.click(screen.getByRole('button', { name: '安装密码并完成迁移' }));
    expect(await screen.findByRole('button', { name: '使用恢复码安全恢复' })).toBeTruthy(); expect(screen.getByText('ABCD-EFGH-JKLM-NPQR')).toBeTruthy();
  });
  it('keeps a definite validation rejection on the install step instead of offering impossible recovery', async () => {
    api.beginLegacyMigration.mockResolvedValue({ ready: true }); api.prepareLegacyMigration.mockResolvedValue({ recoveryCode: 'ABCD-EFGH-JKLM-NPQR', prepareNonce: 'n'.repeat(43), expiresAt: 'x' }); api.installLegacyMigration.mockRejectedValue(new api.AuthApiError('VALIDATION_FAILED', '密码不符合要求'));
    render(<LegacyMigrationPage onClose={vi.fn()} />); fireEvent.change(screen.getByLabelText('一次性迁移凭据'), { target: { value: 'm'.repeat(43) } }); fireEvent.click(screen.getByRole('button', { name: '验证并生成恢复码' })); await screen.findByText('ABCD-EFGH-JKLM-NPQR'); fireEvent.click(screen.getByLabelText('我已安全保存迁移恢复码')); fireEvent.change(screen.getByLabelText('迁移账号新密码'), { target: { value: 'a-secure-password' } }); fireEvent.click(screen.getByRole('button', { name: '安装密码并完成迁移' }));
    expect(await screen.findByText('密码不符合要求')).toBeTruthy(); expect(screen.queryByRole('button', { name: '使用恢复码安全恢复' })).toBeNull(); expect(screen.getByRole('button', { name: '安装密码并完成迁移' })).toBeTruthy();
  });
});
