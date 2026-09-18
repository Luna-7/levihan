import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import App from './App.tsx';
import './index.css';
import {setupPwaAutoUpdate} from './utils/pwaUpdate';
import {setupIOSViewportGuard} from './utils/iosViewportGuard';

setupPwaAutoUpdate();
setupIOSViewportGuard();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
