import React from 'react';
import { createRoot } from 'react-dom/client';
import './styles/theme.css';
import { DAppKitProvider } from '@mysten/dapp-kit-react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { dAppKit } from './lib/dappKit';
import { PatientShell } from './patient/Shell';
import { RecordList } from './patient/RecordList';
import { GrantList } from './patient/GrantList';
import { RecordCreate } from './patient/RecordCreate';
import { RecordShare } from './patient/RecordShare';
import { DoctorShell } from './doctor/Shell';
import { ConsumePage } from './doctor/ConsumePage';

const queryClient = new QueryClient();

createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <DAppKitProvider dAppKit={dAppKit}>
        <BrowserRouter>
          <Routes>
            <Route path="/" element={<Navigate to="/patient" replace />} />
            <Route path="/patient" element={<PatientShell />}>
              <Route index element={<RecordList />} />
              <Route path="grants" element={<GrantList />} />
              <Route path="new" element={<RecordCreate />} />
              <Route path="share/:recordId" element={<RecordShare />} />
            </Route>
            <Route path="/doctor" element={<DoctorShell />}>
              <Route index element={<ConsumePage />} />
            </Route>
            {/* Google OAuth implicit-flow redirect target. PatientShell mounts
                AuthLogin, which reads #id_token from the URL, completes zkLogin,
                then navigates back to /patient. */}
            <Route path="/zklogin/callback" element={<PatientShell />} />
          </Routes>
        </BrowserRouter>
      </DAppKitProvider>
    </QueryClientProvider>
  </React.StrictMode>,
);
