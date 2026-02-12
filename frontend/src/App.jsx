import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { Routes, Route, Navigate, useNavigate, useLocation, Link } from 'react-router-dom';
import axios from 'axios';
import {
  LayoutDashboard,
  Settings,
  LogOut,
  Activity,
  Database,
  Wifi,
  WifiOff,
  Menu,
  X,
  KeyRound,
} from 'lucide-react';

import Login from './pages/Login';
import Setup from './pages/Setup';
import Dashboard from './pages/Dashboard';
import SettingsPage from './pages/Settings';

// --- Auth Context ---
const AuthContext = createContext(null);

export function useAuth() {
  return useContext(AuthContext);
}

function AuthProvider({ children }) {
  const [token, setToken] = useState(() => localStorage.getItem('rpo_token'));
  const [user, setUser] = useState(() => {
    const stored = localStorage.getItem('rpo_user');
    return stored ? JSON.parse(stored) : null;
  });
  const [mustChangePassword, setMustChangePassword] = useState(false);

  useEffect(() => {
    if (token) {
      axios.defaults.headers.common['Authorization'] = `Bearer ${token}`;
    } else {
      delete axios.defaults.headers.common['Authorization'];
    }
  }, [token]);

  const login = useCallback((tokenValue, userData) => {
    localStorage.setItem('rpo_token', tokenValue);
    localStorage.setItem('rpo_user', JSON.stringify(userData));
    setToken(tokenValue);
    setUser(userData);
    setMustChangePassword(userData?.must_change_password || false);
    axios.defaults.headers.common['Authorization'] = `Bearer ${tokenValue}`;
  }, []);

  const logout = useCallback(() => {
    localStorage.removeItem('rpo_token');
    localStorage.removeItem('rpo_user');
    setToken(null);
    setUser(null);
    setMustChangePassword(false);
    delete axios.defaults.headers.common['Authorization'];
  }, []);

  const clearMustChangePassword = useCallback(() => {
    setMustChangePassword(false);
    if (user) {
      const updated = { ...user, must_change_password: false };
      localStorage.setItem('rpo_user', JSON.stringify(updated));
      setUser(updated);
    }
  }, [user]);

  return (
    <AuthContext.Provider value={{ token, user, mustChangePassword, login, logout, clearMustChangePassword }}>
      {children}
    </AuthContext.Provider>
  );
}

// --- Password Change Modal ---
function PasswordChangeModal({ onComplete }) {
  const { token } = useAuth();
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');

    if (newPassword !== confirmPassword) {
      setError('Yeni şifreler eşleşmiyor.');
      return;
    }
    if (newPassword.length < 6) {
      setError('Yeni şifre en az 6 karakter olmalıdır.');
      return;
    }

    setLoading(true);
    try {
      await axios.post('/api/auth/change-password', {
        current_password: currentPassword,
        new_password: newPassword,
      });
      onComplete();
    } catch (err) {
      setError(err.response?.data?.error || 'Şifre değiştirme başarısız.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50">
      <div className="bg-slate-800 border border-slate-700 rounded-xl shadow-2xl p-8 w-full max-w-md">
        <div className="flex items-center gap-3 mb-6">
          <KeyRound className="w-6 h-6 text-yellow-500" />
          <h2 className="text-xl font-semibold text-white">Şifre Değiştirme Zorunlu</h2>
        </div>
        <p className="text-slate-400 text-sm mb-6">
          İlk girişinizde şifrenizi değiştirmeniz gerekmektedir.
        </p>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-slate-300 mb-1">Mevcut Şifre</label>
            <input
              type="password"
              value={currentPassword}
              onChange={(e) => setCurrentPassword(e.target.value)}
              className="w-full px-3 py-2 bg-slate-700 border border-slate-600 rounded-lg text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500"
              required
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-300 mb-1">Yeni Şifre</label>
            <input
              type="password"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              className="w-full px-3 py-2 bg-slate-700 border border-slate-600 rounded-lg text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500"
              required
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-300 mb-1">Yeni Şifre (Tekrar)</label>
            <input
              type="password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              className="w-full px-3 py-2 bg-slate-700 border border-slate-600 rounded-lg text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500"
              required
            />
          </div>
          {error && <p className="text-red-400 text-sm">{error}</p>}
          <button
            type="submit"
            disabled={loading}
            className="w-full bg-blue-600 hover:bg-blue-700 disabled:bg-blue-800 disabled:cursor-not-allowed text-white font-medium py-2 px-4 rounded-lg transition-colors"
          >
            {loading ? 'Değiştiriliyor...' : 'Şifreyi Değiştir'}
          </button>
        </form>
      </div>
    </div>
  );
}

// --- Protected Route ---
function ProtectedRoute({ children }) {
  const { token } = useAuth();
  const location = useLocation();

  if (!token) {
    return <Navigate to="/login" state={{ from: location }} replace />;
  }

  return children;
}

// --- Connection Status Indicator ---
function ConnectionStatus() {
  const [status, setStatus] = useState({ connected: false, storages: [] });

  useEffect(() => {
    const checkStatus = async () => {
      try {
        const res = await axios.get('/api/health');
        setStatus({
          connected: true,
          storages: res.data.storages || [],
        });
      } catch {
        setStatus({ connected: false, storages: [] });
      }
    };
    checkStatus();
    const interval = setInterval(checkStatus, 30000);
    return () => clearInterval(interval);
  }, []);

  return (
    <div className="flex items-center gap-2">
      {status.connected ? (
        <>
          <Wifi className="w-4 h-4 text-green-500" />
          <span className="text-xs text-green-400">Bağlı</span>
        </>
      ) : (
        <>
          <WifiOff className="w-4 h-4 text-red-500" />
          <span className="text-xs text-red-400">Bağlantı Yok</span>
        </>
      )}
    </div>
  );
}

// --- Sidebar ---
function Sidebar({ collapsed, onToggle }) {
  const { logout, user } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();

  const handleLogout = () => {
    logout();
    navigate('/login');
  };

  const navItems = [
    { path: '/dashboard', label: 'Kontrol Paneli', icon: LayoutDashboard },
    { path: '/setup', label: 'Kurulum', icon: Database },
    { path: '/settings', label: 'Ayarlar', icon: Settings },
  ];

  return (
    <aside
      className={`fixed left-0 top-0 h-full bg-slate-800 border-r border-slate-700 z-40 transition-all duration-300 flex flex-col ${
        collapsed ? 'w-16' : 'w-60'
      }`}
    >
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-4 border-b border-slate-700">
        {!collapsed && (
          <div className="flex items-center gap-2">
            <Activity className="w-6 h-6 text-blue-400" />
            <span className="font-bold text-white text-sm">3DC RPO Monitor</span>
          </div>
        )}
        <button
          onClick={onToggle}
          className="p-1.5 rounded-lg hover:bg-slate-700 text-slate-400 hover:text-white transition-colors"
        >
          {collapsed ? <Menu className="w-5 h-5" /> : <X className="w-5 h-5" />}
        </button>
      </div>

      {/* Navigation */}
      <nav className="flex-1 py-4 px-2 space-y-1">
        {navItems.map((item) => {
          const Icon = item.icon;
          const isActive = location.pathname === item.path;
          return (
            <Link
              key={item.path}
              to={item.path}
              className={`flex items-center gap-3 px-3 py-2.5 rounded-lg transition-colors ${
                isActive
                  ? 'bg-blue-600/20 text-blue-400 border border-blue-500/30'
                  : 'text-slate-400 hover:bg-slate-700/50 hover:text-white border border-transparent'
              }`}
              title={collapsed ? item.label : undefined}
            >
              <Icon className="w-5 h-5 flex-shrink-0" />
              {!collapsed && <span className="text-sm font-medium">{item.label}</span>}
            </Link>
          );
        })}
      </nav>

      {/* Footer */}
      <div className="border-t border-slate-700 p-3">
        {!collapsed && (
          <div className="mb-3 px-2">
            <ConnectionStatus />
          </div>
        )}
        {!collapsed && user && (
          <div className="mb-2 px-2">
            <span className="text-xs text-slate-500">{user.username}</span>
          </div>
        )}
        <button
          onClick={handleLogout}
          className="flex items-center gap-3 w-full px-3 py-2 rounded-lg text-slate-400 hover:bg-red-500/10 hover:text-red-400 transition-colors"
          title="Cikis Yap"
        >
          <LogOut className="w-5 h-5 flex-shrink-0" />
          {!collapsed && <span className="text-sm font-medium">Cikis Yap</span>}
        </button>
      </div>
    </aside>
  );
}

// --- Main Layout ---
function AppLayout({ children }) {
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const { mustChangePassword, clearMustChangePassword } = useAuth();

  return (
    <div className="min-h-screen bg-slate-900">
      {mustChangePassword && (
        <PasswordChangeModal onComplete={clearMustChangePassword} />
      )}
      <Sidebar
        collapsed={sidebarCollapsed}
        onToggle={() => setSidebarCollapsed(!sidebarCollapsed)}
      />
      <main
        className={`transition-all duration-300 ${
          sidebarCollapsed ? 'ml-16' : 'ml-60'
        }`}
      >
        {children}
      </main>
    </div>
  );
}

// --- App ---
export default function App() {
  return (
    <AuthProvider>
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route
          path="/dashboard"
          element={
            <ProtectedRoute>
              <AppLayout>
                <Dashboard />
              </AppLayout>
            </ProtectedRoute>
          }
        />
        <Route
          path="/setup"
          element={
            <ProtectedRoute>
              <AppLayout>
                <Setup />
              </AppLayout>
            </ProtectedRoute>
          }
        />
        <Route
          path="/settings"
          element={
            <ProtectedRoute>
              <AppLayout>
                <SettingsPage />
              </AppLayout>
            </ProtectedRoute>
          }
        />
        <Route path="*" element={<Navigate to="/dashboard" replace />} />
      </Routes>
    </AuthProvider>
  );
}
