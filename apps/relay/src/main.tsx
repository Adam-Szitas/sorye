import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '@sorye/sdk/register';
import '@sorye/sdk/tokens.css';
import App from './App';
import './styles.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
