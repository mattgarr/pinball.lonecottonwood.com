import React from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import App from './App.jsx';
import Join from './routes/Join.jsx';
import Rejoin from './routes/Rejoin.jsx';
import Home from './routes/Home.jsx';
import Me from './routes/Me.jsx';
import Machine from './routes/Machine.jsx';
import Guide from './routes/Guide.jsx';
import About from './routes/About.jsx';
import TV from './routes/TV.jsx';
import Host from './routes/Host.jsx';
import HostQR from './routes/HostQR.jsx';
import './styles.css';

createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <BrowserRouter>
      <Routes>
        <Route path="/tv" element={<TV />} />
        <Route path="/host/qr" element={<HostQR />} />
        <Route element={<App />}>
          <Route path="/" element={<Home />} />
          <Route path="/join" element={<Join />} />
          <Route path="/register" element={<Navigate to="/join" replace />} />
          <Route path="/rejoin" element={<Rejoin />} />
          <Route path="/me" element={<Me />} />
          <Route path="/about" element={<About />} />
          <Route path="/machine/:id" element={<Machine />} />
          <Route path="/machine/:id/guide" element={<Guide />} />
          <Route path="/host" element={<Host />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Route>
      </Routes>
    </BrowserRouter>
  </React.StrictMode>
);
