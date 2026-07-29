import '@sorye/sdk/register';
import '@sorye/sdk/tokens.css';
import { createRoot, type Root } from 'react-dom/client';
import App from './App';

export type RemoteUnmount = () => void;

export function mount(container: HTMLElement): RemoteUnmount {
  const root: Root = createRoot(container);
  root.render(<App />);
  return () => {
    root.unmount();
  };
}
