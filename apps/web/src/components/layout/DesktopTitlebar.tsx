import { useEffect, useState } from 'react';
import logoImg from '../../assets/Logo.png';

declare global {
  interface Window {
    electronAPI?: {
      isElectron?: boolean;
      platform?: string;
      getVersion?: () => Promise<string>;
      minimize?: () => Promise<void>;
      maximize?: () => Promise<boolean>;
      close?: () => Promise<void>;
    };
  }
}

export default function DesktopTitlebar() {
  const [isElectron, setIsElectron] = useState(false);

  useEffect(() => {
    if (window.electronAPI?.isElectron || navigator.userAgent.includes('Electron')) {
      setIsElectron(true);
      document.body.classList.add('has-electron-titlebar');
    }
  }, []);

  if (!isElectron) return null;

  return (
    <header className="desktop-titlebar" aria-label="Desktop Titlebar">
      <div className="desktop-titlebar-drag-region">
        <div className="desktop-titlebar-left">
          <img src={logoImg} alt="CrimeGraph AI" className="desktop-titlebar-logo" />
          <span className="desktop-titlebar-title">CrimeGraph AI</span>
          <span className="desktop-titlebar-badge">MHA / NCRB</span>
        </div>
        <div className="desktop-titlebar-center">
          Criminal Intelligence &amp; Graph Analytics Platform
        </div>
        <div className="desktop-titlebar-controls-spacer" />
      </div>
    </header>
  );
}
