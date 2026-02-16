import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import axios from 'axios';
import {
  Server,
  Database,
  Layers,
  CheckCircle2,
  XCircle,
  Loader2,
  ArrowRight,
  ArrowLeft,
  Shield,
  Wifi,
  Eye,
  EyeOff,
  ToggleLeft,
  ToggleRight,
  RefreshCw,
  Trash2,
} from 'lucide-react';

const STEPS = [
  { id: 1, title: 'API Yapilandirmasi', icon: Server },
  { id: 2, title: 'Depolama Sistemleri', icon: Database },
  { id: 3, title: 'Tutarlilik Gruplari', icon: Layers },
];

export default function Setup() {
  const navigate = useNavigate();
  const [currentStep, setCurrentStep] = useState(1);
  const [clearing, setClearing] = useState(false);
  const [clearResult, setClearResult] = useState(null);

  const handleClearDiscovery = async () => {
    if (!window.confirm('Kesif verileri (tutarlilik gruplari, volume bilgileri, RPO gecmisi, uyarilar) silinecek.\nAPI ve depolama kimlik bilgileri korunacak.\n\nDevam etmek istiyor musunuz?')) {
      return;
    }
    setClearing(true);
    setClearResult(null);
    try {
      const res = await axios.post('/api/config/clear-discovery');
      const d = res.data.deleted;
      setClearResult({
        success: true,
        message: `Temizlendi: ${d.consistency_groups} CG, ${d.cg_volumes} volume, ${d.rpo_history} RPO, ${d.alerts} uyari`,
      });
    } catch (err) {
      setClearResult({
        success: false,
        message: err.response?.data?.error || 'Temizleme basarisiz.',
      });
    } finally {
      setClearing(false);
    }
  };

  return (
    <div className="p-6 max-w-4xl mx-auto">
      <div className="flex items-center justify-between mb-2">
        <h1 className="text-2xl font-bold text-white">Kurulum Sihirbazi</h1>
        <button
          onClick={handleClearDiscovery}
          disabled={clearing}
          className="flex items-center gap-2 px-3 py-1.5 bg-red-600/20 hover:bg-red-600/30 border border-red-500/30 text-red-400 text-sm rounded-lg transition-colors disabled:opacity-50"
          title="Kesif verilerini temizle (API ayarlari korunur)"
        >
          {clearing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />}
          Kesif Verilerini Temizle
        </button>
      </div>
      {clearResult && (
        <div className={`mb-4 p-2 rounded-lg border text-sm ${
          clearResult.success
            ? 'bg-green-500/10 border-green-500/30 text-green-400'
            : 'bg-red-500/10 border-red-500/30 text-red-400'
        }`}>
          {clearResult.message}
        </div>
      )}
      <p className="text-slate-400 mb-8">
        Ops Center API baglantisini yapilandirin ve depolama sistemlerini kesfet.
      </p>

      {/* Step indicator */}
      <div className="flex items-center gap-2 mb-8">
        {STEPS.map((step, idx) => {
          const Icon = step.icon;
          const isActive = currentStep === step.id;
          const isDone = currentStep > step.id;
          return (
            <React.Fragment key={step.id}>
              {idx > 0 && (
                <div
                  className={`flex-1 h-0.5 ${
                    isDone ? 'bg-blue-500' : 'bg-slate-700'
                  }`}
                />
              )}
              <div
                className={`flex items-center gap-2 px-4 py-2 rounded-lg border transition-colors ${
                  isActive
                    ? 'bg-blue-600/20 border-blue-500/40 text-blue-400'
                    : isDone
                    ? 'bg-green-600/10 border-green-500/30 text-green-400'
                    : 'bg-slate-800 border-slate-700 text-slate-500'
                }`}
              >
                {isDone ? (
                  <CheckCircle2 className="w-5 h-5" />
                ) : (
                  <Icon className="w-5 h-5" />
                )}
                <span className="text-sm font-medium hidden sm:inline">
                  {step.title}
                </span>
              </div>
            </React.Fragment>
          );
        })}
      </div>

      {/* Step content */}
      {currentStep === 1 && (
        <Step1ApiConfig onNext={() => setCurrentStep(2)} />
      )}
      {currentStep === 2 && (
        <Step2StorageAuth
          onNext={() => setCurrentStep(3)}
          onBack={() => setCurrentStep(1)}
        />
      )}
      {currentStep === 3 && (
        <Step3ConsistencyGroups
          onBack={() => setCurrentStep(2)}
          onFinish={() => navigate('/dashboard')}
        />
      )}
    </div>
  );
}

// --- Protector Test Sonucu: Detay Gösterimi ---

/**
 * Bir nesne dizisinden anahtar alanları çıkarır ve tablo olarak gösterir.
 * Bilinmeyen veri yapıları için de çalışır — ilk nesnenin alanlarını otomatik bulur.
 */
function DataSection({ title, data, color = 'slate' }) {
  const [expanded, setExpanded] = useState(false);

  if (!data || data.length === 0) return null;

  // İlk öğeden anahtar alanları çıkar (iç içe nesneler hariç)
  const sampleItem = data[0];
  const keys = Object.keys(sampleItem).filter((k) => {
    const v = sampleItem[k];
    return v !== null && v !== undefined && typeof v !== 'object';
  });
  // Nesne tipindeki alanları ayrı tut (genişletilebilir detay için)
  const objectKeys = Object.keys(sampleItem).filter((k) => {
    const v = sampleItem[k];
    return v !== null && v !== undefined && typeof v === 'object';
  });

  const colorMap = {
    blue: 'text-blue-400 border-blue-500/30',
    green: 'text-green-400 border-green-500/30',
    purple: 'text-purple-400 border-purple-500/30',
    slate: 'text-slate-300 border-slate-600',
  };

  return (
    <div className="mt-3">
      <div className={`text-xs font-semibold ${colorMap[color]?.split(' ')[0] || 'text-slate-300'} mb-1.5 flex items-center gap-2`}>
        {title} ({data.length})
        <button
          onClick={() => setExpanded(!expanded)}
          className="text-[10px] bg-slate-700 hover:bg-slate-600 text-slate-400 px-1.5 py-0.5 rounded transition-colors"
        >
          {expanded ? 'Tabloyu Goster' : 'Ham JSON'}
        </button>
      </div>

      {expanded ? (
        <div className="bg-slate-900/60 rounded p-2 max-h-64 overflow-auto">
          <pre className="text-xs text-slate-400 whitespace-pre-wrap break-all">
            {JSON.stringify(data, null, 2)}
          </pre>
        </div>
      ) : (
        <div className="bg-slate-900/60 rounded overflow-hidden">
          <div className="overflow-x-auto max-h-64">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-slate-700">
                  <th className="px-2 py-1.5 text-left text-slate-500 font-medium">#</th>
                  {keys.slice(0, 6).map((k) => (
                    <th key={k} className="px-2 py-1.5 text-left text-slate-500 font-medium whitespace-nowrap">
                      {k}
                    </th>
                  ))}
                  {objectKeys.length > 0 && (
                    <th className="px-2 py-1.5 text-left text-slate-500 font-medium">+detay</th>
                  )}
                </tr>
              </thead>
              <tbody>
                {data.map((item, idx) => (
                  <DataRow key={idx} item={item} idx={idx} keys={keys.slice(0, 6)} objectKeys={objectKeys} />
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

function DataRow({ item, idx, keys, objectKeys }) {
  const [showDetail, setShowDetail] = useState(false);

  return (
    <>
      <tr className="border-b border-slate-800 hover:bg-slate-800/50">
        <td className="px-2 py-1.5 text-slate-600">{idx + 1}</td>
        {keys.map((k) => (
          <td key={k} className="px-2 py-1.5 text-slate-300 whitespace-nowrap max-w-[200px] truncate" title={String(item[k] ?? '')}>
            {renderValue(item[k])}
          </td>
        ))}
        {objectKeys.length > 0 && (
          <td className="px-2 py-1.5">
            <button
              onClick={() => setShowDetail(!showDetail)}
              className="text-blue-400 hover:text-blue-300 text-[10px]"
            >
              {showDetail ? 'Gizle' : 'Goster'}
            </button>
          </td>
        )}
      </tr>
      {showDetail && (
        <tr>
          <td colSpan={keys.length + 2} className="px-2 py-2 bg-slate-900/80">
            <pre className="text-[10px] text-slate-500 whitespace-pre-wrap break-all max-h-40 overflow-auto">
              {JSON.stringify(
                Object.fromEntries(objectKeys.map((k) => [k, item[k]])),
                null,
                2
              )}
            </pre>
          </td>
        </tr>
      )}
    </>
  );
}

function renderValue(val) {
  if (val === null || val === undefined) return <span className="text-slate-600">-</span>;
  if (typeof val === 'boolean') {
    return val ? (
      <span className="text-green-400">evet</span>
    ) : (
      <span className="text-slate-500">hayir</span>
    );
  }
  return String(val);
}

function ProtectorTestDetails({ details }) {
  return (
    <div className="mt-3 space-y-1">
      {details.apiVersion && (
        <div className="text-xs text-slate-500">API v{details.apiVersion}</div>
      )}

      <DataSection title="Depolama Sistemleri (Nodes)" data={details.storages} color="blue" />
      <DataSection title="Replikasyonlar (DataFlows)" data={details.replications} color="green" />
      <DataSection title="RPO Durumu" data={details.rpoStatus} color="purple" />

      {/* Hatalar */}
      {details.errors?.length > 0 && (
        <div className="mt-3">
          <div className="text-xs font-semibold text-yellow-400 mb-1">
            Erisilemeyen Endpoint'ler ({details.errors.length})
          </div>
          <div className="bg-slate-900/60 rounded p-2">
            {details.errors.map((e, i) => (
              <div key={i} className="text-xs text-yellow-400/80">
                {e.endpoint}: {e.error}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Hicbir veri yoksa */}
      {!details.storages?.length &&
       !details.replications?.length &&
       !details.rpoStatus?.length && (
        <div className="text-xs text-yellow-400 mt-2">
          Giris basarili ancak endpoint'lerden veri donmedi.
        </div>
      )}
    </div>
  );
}

// --- Step 1: API Configuration (Config Manager + Protector) ---
function Step1ApiConfig({ onNext }) {
  const [host, setHost] = useState('');
  const [port, setPort] = useState('23451');
  const [ssl, setSsl] = useState(true);
  const [acceptSelfSigned, setAcceptSelfSigned] = useState(false);
  const [testing, setTesting] = useState(false);
  const [saving, setSaving] = useState(false);
  const [testResult, setTestResult] = useState(null);
  const [error, setError] = useState('');

  // Protector config
  const [protectorHost, setProtectorHost] = useState('');
  const [protectorPort, setProtectorPort] = useState('20964');
  const [protectorUsername, setProtectorUsername] = useState('');
  const [protectorPassword, setProtectorPassword] = useState('');
  const [showProtectorPw, setShowProtectorPw] = useState(false);
  const [protectorTesting, setProtectorTesting] = useState(false);
  const [protectorTestResult, setProtectorTestResult] = useState(null);
  const [protectorConfigured, setProtectorConfigured] = useState(false);

  // Load existing config
  useEffect(() => {
    const loadConfig = async () => {
      try {
        const [configRes, protectorRes] = await Promise.all([
          axios.get('/api/config'),
          axios.get('/api/config/protector').catch(() => ({ data: {} })),
        ]);
        const config = configRes.data?.config;
        if (config) {
          setHost(config.host || '');
          setPort(String(config.port || '23451'));
          setSsl(config.use_ssl !== 0);
          setAcceptSelfSigned(!!config.accept_self_signed);
        }
        const pConfig = protectorRes.data?.protector;
        if (pConfig) {
          if (pConfig.host) setProtectorHost(pConfig.host);
          setProtectorPort(String(pConfig.port || '20964'));
          if (pConfig.username) setProtectorUsername(pConfig.username);
          if (pConfig.is_configured) setProtectorConfigured(true);
        }
      } catch {
        // No config yet
      }
    };
    loadConfig();
  }, []);

  const handleTest = async () => {
    setTesting(true);
    setTestResult(null);
    setError('');
    try {
      const res = await axios.post('/api/config/test', {
        host,
        port: parseInt(port, 10),
        use_ssl: ssl,
        accept_self_signed: acceptSelfSigned,
      });
      setTestResult({ success: true, message: res.data.message || 'Baglanti basarili!' });
    } catch (err) {
      setTestResult({
        success: false,
        message: err.response?.data?.error || 'Baglanti basarisiz.',
      });
    } finally {
      setTesting(false);
    }
  };

  const handleProtectorTest = async () => {
    setProtectorTesting(true);
    setProtectorTestResult(null);
    try {
      const res = await axios.post('/api/config/protector/test', {
        host: protectorHost,
        port: parseInt(protectorPort, 10),
        username: protectorUsername,
        password: protectorPassword,
        accept_self_signed: acceptSelfSigned,
      });
      setProtectorTestResult({
        success: true,
        message: res.data.message || 'Protector baglantisi basarili!',
        details: res.data.details,
      });
    } catch (err) {
      setProtectorTestResult({
        success: false,
        message: err.response?.data?.error || 'Protector baglantisi basarisiz.',
      });
    } finally {
      setProtectorTesting(false);
    }
  };

  const handleSave = async () => {
    setSaving(true);
    setError('');
    try {
      // Save Config Manager settings
      await axios.post('/api/config', {
        host,
        port: parseInt(port, 10),
        use_ssl: ssl,
        accept_self_signed: acceptSelfSigned,
      });

      // Save Protector settings if provided
      if (protectorHost && protectorUsername && protectorPassword) {
        await axios.post('/api/config/protector', {
          host: protectorHost,
          port: parseInt(protectorPort, 10),
          username: protectorUsername,
          password: protectorPassword,
          accept_self_signed: acceptSelfSigned,
        });
      }

      onNext();
    } catch (err) {
      setError(err.response?.data?.error || 'Yapilandirma kaydedilemedi.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Configuration Manager */}
      <div className="bg-slate-800 border border-slate-700 rounded-xl shadow-lg p-6">
        <h2 className="text-lg font-semibold text-white mb-1">Ops Center Configuration Manager</h2>
        <p className="text-slate-400 text-sm mb-6">
          Hitachi Ops Center Configuration Manager API baglanti bilgilerini girin.
        </p>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
          <div>
            <label className="block text-sm font-medium text-slate-300 mb-1.5">
              Ana Bilgisayar / IP Adresi
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
              placeholder="23451"
              className="w-full px-4 py-2.5 bg-slate-700 border border-slate-600 rounded-lg text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
        </div>

        <div className="flex flex-wrap gap-6 mb-6">
          <button
            type="button"
            onClick={() => setSsl(!ssl)}
            className="flex items-center gap-2 text-sm text-slate-300 hover:text-white transition-colors"
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
            className="flex items-center gap-2 text-sm text-slate-300 hover:text-white transition-colors"
          >
            {acceptSelfSigned ? (
              <ToggleRight className="w-6 h-6 text-yellow-400" />
            ) : (
              <ToggleLeft className="w-6 h-6 text-slate-500" />
            )}
            Kendinden Imzali Sertifika Kabul Et
          </button>
        </div>

        {testResult && (
          <div
            className={`mb-4 p-3 rounded-lg border ${
              testResult.success
                ? 'bg-green-500/10 border-green-500/30 text-green-400'
                : 'bg-red-500/10 border-red-500/30 text-red-400'
            }`}
          >
            <div className="flex items-center gap-2">
              {testResult.success ? (
                <CheckCircle2 className="w-5 h-5" />
              ) : (
                <XCircle className="w-5 h-5" />
              )}
              <span className="text-sm">{testResult.message}</span>
            </div>
          </div>
        )}

        <button
          onClick={handleTest}
          disabled={testing || !host}
          className="flex items-center gap-2 px-4 py-2 bg-slate-700 hover:bg-slate-600 disabled:bg-slate-700 disabled:text-slate-500 text-white rounded-lg transition-colors"
        >
          {testing ? (
            <Loader2 className="w-4 h-4 animate-spin" />
          ) : (
            <Wifi className="w-4 h-4" />
          )}
          Baglantiyi Test Et
        </button>
      </div>

      {/* Protector / Common Services */}
      <div className="bg-slate-800 border border-slate-700 rounded-xl shadow-lg p-6">
        <div className="flex items-center gap-3 mb-1">
          <h2 className="text-lg font-semibold text-white">Ops Center Protector</h2>
          <span className="text-xs bg-yellow-500/20 text-yellow-400 px-2 py-0.5 rounded">
            Opsiyonel
          </span>
          {protectorConfigured && (
            <CheckCircle2 className="w-5 h-5 text-green-500" />
          )}
        </div>
        <p className="text-slate-400 text-sm mb-6">
          Depolama sistemleri ve replikasyon topolojisini kesfetmek icin Protector bilgilerini girin.
        </p>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
          <div>
            <label className="block text-sm font-medium text-slate-300 mb-1.5">
              Protector Host / IP Adresi
            </label>
            <input
              type="text"
              value={protectorHost}
              onChange={(e) => setProtectorHost(e.target.value)}
              placeholder="10.0.0.50"
              className="w-full px-4 py-2.5 bg-slate-700 border border-slate-600 rounded-lg text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-300 mb-1.5">
              Protector Port
            </label>
            <input
              type="number"
              value={protectorPort}
              onChange={(e) => setProtectorPort(e.target.value)}
              placeholder="20964"
              className="w-full px-4 py-2.5 bg-slate-700 border border-slate-600 rounded-lg text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
          <div>
            <label className="block text-sm font-medium text-slate-300 mb-1.5">
              Kullanici Adi
            </label>
            <input
              type="text"
              value={protectorUsername}
              onChange={(e) => setProtectorUsername(e.target.value)}
              placeholder="admin"
              className="w-full px-4 py-2.5 bg-slate-700 border border-slate-600 rounded-lg text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-300 mb-1.5">
              Sifre
            </label>
            <div className="relative">
              <input
                type={showProtectorPw ? 'text' : 'password'}
                value={protectorPassword}
                onChange={(e) => setProtectorPassword(e.target.value)}
                placeholder="********"
                className="w-full px-4 py-2.5 bg-slate-700 border border-slate-600 rounded-lg text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500 pr-10"
              />
              <button
                type="button"
                onClick={() => setShowProtectorPw(!showProtectorPw)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-white"
              >
                {showProtectorPw ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
          </div>
        </div>

        {protectorTestResult && (
          <div
            className={`mb-4 p-3 rounded-lg border ${
              protectorTestResult.success
                ? 'bg-green-500/10 border-green-500/30 text-green-400'
                : 'bg-red-500/10 border-red-500/30 text-red-400'
            }`}
          >
            <div className="flex items-center gap-2">
              {protectorTestResult.success ? (
                <CheckCircle2 className="w-5 h-5" />
              ) : (
                <XCircle className="w-5 h-5" />
              )}
              <span className="text-sm">{protectorTestResult.message}</span>
            </div>

            {/* Protector'dan gelen veri */}
            {protectorTestResult.details && protectorTestResult.success && (
              <ProtectorTestDetails details={protectorTestResult.details} />
            )}
          </div>
        )}

        <button
          onClick={handleProtectorTest}
          disabled={protectorTesting || !protectorHost || !protectorUsername || !protectorPassword}
          className="flex items-center gap-2 px-4 py-2 bg-slate-700 hover:bg-slate-600 disabled:bg-slate-700 disabled:text-slate-500 text-white rounded-lg transition-colors"
        >
          {protectorTesting ? (
            <Loader2 className="w-4 h-4 animate-spin" />
          ) : (
            <Wifi className="w-4 h-4" />
          )}
          Protector Baglantisini Test Et
        </button>
      </div>

      {/* Error and navigation */}
      {error && (
        <div className="p-3 rounded-lg border bg-red-500/10 border-red-500/30 text-red-400">
          <span className="text-sm">{error}</span>
        </div>
      )}

      <div className="flex justify-end">
        <button
          onClick={handleSave}
          disabled={saving || !host}
          className="flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:bg-blue-800 disabled:cursor-not-allowed text-white rounded-lg transition-colors"
        >
          {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Kaydet ve Devam Et'}
          <ArrowRight className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
}

// --- Step 2: Storage Discovery & Authentication ---
function Step2StorageAuth({ onNext, onBack }) {
  const [storages, setStorages] = useState([]);
  const [discovering, setDiscovering] = useState(false);
  const [error, setError] = useState('');
  const [credentials, setCredentials] = useState({});
  const [authStatus, setAuthStatus] = useState({});
  const [authLoading, setAuthLoading] = useState({});
  const [showPasswords, setShowPasswords] = useState({});

  // Helper to process storages response: set authStatus and pre-fill usernames
  const processStorages = (storageList) => {
    setStorages(storageList);
    const statuses = {};
    const creds = {};
    for (const s of storageList) {
      if (s.is_authenticated) {
        statuses[s.storage_device_id] = 'success';
      }
      if (s.username) {
        creds[s.storage_device_id] = { username: s.username, password: '' };
      }
    }
    setAuthStatus((prev) => ({ ...prev, ...statuses }));
    setCredentials((prev) => ({ ...prev, ...creds }));
  };

  // Auto-load existing storages on mount
  useEffect(() => {
    const loadExisting = async () => {
      try {
        const res = await axios.get('/api/storages');
        const existing = res.data.storages || [];
        if (existing.length > 0) {
          processStorages(existing);
        }
      } catch {
        // No storages yet
      }
    };
    loadExisting();
  }, []);

  const handleDiscover = async () => {
    setDiscovering(true);
    setError('');
    try {
      const res = await axios.post('/api/storages/discover');
      processStorages(res.data.storages || []);
    } catch (err) {
      setError(err.response?.data?.error || 'Depolama kesfetme basarisiz.');
    } finally {
      setDiscovering(false);
    }
  };

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
        [storageId]: err.response?.data?.error || 'Dogrulama basarisiz',
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
  };

  const allAuthenticated =
    storages.length > 0 &&
    storages.every((s) => s.is_authenticated || authStatus[s.storage_device_id] === 'success');

  return (
    <div className="bg-slate-800 border border-slate-700 rounded-xl shadow-lg p-6">
      <h2 className="text-lg font-semibold text-white mb-1">
        Depolama Sistemlerini Kesfet
      </h2>
      <p className="text-slate-400 text-sm mb-6">
        Ops Center'a kayitli depolama sistemlerini kesfet ve her biri icin kimlik dogrulama yap.
      </p>

      {/* Discover button */}
      <div className="mb-6">
        <button
          onClick={handleDiscover}
          disabled={discovering}
          className="flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:bg-blue-800 text-white rounded-lg transition-colors"
        >
          {discovering ? (
            <Loader2 className="w-4 h-4 animate-spin" />
          ) : (
            <RefreshCw className="w-4 h-4" />
          )}
          Depolama Sistemlerini Kesfet
        </button>
      </div>

      {error && (
        <div className="mb-4 p-3 rounded-lg border bg-red-500/10 border-red-500/30 text-red-400">
          <span className="text-sm">{error}</span>
        </div>
      )}

      {/* Storage list */}
      {storages.length > 0 && (
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
                <div className="flex flex-wrap items-center gap-4 mb-3">
                  <div className="flex items-center gap-2">
                    <Database className="w-5 h-5 text-slate-400" />
                    <span className="text-white font-medium">{sid}</span>
                  </div>
                  {storage.model && (
                    <span className="text-xs bg-slate-700 text-slate-300 px-2 py-1 rounded">
                      {storage.model}
                    </span>
                  )}
                  {storage.serial_number && (
                    <span className="text-xs text-slate-500">
                      SN: {storage.serial_number}
                    </span>
                  )}
                  {status === 'success' && (
                    <div className="flex items-center gap-2 ml-auto">
                      {(credentials[sid]?.username || storage.username) && (
                        <span className="text-xs text-green-400">
                          {credentials[sid]?.username || storage.username}
                        </span>
                      )}
                      <CheckCircle2 className="w-5 h-5 text-green-500" />
                    </div>
                  )}
                  {status && status !== 'success' && (
                    <div className="flex items-center gap-1 ml-auto text-red-400">
                      <XCircle className="w-5 h-5" />
                      <span className="text-xs">{status}</span>
                    </div>
                  )}
                </div>

                {status !== 'success' && (
                  <div className="flex flex-wrap items-end gap-3">
                    <div className="flex-1 min-w-[180px]">
                      <label className="block text-xs text-slate-400 mb-1">
                        Kullanici Adi
                      </label>
                      <input
                        type="text"
                        value={credentials[sid]?.username || ''}
                        onChange={(e) =>
                          updateCredential(sid, 'username', e.target.value)
                        }
                        placeholder="maintenance"
                        className="w-full px-3 py-2 bg-slate-700 border border-slate-600 rounded-lg text-white text-sm placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500"
                      />
                    </div>
                    <div className="flex-1 min-w-[180px]">
                      <label className="block text-xs text-slate-400 mb-1">
                        Sifre
                      </label>
                      <div className="relative">
                        <input
                          type={showPw ? 'text' : 'password'}
                          value={credentials[sid]?.password || ''}
                          onChange={(e) =>
                            updateCredential(sid, 'password', e.target.value)
                          }
                          placeholder="********"
                          className="w-full px-3 py-2 bg-slate-700 border border-slate-600 rounded-lg text-white text-sm placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500 pr-10"
                        />
                        <button
                          type="button"
                          onClick={() =>
                            setShowPasswords((p) => ({ ...p, [sid]: !showPw }))
                          }
                          className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-white"
                        >
                          {showPw ? (
                            <EyeOff className="w-4 h-4" />
                          ) : (
                            <Eye className="w-4 h-4" />
                          )}
                        </button>
                      </div>
                    </div>
                    <button
                      onClick={() => handleAuth(sid)}
                      disabled={
                        isLoading ||
                        !credentials[sid]?.username ||
                        !credentials[sid]?.password
                      }
                      className="px-4 py-2 bg-green-600 hover:bg-green-700 disabled:bg-green-800 disabled:cursor-not-allowed text-white text-sm rounded-lg transition-colors flex items-center gap-2"
                    >
                      {isLoading ? (
                        <Loader2 className="w-4 h-4 animate-spin" />
                      ) : (
                        <Shield className="w-4 h-4" />
                      )}
                      Dogrula
                    </button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Navigation */}
      <div className="flex justify-between mt-6">
        <button
          onClick={onBack}
          className="flex items-center gap-2 px-4 py-2 bg-slate-700 hover:bg-slate-600 text-white rounded-lg transition-colors"
        >
          <ArrowLeft className="w-4 h-4" />
          Geri
        </button>
        <button
          onClick={onNext}
          disabled={!allAuthenticated}
          className="flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:bg-blue-800 disabled:cursor-not-allowed text-white rounded-lg transition-colors"
        >
          Devam Et
          <ArrowRight className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
}

// --- Step 3: Consistency Group Discovery ---
function Step3ConsistencyGroups({ onBack, onFinish }) {
  const [groups, setGroups] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [monitoringEnabled, setMonitoringEnabled] = useState({});
  const [starting, setStarting] = useState(false);

  useEffect(() => {
    discoverGroups();
  }, []);

  const discoverGroups = async () => {
    setLoading(true);
    setError('');
    try {
      // Trigger actual discovery from Hitachi API, then fetch results
      await axios.post('/api/monitoring/discover');
      const res = await axios.get('/api/monitoring/groups');
      const discovered = res.data.groups || [];
      setGroups(discovered);
      // Enable all by default (based on existing is_monitored)
      const defaults = {};
      discovered.forEach((g) => {
        defaults[g.cg_id] = g.is_monitored !== false;
      });
      setMonitoringEnabled(defaults);
    } catch (err) {
      setError(err.response?.data?.error || 'Tutarlilik gruplari kesifedemedi.');
    } finally {
      setLoading(false);
    }
  };

  const toggleGroup = (cgId) => {
    setMonitoringEnabled((prev) => ({ ...prev, [cgId]: !prev[cgId] }));
  };

  const handleStart = async () => {
    setStarting(true);
    try {
      // Update monitoring status for each group
      const promises = groups.map((g) =>
        axios.patch(`/api/monitoring/groups/${g.cg_id}`, {
          is_monitored: !!monitoringEnabled[g.cg_id],
        }).catch(() => null)
      );
      await Promise.all(promises);
      onFinish();
    } catch (err) {
      setError(err.response?.data?.error || 'Izleme baslatma basarisiz.');
    } finally {
      setStarting(false);
    }
  };

  return (
    <div className="bg-slate-800 border border-slate-700 rounded-xl shadow-lg p-6">
      <h2 className="text-lg font-semibold text-white mb-1">
        Tutarlilik Gruplari
      </h2>
      <p className="text-slate-400 text-sm mb-6">
        Kesfedilen 3DC Universal Replicator tutarlilik gruplari. Izlemek istediklerinizi secin.
      </p>

      {loading && (
        <div className="flex items-center gap-3 justify-center py-12 text-slate-400">
          <Loader2 className="w-6 h-6 animate-spin" />
          <span>Tutarlilik gruplari kesfediliyor...</span>
        </div>
      )}

      {error && (
        <div className="mb-4 p-3 rounded-lg border bg-red-500/10 border-red-500/30 text-red-400">
          <span className="text-sm">{error}</span>
        </div>
      )}

      {!loading && groups.length === 0 && !error && (
        <div className="text-center py-12 text-slate-500">
          <Layers className="w-12 h-12 mx-auto mb-3 opacity-50" />
          <p>Henuz tutarlilik grubu kesfedilmedi.</p>
          <button
            onClick={discoverGroups}
            className="mt-4 px-4 py-2 bg-slate-700 hover:bg-slate-600 text-white text-sm rounded-lg transition-colors"
          >
            Tekrar Dene
          </button>
        </div>
      )}

      {groups.length > 0 && (
        <div className="space-y-3 mb-6">
          {groups.map((group) => (
            <div
              key={group.cg_id}
              className={`flex items-center justify-between p-4 rounded-lg border transition-colors ${
                monitoringEnabled[group.cg_id]
                  ? 'bg-blue-600/10 border-blue-500/30'
                  : 'bg-slate-900/50 border-slate-700'
              }`}
            >
              <div className="flex items-center gap-3">
                <button
                  onClick={() => toggleGroup(group.cg_id)}
                  className="text-slate-300 hover:text-white"
                >
                  {monitoringEnabled[group.cg_id] ? (
                    <ToggleRight className="w-6 h-6 text-blue-400" />
                  ) : (
                    <ToggleLeft className="w-6 h-6 text-slate-500" />
                  )}
                </button>
                <div>
                  <span className="text-white font-medium">
                    {group.name || `CG-${group.cg_id}`}
                  </span>
                  {group.source_storage_id && (
                    <span className="text-xs text-slate-500 ml-2">
                      {group.source_storage_id}
                    </span>
                  )}
                </div>
              </div>
              <div className="flex items-center gap-4 text-sm text-slate-400">
                <span>{group.volume_count || 0} volume</span>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Navigation */}
      <div className="flex justify-between mt-6">
        <button
          onClick={onBack}
          className="flex items-center gap-2 px-4 py-2 bg-slate-700 hover:bg-slate-600 text-white rounded-lg transition-colors"
        >
          <ArrowLeft className="w-4 h-4" />
          Geri
        </button>
        <button
          onClick={handleStart}
          disabled={
            starting ||
            (groups.length > 0 && Object.values(monitoringEnabled).every((v) => !v))
          }
          className="flex items-center gap-2 px-6 py-2 bg-green-600 hover:bg-green-700 disabled:bg-green-800 disabled:cursor-not-allowed text-white font-medium rounded-lg transition-colors"
        >
          {starting ? (
            <Loader2 className="w-4 h-4 animate-spin" />
          ) : null}
          Izlemeyi Baslat
          <ArrowRight className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
}
