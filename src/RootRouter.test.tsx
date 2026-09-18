// @vitest-environment jsdom
import React from 'react';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('./App', () => ({ default: () => <div>public app</div> }));
vi.mock('./features/access/RestrictedWorkPage', () => ({ RestrictedWorkPage: ({ slug }: { slug: string }) => <div>restricted:{slug}</div> }));
import { RootRouter, restrictedSlugFromHash } from './RootRouter';

afterEach(() => { cleanup(); window.location.hash = ''; });

describe('RootRouter', () => {
  it('makes a validated restricted reader hash route reachable from the real root', () => {
    expect(restrictedSlugFromHash('#/restricted/restricted-story')).toBe('restricted-story');
    expect(restrictedSlugFromHash('#/restricted/../secret')).toBeNull();
    window.location.hash = '#/restricted/restricted-story';
    render(<RootRouter />);
    expect(screen.getByText('restricted:restricted-story')).toBeTruthy();
  });
});
