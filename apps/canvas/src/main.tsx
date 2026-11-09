import { StandaloneFrame } from '@sorye/platform/react';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import './styles.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <StandaloneFrame appName="Canvas">
      <App />
    </StandaloneFrame>
  </StrictMode>,
);
