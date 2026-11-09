import { StandaloneFrame } from '@sorye/platform/react';
import { createRoot } from 'react-dom/client';
import App from './App';
import './styles.css';

createRoot(document.getElementById('root')!).render(
  <StandaloneFrame appName="Messenger">
    <App />
  </StandaloneFrame>,
);
