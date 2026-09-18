export const isRestrictedRequest = ({ url }: { url: URL }) =>
  /^\/api\/v1\/works\/[^/]+\/access$/.test(url.pathname)
  || url.pathname.includes('/protected/works/')
  || ['q-sign-algorithm', 'q-key-time', 'q-signature'].some((name) => url.searchParams.has(name));
