import '@sorye/sdk/register';
import '@sorye/sdk/tokens.css';
import { connectKernel } from '@sorye/platform';
import { KernelProvider } from '@sorye/platform/react';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import { readHubOrigin } from './hub-origin';
import './styles.css';

const connected = connectKernel({
  appId: 'tasks',
  framework: 'react',
  hubOrigin: readHubOrigin(),
});

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <KernelProvider kernel={connected.kernel}>
      <App />
    </KernelProvider>
  </StrictMode>,
);
