import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { SaveHangeGame } from './SaveHangeGame';
import './index.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <SaveHangeGame />
  </StrictMode>,
);
