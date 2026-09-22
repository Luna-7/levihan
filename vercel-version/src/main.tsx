import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import App from './App.tsx';
import ComicsPage from './components/ComicsPage.tsx';
import { useAuthStore } from './stores/authStore';
import './index.css';

void useAuthStore.getState().refreshProfile();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {window.location.pathname.replace(/\/$/, '') === '/comics' ? <ComicsPage /> : <App />}
  </StrictMode>,
);
