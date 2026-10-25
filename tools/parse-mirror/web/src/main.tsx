import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import { App } from './App.tsx';
import { loadGame } from './game.ts';
import './styles.css';

// Links (Warcraft Logs, Wowhead) depend on the game version the server is set up for.
void loadGame().then(() =>
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <App />
    </StrictMode>,
  ),
);
