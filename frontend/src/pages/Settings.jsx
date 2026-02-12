import React, { useState, useEffect } from 'react';
import axios from 'axios';
import {
  Server,
  Database,
  Clock,
  AlertTriangle,
  Gauge,
  Trash2,
  CheckCircle2,
  XCircle,
  Loader2,
  Save,
  Eye,
  EyeOff,
  Shield,
  ToggleLeft,
  ToggleRight,
  Check,
  ChevronDown,
  ChevronUp,
  Bell,
  RefreshCw,
} from 'lucide-react';

const TABS = [
  { id: 'api', label: 'API Yapilandirmasi', icon: Server },
  { id: 'storages', label: 'Depolama Kimlik Bilgileri', icon: Database },
  { id: 'polling', label: 'Yoklama Ayarlari', icon: Clock },
  { id: 'thresholds', label: 'Esik Degerleri', icon: Gauge },
  { id: 'retention', label: 'Veri Saklama', icon: Trash2 },
  { id: 'alerts', label: 'Uyari Gecmisi', icon: Bell },
];

export default function SettingsPage() {
  const [activeTab, setActiveTab] = useState('api');

  return (
    <div className="p-6 max-w-5xl mx-auto">
      <h1 className="text-2xl font-bold text-white mb-6">Ayarlar</h1>

      <div className="flex flex-col lg:flex-row gap-6">
        {/* Tab navigation */}
        <div className="lg:w-56 flex-shrink-0">
          <nav className="space-y-1">
            {TABS.map((tab) => {
              const Icon = tab.icon;
              const isActive = activeTab === tab.id;
              return (
                <button
                  key={tab.id}
                  onClick={() => setActiveTab(tab.id)}
                  className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-left transition-colors ${
                    isActive
                      ? 'bg-blue-600/20 text-blue-400 border border-blue-500/30'
                      : 'text-slate-400 hover:bg-slate-800 hover:text-white border border-transparent'
                  }`}
                >
                  <Icon className="w-4 h-4 flex-shrink-0" />
                  <span className="text-sm font-medium">{tab.label}</span>
                </button>
              );
            })}
          </nav>
        </div>

        {/* Tab content */}
        <div className="flex-1">
          {activeTab === 'api' && <ApiConfigTab />}
          {activeTab === 'storages' && <StorageCredentialsTab />}
          {activeTab === 'polling' && <PollingSettingsTab />}
          {activeTab === 'thresholds' && <ThresholdsTab />}
          {activeTab === 'retention' && <RetentionTab />}
          {activeTab === 'alerts' && <AlertHistoryTab />}
        </div>
      </div>
    </div>
  );
}

// --- API Configuration Tab ---
function ApiConfigTab() {
  const [host, setHost] = useState('');
  const [port, setPort] = useState('23451');
  const [ssl, setSsl] = useState(true);
  const [acceptSelfSigned, setAcceptSelfSigned] = useState(false);
  const [saving, setSaving] = useState(false);
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    const loadConfig = async () => {
      try {
        const res = await axios.get('/api/config');
        const config = res.data?.config;
        if (config) {
          setHost(config.host || '');
          setPort(String(config.port || '23451'));
          setSsl(config.use_ssl !== 0);
          setAcceptSelfSigned(!!config.accept_self_signed);
        }
      } catch {
        // No config yet
      }
    };
    loadConfig();
  }, []);

  const handleSave = async () => {
    setSaving(true);
    setError('');
    setSuccess(false);
    try {
      await axios.post('/api/config', {
        host,
        port: parseInt(port, 10),
        use_ssl: ssl,
        accept_self_signed: acceptSelfSigned,
      });
      setSuccess(true);
      setTimeout(() => setSuccess(false), 3000);
    } catch (err) {
      setError(err.response?.data?.error || 'Kaydetme basarisiz.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="bg-slate-800 border border-slate-700 rounded-xl p-6">
      <h2 className="text-lg font-semibold text-white mb-4">
        Ops Center API Yapilandirmasi
      </h2>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
        <div>
          <label className="block text-sm font-medium text-slate-300 mb-1.5">
            Ana Bilgisayar / IP
          </label>
          <input
            type="text"
            value={host}
            onChange={(e) => setHost(e.target.value)}
            placeholder="192.168.1.100"
            className="w-full px-4 py-2.5 bg-slate-700 border border-slate-600 rounded-lg text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-slate-300 mb-1.5">
            Port
          </label>
          <input
            type="number"
            value={port}
            onChange={(e) => setPort(e.target.value)}
            className="w-full px-4 py-2.5 bg-slate-700 border border-slate-600 rounded-lg text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>
      </div>

      <div className="flex flex-wrap gap-6 mb-6">
        <button
          type="button"
          onClick={() => setSsl(!ssl)}
          className="flex items-center gap-2 text-sm text-slate-300"
        >
          {ssl ? (
            <ToggleRight className="w-6 h-6 text-blue-400" />
          ) : (
            <ToggleLeft className="w-6 h-6 text-slate-500" />
          )}
          <Shield className="w-4 h-4" />
          SSL / HTTPS
        </button>
        <button
          type="button"
          onClick={() => setAcceptSelfSigned(!acceptSelfSigned)}
          className="flex items-center gap-2 text-sm text-slate-300"
        >
          {acceptSelfSigned ? (
            <ToggleRight className="w-6 h-6 text-yellow-400" />
          ) : (
            <ToggleLeft className="w-6 h-6 text-slate-500" />
          )}
          Kendinden Imzali Sertifika
        </button>
      </div>

      {error && (
        <div className="mb-4 p-3 rounded-lg bg-red-500/10 border border-red-500/30 text-red-400 text-sm">
          {error}
        </div>
      )}
      {success && (
        <div className="mb-4 p-3 rounded-lg bg-green-500/10 border border-green-500/30 text-green-400 text-sm flex items-center gap-2">
          <CheckCircle2 className="w-4 h-4" />
          Yapilandirma kaydedildi.
        </div>
      )}

      <button
        onClick={handleSave}
        disabled={saving || !host}
        className="flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:bg-blue-800 disabled:cursor-not-allowed text-white rounded-lg transition-colors"
      >
        {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
        Kaydet
      </button>
    </div>
  );
}

// --- Storage Credentials Tab ---
function StorageCredentialsTab() {
  const [storages, setStorages] = useState([]);
  const [loading, setLoading] = useState(true);
  const [credentials, setCredentials] = useState({});
  const [authStatus, setAuthStatus] = useState({});
  const [authLoading, setAuthLoading] = useState({});
  const [showPasswords, setShowPasswords] = useState({});

  useEffect(() => {
    const loadStorages = async () => {
      try {
        const res = await axios.get('/api/storages');
        const storageList = res.data.storages || [];
        setStorages(storageList);
        // Mark already authenticated and pre-fill usernames
        const statuses = {};
        const creds = {};
        for (const s of storageList) {
          if (s.is_authenticated) statuses[s.storage_device_id] = 'success';
          if (s.username) creds[s.storage_device_id] = { username: s.username, password: '' };
        }
        setAuthStatus(statuses);
        setCredentials(creds);
      } catch {
        // ignore
      } finally {
        setLoading(false);
      }
    };
    loadStorages();
  }, []);

  const handleAuth = async (storageId) => {
    const creds = credentials[storageId];
    if (!creds?.username || !creds?.password) return;
    setAuthLoading((prev) => ({ ...prev, [storageId]: true }));
    try {
      await axios.post(`/api/storages/${storageId}/authenticate`, {
        username: creds.username,
        password: creds.password,
      });
      setAuthStatus((prev) => ({ ...prev, [storageId]: 'success' }));
    } catch (err) {
      setAuthStatus((prev) => ({
        ...prev,
        [storageId]: err.response?.data?.error || 'Basarisiz',
      }));
    } finally {
      setAuthLoading((prev) => ({ ...prev, [storageId]: false }));
    }
  };

  const updateCredential = (storageId, field, value) => {
    setCredentials((prev) => ({
      ...prev,
      [storageId]: { ...prev[storageId], [field]: value },
    }));
    // Reset status when re-entering credentials
    if (authStatus[storageId] === 'success') {
      setAuthStatus((prev) => {
        const copy = { ...prev };
        delete copy[storageId];
        return copy;
      });
    }
  };

  if (loading) {
    return (
      <div className="bg-slate-800 border border-slate-700 rounded-xl p-6 flex justify-center">
        <Loader2 className="w-6 h-6 text-blue-400 animate-spin" />
      </div>
    );
  }

  return (
    <div className="bg-slate-800 border border-slate-700 rounded-xl p-6">
      <h2 className="text-lg font-semibold text-white mb-4">
        Depolama Kimlik Bilgileri
      </h2>
      <p className="text-slate-400 text-sm mb-6">
        Her depolama sistemi icin kimlik dogrulama bilgilerini guncelle.
      </p>

      {storages.length === 0 ? (
        <p className="text-slate-500 text-sm">
          Henuz depolama sistemi bulunamadi. Kurulumu tamamlayin.
        </p>
      ) : (
        <div className="space-y-4">
          {storages.map((storage) => {
            const sid = storage.storage_device_id;
            const status = authStatus[sid];
            const isLoading = authLoading[sid];
            const showPw = showPasswords[sid];
            return (
              <div
                key={sid}
                className="bg-slate-900/50 border border-slate-700 rounded-lg p-4"
              >
                <div className="flex items-center gap-3 mb-3">
                  <Database className="w-4 h-4 text-slate-400" />
                  <span className="text-white font-medium">{sid}</span>
                  {storage.model && (
                    <span className="text-xs bg-slate-700 text-slate-300 px-2 py-0.5 rounded">
                      {storage.model}
                    </span>
                  )}
                  {status === 'success' && (
                    <CheckCircle2 className="w-4 h-4 text-green-500 ml-auto" />
                  )}
                  {status && status !== 'success' && (
                    <span className="text-xs text-red-400 ml-auto">{status}</span>
                  )}
                </div>
                <div className="flex flex-wrap items-end gap-3">
                  <div className="flex-1 min-w-[160px]">
                    <label className="block text-xs text-slate-400 mb-1">
                      Kullanici Adi
                    </label>
                    <input
                      type="text"
                      value={credentials[sid]?.username || ''}
                      onChange={(e) => updateCredential(sid, 'username', e.target.value)}
                      placeholder="maintenance"
                      className="w-full px-3 py-2 bg-slate-700 border border-slate-600 rounded-lg text-white text-sm placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                  </div>
                  <div className="flex-1 min-w-[160px]">
                    <label className="block text-xs text-slate-400 mb-1">
                      Sifre
                    </label>
                    <div className="relative">
                      <input
                        type={showPw ? 'text' : 'password'}
                        value={credentials[sid]?.password || ''}
                        onChange={(e) => updateCredential(sid, 'password', e.target.value)}
                        placeholder="********"
                        className="w-full px-3 py-2 bg-slate-700 border border-slate-600 rounded-lg text-white text-sm placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500 pr-10"
                      />
                      <button
                        type="button"
                        onClick={() => setShowPasswords((p) => ({ ...p, [sid]: !showPw }))}
                        className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-white"
                      >
                        {showPw ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                      </button>
                    </div>
                  </div>
                  <button
                    onClick={() => handleAuth(sid)}
                    disabled={isLoading || !credentials[sid]?.username || !credentials[sid]?.password}
                    className="px-4 py-2 bg-green-600 hover:bg-green-700 disabled:bg-green-800 disabled:cursor-not-allowed text-white text-sm rounded-lg transition-colors flex items-center gap-2"
                  >
                    {isLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Shield className="w-4 h-4" />}
                    Dogrula
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// --- Polling Settings Tab ---
function PollingSettingsTab() {
  const [interval, setInterval] = useState(5);
  const [saving, setSaving] = useState(false);
  const [success, setSuccess] = useState(false);

  useEffect(() => {
    const load = async () => {
      try {
        const res = await axios.get('/api/config/settings');
        const pollingSeconds = parseInt(res.data.settings?.polling_interval_seconds || '300', 10);
        setInterval(Math.max(1, Math.round(pollingSeconds / 60)));
      } catch {
        // defaults
      }
    };
    load();
  }, []);

  const handleSave = async () => {
    setSaving(true);
    try {
      await axios.put('/api/config/settings', { polling_interval_seconds: String(interval * 60) });
      setSuccess(true);
      setTimeout(() => setSuccess(false), 3000);
    } catch {
      // ignore
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="bg-slate-800 border border-slate-700 rounded-xl p-6">
      <h2 className="text-lg font-semibold text-white mb-4">Yoklama Ayarlari</h2>
      <p className="text-slate-400 text-sm mb-6">
        Ops Center API'sinden veri cekme sikligini yapilandirin.
      </p>

      <div className="max-w-xs mb-6">
        <label className="block text-sm font-medium text-slate-300 mb-1.5">
          Yoklama Araligi (dakika)
        </label>
        <input
          type="number"
          min={1}
          max={60}
          value={interval}
          onChange={(e) => setInterval(Math.max(1, parseInt(e.target.value, 10) || 1))}
          className="w-full px-4 py-2.5 bg-slate-700 border border-slate-600 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
        <p className="text-xs text-slate-500 mt-1">Minimum: 1 dakika, Varsayilan: 5 dakika</p>
      </div>

      {success && (
        <div className="mb-4 p-3 rounded-lg bg-green-500/10 border border-green-500/30 text-green-400 text-sm flex items-center gap-2">
          <CheckCircle2 className="w-4 h-4" />
          Yoklama ayarlari kaydedildi.
        </div>
      )}

      <button
        onClick={handleSave}
        disabled={saving}
        className="flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:bg-blue-800 text-white rounded-lg transition-colors"
      >
        {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
        Kaydet
      </button>
    </div>
  );
}

// --- Thresholds Tab ---
function ThresholdsTab() {
  const [usageWarning, setUsageWarning] = useState(5);
  const [usageCritical, setUsageCritical] = useState(20);
  const [rpoWarning, setRpoWarning] = useState(600);
  const [rpoCritical, setRpoCritical] = useState(1800);
  const [saving, setSaving] = useState(false);
  const [success, setSuccess] = useState(false);

  useEffect(() => {
    const load = async () => {
      try {
        const res = await axios.get('/api/alerts/thresholds');
        const t = res.data?.thresholds;
        if (t) {
          setUsageWarning(t.usage_rate_warning || 5);
          setUsageCritical(t.usage_rate_critical || 20);
          setRpoWarning(t.rpo_seconds_warning || 600);
          setRpoCritical(t.rpo_seconds_critical || 1800);
        }
      } catch {
        // defaults
      }
    };
    load();
  }, []);

  const handleSave = async () => {
    setSaving(true);
    try {
      await axios.post('/api/alerts/thresholds', {
        usage_rate_warning: usageWarning,
        usage_rate_critical: usageCritical,
        rpo_seconds_warning: rpoWarning,
        rpo_seconds_critical: rpoCritical,
      });
      setSuccess(true);
      setTimeout(() => setSuccess(false), 3000);
    } catch {
      // ignore
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="bg-slate-800 border border-slate-700 rounded-xl p-6">
      <h2 className="text-lg font-semibold text-white mb-4">Esik Degerleri</h2>
      <p className="text-slate-400 text-sm mb-6">
        Uyari ve kritik seviye esiklerini belirleyin.
      </p>

      <div className="space-y-6">
        {/* Usage Rate Thresholds */}
        <div>
          <h3 className="text-sm font-medium text-slate-300 mb-3">
            Journal Kullanim Orani (usageRate %)
          </h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs text-yellow-400 mb-1">
                Uyari Esigi (%)
              </label>
              <input
                type="number"
                min={1}
                max={100}
                value={usageWarning}
                onChange={(e) => setUsageWarning(parseInt(e.target.value, 10) || 5)}
                className="w-full px-3 py-2 bg-slate-700 border border-slate-600 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-yellow-500"
              />
            </div>
            <div>
              <label className="block text-xs text-red-400 mb-1">
                Kritik Esigi (%)
              </label>
              <input
                type="number"
                min={1}
                max={100}
                value={usageCritical}
                onChange={(e) => setUsageCritical(parseInt(e.target.value, 10) || 20)}
                className="w-full px-3 py-2 bg-slate-700 border border-slate-600 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-red-500"
              />
            </div>
          </div>
        </div>

        {/* RPO Time Thresholds */}
        <div>
          <h3 className="text-sm font-medium text-slate-300 mb-3">
            Tahmini RPO Suresi (saniye)
          </h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs text-yellow-400 mb-1">
                Uyari Esigi (sn)
              </label>
              <input
                type="number"
                min={30}
                value={rpoWarning}
                onChange={(e) => setRpoWarning(parseInt(e.target.value, 10) || 600)}
                className="w-full px-3 py-2 bg-slate-700 border border-slate-600 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-yellow-500"
              />
              <p className="text-xs text-slate-500 mt-1">
                {Math.floor(rpoWarning / 60)} dakika
              </p>
            </div>
            <div>
              <label className="block text-xs text-red-400 mb-1">
                Kritik Esigi (sn)
              </label>
              <input
                type="number"
                min={60}
                value={rpoCritical}
                onChange={(e) => setRpoCritical(parseInt(e.target.value, 10) || 1800)}
                className="w-full px-3 py-2 bg-slate-700 border border-slate-600 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-red-500"
              />
              <p className="text-xs text-slate-500 mt-1">
                {Math.floor(rpoCritical / 60)} dakika
              </p>
            </div>
          </div>
        </div>
      </div>

      {success && (
        <div className="mt-4 p-3 rounded-lg bg-green-500/10 border border-green-500/30 text-green-400 text-sm flex items-center gap-2">
          <CheckCircle2 className="w-4 h-4" />
          Esik degerleri kaydedildi.
        </div>
      )}

      <button
        onClick={handleSave}
        disabled={saving}
        className="mt-6 flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:bg-blue-800 text-white rounded-lg transition-colors"
      >
        {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
        Kaydet
      </button>
    </div>
  );
}

// --- Data Retention Tab ---
function RetentionTab() {
  const [retentionDays, setRetentionDays] = useState(30);
  const [saving, setSaving] = useState(false);
  const [success, setSuccess] = useState(false);

  useEffect(() => {
    const load = async () => {
      try {
        const res = await axios.get('/api/config/settings');
        setRetentionDays(parseInt(res.data.settings?.data_retention_days || '30', 10));
      } catch {
        // defaults
      }
    };
    load();
  }, []);

  const handleSave = async () => {
    setSaving(true);
    try {
      await axios.put('/api/config/settings', { data_retention_days: String(retentionDays) });
      setSuccess(true);
      setTimeout(() => setSuccess(false), 3000);
    } catch {
      // ignore
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="bg-slate-800 border border-slate-700 rounded-xl p-6">
      <h2 className="text-lg font-semibold text-white mb-4">Veri Saklama</h2>
      <p className="text-slate-400 text-sm mb-6">
        Gecmis RPO verilerinin ne kadar sure saklanacagini belirleyin.
        Belirlenen sureden eski veriler saatlik ortalamalara donusturulur.
      </p>

      <div className="max-w-xs mb-6">
        <label className="block text-sm font-medium text-slate-300 mb-1.5">
          Saklama Suresi (gun)
        </label>
        <input
          type="number"
          min={1}
          max={365}
          value={retentionDays}
          onChange={(e) => setRetentionDays(Math.max(1, parseInt(e.target.value, 10) || 30))}
          className="w-full px-4 py-2.5 bg-slate-700 border border-slate-600 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
        <p className="text-xs text-slate-500 mt-1">
          Ham veri {retentionDays} gun saklanir, sonrasinda saatlik ortalamalar tutulur.
        </p>
      </div>

      {success && (
        <div className="mb-4 p-3 rounded-lg bg-green-500/10 border border-green-500/30 text-green-400 text-sm flex items-center gap-2">
          <CheckCircle2 className="w-4 h-4" />
          Saklama ayarlari kaydedildi.
        </div>
      )}

      <button
        onClick={handleSave}
        disabled={saving}
        className="flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:bg-blue-800 text-white rounded-lg transition-colors"
      >
        {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
        Kaydet
      </button>
    </div>
  );
}

// --- Alert History Tab ---
function AlertHistoryTab() {
  const [alerts, setAlerts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [acknowledging, setAcknowledging] = useState({});

  useEffect(() => {
    loadAlerts();
  }, []);

  const loadAlerts = async () => {
    setLoading(true);
    try {
      const res = await axios.get('/api/alerts');
      setAlerts(res.data.alerts || []);
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  };

  const handleAcknowledge = async (alertId) => {
    setAcknowledging((prev) => ({ ...prev, [alertId]: true }));
    try {
      await axios.post(`/api/alerts/${alertId}/acknowledge`);
      setAlerts((prev) =>
        prev.map((a) => (a.id === alertId ? { ...a, is_acknowledged: 1 } : a))
      );
    } catch {
      // ignore
    } finally {
      setAcknowledging((prev) => ({ ...prev, [alertId]: false }));
    }
  };

  const getSeverityColor = (severity) => {
    switch (severity) {
      case 'critical':
        return 'text-red-400 bg-red-500/10 border-red-500/30';
      case 'warning':
        return 'text-yellow-400 bg-yellow-500/10 border-yellow-500/30';
      case 'info':
        return 'text-blue-400 bg-blue-500/10 border-blue-500/30';
      default:
        return 'text-slate-400 bg-slate-500/10 border-slate-500/30';
    }
  };

  if (loading) {
    return (
      <div className="bg-slate-800 border border-slate-700 rounded-xl p-6 flex justify-center">
        <Loader2 className="w-6 h-6 text-blue-400 animate-spin" />
      </div>
    );
  }

  return (
    <div className="bg-slate-800 border border-slate-700 rounded-xl p-6">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-lg font-semibold text-white">Uyari Gecmisi</h2>
        <button
          onClick={loadAlerts}
          className="p-2 bg-slate-700 hover:bg-slate-600 text-slate-400 hover:text-white rounded-lg transition-colors"
        >
          <RefreshCw className="w-4 h-4" />
        </button>
      </div>

      {alerts.length === 0 ? (
        <div className="text-center py-12 text-slate-500">
          <Bell className="w-12 h-12 mx-auto mb-3 opacity-50" />
          <p>Henuz uyari bulunmuyor.</p>
        </div>
      ) : (
        <div className="space-y-3 max-h-[600px] overflow-y-auto">
          {alerts.map((alert) => (
            <div
              key={alert.id}
              className={`flex items-start gap-3 p-3 rounded-lg border ${
                alert.is_acknowledged ? 'opacity-50' : ''
              } ${getSeverityColor(alert.severity)}`}
            >
              <AlertTriangle className="w-4 h-4 mt-0.5 flex-shrink-0" />
              <div className="flex-1 min-w-0">
                <p className="text-sm">{alert.message}</p>
                <p className="text-xs opacity-60 mt-1">
                  {new Date(alert.created_at).toLocaleString('tr-TR')}
                  {alert.group_name && ` | ${alert.group_name}`}
                </p>
              </div>
              {!alert.is_acknowledged && (
                <button
                  onClick={() => handleAcknowledge(alert.id)}
                  disabled={acknowledging[alert.id]}
                  className="flex-shrink-0 px-3 py-1 bg-slate-700 hover:bg-slate-600 text-xs text-slate-300 rounded-lg transition-colors"
                >
                  {acknowledging[alert.id] ? (
                    <Loader2 className="w-3 h-3 animate-spin" />
                  ) : (
                    'Onayla'
                  )}
                </button>
              )}
              {alert.is_acknowledged && (
                <Check className="w-4 h-4 text-green-500 flex-shrink-0" />
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
