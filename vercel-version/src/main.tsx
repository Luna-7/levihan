import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import {RootRouter} from './RootRouter.tsx';
import './index.css';
import {setupPwaAutoUpdate} from './utils/pwaUpdate';
import {setupIOSViewportGuard} from './utils/iosViewportGuard';

setupPwaAutoUpdate();
setupIOSViewportGuard();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <RootRouter />
  </StrictMode>,
);
