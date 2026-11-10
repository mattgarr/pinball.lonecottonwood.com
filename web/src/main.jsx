import React from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import App from './App.jsx';
import Join from './routes/Join.jsx';
import Rejoin from './routes/Rejoin.jsx';
import Home from './routes/Home.jsx';
import Me from './routes/Me.jsx';
import Ranks from './routes/Ranks.jsx';
import Machine from './routes/Machine.jsx';
import Guide from './routes/Guide.jsx';
import About from './routes/About.jsx';
import TV from './routes/TV.jsx';
import Host from './routes/Host.jsx';
import HostQR from './routes/HostQR.jsx';
import LightsSim from './routes/LightsSim.jsx';
import HostCalibrate from './routes/HostCalibrate.jsx';
import HostTest from './routes/HostTest.jsx';
import HostGuests from './routes/HostGuests.jsx';
import ErrorBoundary from './components/ErrorBoundary.jsx';
import './styles.css';
import './host.css';

createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <ErrorBoundary>
    <BrowserRouter>
      <Routes>
        <Route path="/tv" element={<TV />} />
        <Route path="/host/qr" element={<HostQR />} />
        <Route path="/lights-sim" element={<LightsSim />} />
        <Route element={<App />}>
          <Route path="/" element={<Home />} />
          <Route path="/join" element={<Join />} />
          <Route path="/register" element={<Navigate to="/join" replace />} />
          <Route path="/rejoin" element={<Rejoin />} />
          <Route path="/me" element={<Me />} />
          <Route path="/ranks" element={<Ranks />} />
          <Route path="/about" element={<About />} />
          <Route path="/machine/:id" element={<Machine />} />
          <Route path="/machine/:id/guide" element={<Guide />} />
          <Route path="/host" element={<Host />} />
          <Route path="/host/test" element={<HostTest />} />
          <Route path="/host/guests" element={<HostGuests />} />
          <Route path="/host/calibrate" element={<HostCalibrate />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Route>
      </Routes>
    </BrowserRouter>
    </ErrorBoundary>
  </React.StrictMode>
);
