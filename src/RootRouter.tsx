import React, { useEffect, useState } from 'react';
import App from './App';
import { RestrictedWorkPage } from './features/access/RestrictedWorkPage';
import { SubmissionForm } from './features/submissions/SubmissionForm';

export function restrictedSlugFromHash(hash: string) {
  const match = /^#\/restricted\/([a-z0-9][a-z0-9-]{0,127})$/.exec(hash);
  return match ? match[1] : null;
}
export const submissionsFromHash = (hash: string) => hash === '#/submissions';

export function RootRouter() {
  const [hash, setHash] = useState(() => window.location.hash);
  useEffect(() => {
    const update = () => setHash(window.location.hash);
    window.addEventListener('hashchange', update);
    return () => window.removeEventListener('hashchange', update);
  }, []);
  const slug = restrictedSlugFromHash(hash);
  const close = () => { window.location.hash = ''; setHash(''); };
  if (slug) return <RestrictedWorkPage slug={slug} onClose={close} />;
  if (submissionsFromHash(hash)) return <SubmissionForm onClose={close} />;
  return <App />;
}
