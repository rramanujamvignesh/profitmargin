import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import App from './App.tsx';
import './index.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

// Register PWA Service Worker for offline computing support
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    const swPath = './sw.js';
    navigator.serviceWorker.register(swPath)
      .then((reg) => {
        console.log('[PWA] Service Worker registered successfully: ', reg.scope);
      })
      .catch((error) => {
        console.warn('[PWA] Service Worker registration bypassed: ', error);
      });
  });
}
