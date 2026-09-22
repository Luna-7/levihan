import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import App from './App.tsx';
import { useAuthStore } from './stores/authStore';
import './index.css';

if (window.location.pathname.replace(/\/$/, '') === '/comics') {
  window.location.replace('/?tab=resources');
} else {
  void useAuthStore.getState().refreshProfile();
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
}
