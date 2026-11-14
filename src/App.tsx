import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider } from './contexts/AuthContext';
import ProtectedRoute from './components/ProtectedRoute';
import Layout from './components/Layout';
import Login from './pages/Login';
import Dashboard from './pages/Dashboard';
import Projects from './pages/Projects';
import ProjectDetail from './pages/ProjectDetail';
import Builds from './pages/Builds';
import BuildDetail from './pages/BuildDetail';
import Toolchains from './pages/Toolchains';
import Agents from './pages/Agents';
import WebBuild from './pages/WebBuild';
import ApiKeys from './pages/ApiKeys';
import Telegram from './pages/Telegram';

export default function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route element={<ProtectedRoute><Layout /></ProtectedRoute>}>
            <Route path="/" element={<Dashboard />} />
            <Route path="/projects" element={<Projects />} />
            <Route path="/projects/:id" element={<ProjectDetail />} />
            <Route path="/builds" element={<Builds />} />
            <Route path="/builds/:id" element={<BuildDetail />} />
            <Route path="/toolchains" element={<Toolchains />} />
            <Route path="/agents" element={<Agents />} />
            <Route path="/web" element={<WebBuild />} />
            <Route path="/api-keys" element={<ApiKeys />} />
            <Route path="/telegram" element={<Telegram />} />
          </Route>
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  );
}
