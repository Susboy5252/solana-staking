import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { ClientProvider } from '@solana/react';
import { client } from './client';
import { App } from './App';
import './styles.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ClientProvider client={client}>
      <App />
    </ClientProvider>
  </StrictMode>,
);
