import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { SoccerApp } from './ui/soccer/Shell';
import { startPwa } from './ui/pwa';
import './ui/styles.css';
import './ui/soccer/assembly.css';

startPwa();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <SoccerApp />
  </StrictMode>,
);
