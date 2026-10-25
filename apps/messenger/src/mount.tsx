import { mountWithTelemetry } from '@sorye/telemetry';
import { createRoot, type Root } from 'react-dom/client';
import App from './App';

export type RemoteUnmount = () => void;

export function mount(container: HTMLElement): RemoteUnmount {
  return mountWithTelemetry(container, 'messenger', () => <App />, (target) => createRoot(target) as Root);
}
