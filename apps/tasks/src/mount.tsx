import '@sorye/sdk/register';
import '@sorye/sdk/tokens.css';
import { connectKernel, type KernelMountContext } from '@sorye/platform';
import { KernelProvider } from '@sorye/platform/react';
import { mountWithTelemetry } from '@sorye/telemetry';
import { createRoot, type Root } from 'react-dom/client';
import App from './App';
import { readHubOrigin } from './hub-origin';

export type RemoteUnmount = () => void;

export function mount(container: HTMLElement, context?: KernelMountContext): RemoteUnmount {
  let release = () => {};
  const unmount = mountWithTelemetry(
    container,
    'tasks',
    () => {
      const connected = connectKernel({
        appId: 'tasks',
        framework: 'react',
        context,
        hubOrigin: readHubOrigin(),
      });
      release = connected.release;
      return (
        <KernelProvider kernel={connected.kernel}>
          <App />
        </KernelProvider>
      );
    },
    (target) => createRoot(target) as Root,
  );
  return () => {
    unmount();
    release();
  };
}
