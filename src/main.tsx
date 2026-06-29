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
  const registerSW = () => {
    const swPath = '/sw.js';
    navigator.serviceWorker.register(swPath)
      .then((reg) => {
        console.log('[PWA] Service Worker registered successfully: ', reg.scope);

        // Check for updates and automatically reload active page to prevent stale cache lock
        reg.addEventListener('updatefound', () => {
          const newWorker = reg.installing;
          if (newWorker) {
            newWorker.addEventListener('statechange', () => {
              if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
                console.log('[PWA] New update available! Automatically reloading to apply latest formulas...');
                window.location.reload();
              }
            });
          }
        });
      })
      .catch((error) => {
        console.warn('[PWA] Service Worker registration bypassed: ', error);
      });
  };

  if (document.readyState === 'complete') {
    registerSW();
  } else {
    window.addEventListener('load', registerSW);
  }
}

// Global emergency recovery function to force-clear service workers, cache storage, and localStorage
(window as any).forceUpdateApp = async () => {
  console.log('[PWA] Force-updating application and purging persistent caches...');
  try {
    // 1. Unregister all service workers
    if ('serviceWorker' in navigator) {
      const registrations = await navigator.serviceWorker.getRegistrations();
      for (const reg of registrations) {
        await reg.unregister();
      }
    }
    
    // 2. Clear all cache storage
    if ('caches' in window) {
      const keys = await caches.keys();
      for (const key of keys) {
        await caches.delete(key);
      }
    }
    
    // 3. Clear localStorage & sessionStorage
    localStorage.clear();
    sessionStorage.clear();
    
    console.log('[PWA] Caches cleared successfully. Performing hard reload.');
  } catch (err) {
    console.error('[PWA] Emergency cache purge encountered errors:', err);
  } finally {
    // 4. Force reload page with cache-busting timestamp
    window.location.href = window.location.pathname + '?update=' + Date.now();
  }
};
