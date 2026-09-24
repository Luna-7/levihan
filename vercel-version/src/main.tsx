import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import App from './App.tsx';
import { AppErrorBoundary } from './components/AppErrorBoundary';
import { useAuthStore } from './stores/authStore';
import { setupIOSViewportGuard } from './utils/iosViewportGuard';
import './index.css';

setupIOSViewportGuard();

const syncPageVisibilityClass = () => {
  document.documentElement.classList.toggle('app-page-hidden', document.visibilityState !== 'visible');
};
syncPageVisibilityClass();
document.addEventListener('visibilitychange', syncPageVisibilityClass, { passive: true });

if (window.location.pathname.replace(/\/$/, '') === '/comics') {
  window.location.replace('/?tab=resources');
} else {
  void useAuthStore.getState().refreshProfile();
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <AppErrorBoundary>
        <App />
      </AppErrorBoundary>
    </StrictMode>,
  );
}
