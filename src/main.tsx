import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { RouterProvider } from '@tanstack/react-router';
import './ui/base.css';
import { readConfig } from './config';
import { createServices, ServicesProvider } from './app/services';
import { useAuth } from './auth/auth';
import { router } from './app/router';
import { ToastProvider } from './ui/toast';
import { SignInPage, ConfigErrorPage } from './features/auth/SignInPage';
import { seedRepeats } from './local/repeats';
import { dayKey } from './domain/time';

function Gate() {
  const { state } = useAuth();
  if (state.status === 'loading') return null;
  if (state.status === 'signedOut') return <SignInPage />;
  return <RouterProvider router={router} />;
}

const rootEl = document.getElementById('root')!;
const cfg = readConfig();

if ('error' in cfg) {
  createRoot(rootEl).render(<ConfigErrorPage message={cfg.error} />);
} else {
  const services = createServices(cfg.config);
  // Demo repeats only alongside demo data, so a real account starts clean.
  if (cfg.config.apiMode === 'mock') seedRepeats(dayKey(new Date(), Intl.DateTimeFormat().resolvedOptions().timeZone));
  createRoot(rootEl).render(
    <StrictMode>
      <ServicesProvider services={services}>
        <ToastProvider>
          <Gate />
        </ToastProvider>
      </ServicesProvider>
    </StrictMode>,
  );
}
