// @vitest-environment jsdom
import React from 'react';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('./App', () => ({ default: () => <div>public app</div> }));
vi.mock('./features/access/RestrictedWorkPage', () => ({ RestrictedWorkPage: ({ slug }: { slug: string }) => <div>restricted:{slug}</div> }));
vi.mock('./features/submissions/SubmissionForm', () => ({ SubmissionForm: () => <div>submission workflow</div> }));
vi.mock('./features/auth/LegacyMigrationPage', () => ({ LegacyMigrationPage: () => <div>legacy migration workflow</div> }));
import { RootRouter, legacyMigrationFromHash, restrictedSlugFromHash, submissionsFromHash } from './RootRouter';

afterEach(() => { cleanup(); window.location.hash = ''; });

describe('RootRouter', () => {
  it('makes a validated restricted reader hash route reachable from the real root', () => {
    expect(restrictedSlugFromHash('#/restricted/restricted-story')).toBe('restricted-story');
    expect(restrictedSlugFromHash('#/restricted/../secret')).toBeNull();
    window.location.hash = '#/restricted/restricted-story';
    render(<RootRouter />);
    expect(screen.getByText('restricted:restricted-story')).toBeTruthy();
  });

  it('makes the submission workflow reachable from the real root', () => {
    expect(submissionsFromHash('#/submissions')).toBe(true);
    window.location.hash = '#/submissions';
    render(<RootRouter />);
    expect(screen.getByText('submission workflow')).toBeTruthy();
  });
  it('makes the controlled legacy migration workflow reachable', () => {
    expect(legacyMigrationFromHash('#/migrate-account')).toBe(true); window.location.hash = '#/migrate-account'; render(<RootRouter />); expect(screen.getByText('legacy migration workflow')).toBeTruthy();
  });
});
