import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { SoccerApp } from './ui/soccer/Shell';
import { startPwa } from './ui/pwa';
import './ui/theme.css';

startPwa();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <SoccerApp />
  </StrictMode>,
);
