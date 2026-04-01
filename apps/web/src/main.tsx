import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import { App } from './app';

const container = document.getElementById('root');

if (!container) {
  throw new Error('Expected #root container to exist.');
}

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>
);
