import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './index.css';
import './experience.css';
import './polish.css';
import App from './App.jsx';
import { startAutoUpdate } from './utils/autoUpdate.js';

startAutoUpdate();

// Capture the browser's install offer as early as possible — it can fire
// before React mounts, and a missed event isn't re-sent for that page load.
window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  window.__installPrompt = e;
  window.dispatchEvent(new Event('installpromptready'));
});

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>
);
