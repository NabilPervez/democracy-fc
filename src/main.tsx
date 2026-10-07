import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { Root } from './ui/Root';
import { startPwa } from './ui/pwa';
import './ui/styles.css';
import './ui/cards.css';
import './ui/economy.css';
import './ui/vote.css';
import './ui/weird.css';
import './ui/time.css';
import './ui/season.css';
import './ui/soccer/assembly.css';

startPwa();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Root />
  </StrictMode>,
);
