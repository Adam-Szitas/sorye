import { mountWithTelemetry } from '@sorye/telemetry';
import { createRoot, type Root } from 'react-dom/client';
import App from './App';
import './styles.css';

export type RemoteUnmount = () => void;

export function mount(container: HTMLElement): RemoteUnmount {
  return mountWithTelemetry(container, 'studio', () => <App />, (target) => createRoot(target) as Root);
}
