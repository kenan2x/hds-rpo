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

// --- Protector Test Sonucu: Topoloji Gösterimi ---

/** Durum renk kodlari */
function StatusDot({ ok, label }) {
  return (
    <span className="inline-flex items-center gap-1 text-xs">
      <span className={`w-2 h-2 rounded-full ${ok ? 'bg-green-500' : 'bg-red-500'}`} />
      <span className={ok ? 'text-green-400' : 'text-red-400'}>{label}</span>
    </span>
  );
}

/** Node type badge */
function NodeTypeBadge({ type }) {
  const map = {
    HardwareNodeBlock: { label: 'Storage', color: 'bg-blue-500/20 text-blue-400 border-blue-500/30' },
    HitachiVirtualStoragePlatform: { label: 'VSP', color: 'bg-cyan-500/20 text-cyan-400 border-cyan-500/30' },
    OSHost: { label: 'Host', color: 'bg-slate-500/20 text-slate-400 border-slate-500/30' },
  };
  const info = map[type] || { label: type, color: 'bg-slate-500/20 text-slate-400 border-slate-500/30' };
  return (
    <span className={`text-[10px] px-1.5 py-0.5 rounded border ${info.color}`}>
      {info.label}
    </span>
  );
}

function ProtectorTestDetails({ details }) {
  const [showRawJson, setShowRawJson] = useState(false);

  const { storageNodes, dataFlows, rpoEntries, rawCounts, errors } = details;

  const hasData = storageNodes?.length > 0 || dataFlows?.length > 0;

  return (
    <div className="mt-4 space-y-4">
      {details.apiVersion && (
        <div className="text-xs text-slate-500">API v{details.apiVersion}</div>
      )}

      {/* Depolama Sistemleri */}
      {storageNodes?.length > 0 && (
        <div>
          <div className="text-xs font-semibold text-blue-400 mb-2">
            Depolama Sistemleri ({storageNodes.length})
            {rawCounts && (
              <span className="text-slate-500 font-normal ml-2">
                (toplam {rawCounts.totalNodes} node, {rawCounts.totalNodes - storageNodes.length} host/diger filtrelendi)
              </span>
            )}
          </div>
          <div className="bg-slate-900/60 rounded-lg overflow-hidden">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-slate-700">
                  <th className="px-3 py-2 text-left text-slate-500 font-medium">Ad</th>
                  <th className="px-3 py-2 text-left text-slate-500 font-medium">Tip</th>
                  <th className="px-3 py-2 text-left text-slate-500 font-medium">Durum</th>
                </tr>
              </thead>
              <tbody>
                {storageNodes.map((node) => (
                  <tr key={node.id} className="border-b border-slate-800 hover:bg-slate-800/50">
                    <td className="px-3 py-2 text-white font-medium">{node.name}</td>
                    <td className="px-3 py-2"><NodeTypeBadge type={node.type} /></td>
                    <td className="px-3 py-2">
                      <div className="flex gap-3">
                        <StatusDot ok={node.accessible} label={node.accessible ? 'Eriselebilir' : 'Erisilemez'} />
                        <StatusDot ok={node.connected} label={node.connected ? 'Bagli' : 'Bagli Degil'} />
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Replikasyon Topolojisi (DataFlows) */}
      {dataFlows?.length > 0 && (
        <div>
          <div className="text-xs font-semibold text-green-400 mb-2">
            Replikasyon Topolojisi ({dataFlows.length} DataFlow)
          </div>
          <div className="space-y-2">
            {dataFlows.map((flow) => (
              <DataFlowCard key={flow.id} flow={flow} />
            ))}
          </div>
        </div>
      )}

      {/* RPO Durumu */}
      {rpoEntries?.length > 0 && (
        <div>
          <div className="text-xs font-semibold text-purple-400 mb-2">
            RPO Durumu ({rpoEntries.length} kayit)
          </div>
          <div className="bg-slate-900/60 rounded-lg overflow-hidden">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-slate-700">
                  <th className="px-3 py-2 text-left text-slate-500 font-medium">DataFlow</th>
                  <th className="px-3 py-2 text-left text-slate-500 font-medium">Kaynak</th>
                  <th className="px-3 py-2 text-left text-slate-500 font-medium">Hedef</th>
                  <th className="px-3 py-2 text-left text-slate-500 font-medium">Durum</th>
                  <th className="px-3 py-2 text-left text-slate-500 font-medium">Tip</th>
                </tr>
              </thead>
              <tbody>
                {rpoEntries.map((entry) => {
                  const statusColor = entry.status === 'eRPO_MET'
                    ? 'text-green-400'
                    : entry.status === 'eRPO_NOT_TRACKED'
                    ? 'text-slate-500'
                    : 'text-yellow-400';
                  const statusLabel = entry.status?.replace('eRPO_', '') || '-';
                  const moverLabel = entry.moverType?.replace('eMOVER_', '') || '-';
                  return (
                    <tr key={entry.id} className="border-b border-slate-800 hover:bg-slate-800/50">
                      <td className="px-3 py-2 text-slate-300">{entry.dataFlowName || '-'}</td>
                      <td className="px-3 py-2 text-white">{entry.sourceName || '-'}</td>
                      <td className="px-3 py-2 text-white">{entry.destinationName || '-'}</td>
                      <td className={`px-3 py-2 font-medium ${statusColor}`}>{statusLabel}</td>
                      <td className="px-3 py-2 text-slate-400">{moverLabel}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Hatalar */}
      {errors?.length > 0 && (
        <div>
          <div className="text-xs font-semibold text-yellow-400 mb-1">
            Erisilemeyen Endpoint'ler ({errors.length})
          </div>
          <div className="bg-slate-900/60 rounded p-2">
            {errors.map((e, i) => (
              <div key={i} className="text-xs text-yellow-400/80">
                {e.endpoint}: {e.error}
              </div>
            ))}
          </div>
        </div>
      )}

      {!hasData && (
        <div className="text-xs text-yellow-400">
          Giris basarili ancak endpoint'lerden veri donmedi.
        </div>
      )}

      {/* Ham JSON toggle */}
      {hasData && (
        <div>
          <button
            onClick={() => setShowRawJson(!showRawJson)}
            className="text-[10px] bg-slate-700 hover:bg-slate-600 text-slate-400 px-2 py-1 rounded transition-colors"
          >
            {showRawJson ? 'Ham JSON Gizle' : 'Ham JSON Goster'}
          </button>
          {showRawJson && (
            <div className="bg-slate-900/80 rounded p-2 mt-2 max-h-64 overflow-auto">
              <pre className="text-[10px] text-slate-500 whitespace-pre-wrap break-all">
                {JSON.stringify(details, null, 2)}
              </pre>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/** Tek bir DataFlow karti — baglantilari gosterir */
function DataFlowCard({ flow }) {
  const [expanded, setExpanded] = useState(false);

  const statusColor = flow.isActive ? 'border-green-500/30' : 'border-slate-700';
  const hasErrors = flow.numInError > 0;
  const hasOffline = flow.numOffline > 0;

  return (
    <div className={`bg-slate-900/60 border ${statusColor} rounded-lg p-3`}>
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <button
            onClick={() => setExpanded(!expanded)}
            className="text-slate-400 hover:text-white text-xs"
          >
            {expanded ? '▼' : '▶'}
          </button>
          <span className="text-white text-sm font-medium">{flow.name}</span>
          {flow.isActive ? (
            <span className="text-[10px] bg-green-500/20 text-green-400 border border-green-500/30 px-1.5 py-0.5 rounded">
              Aktif
            </span>
          ) : (
            <span className="text-[10px] bg-slate-500/20 text-slate-400 border border-slate-500/30 px-1.5 py-0.5 rounded">
              Pasif
            </span>
          )}
          {hasErrors && (
            <span className="text-[10px] bg-red-500/20 text-red-400 border border-red-500/30 px-1.5 py-0.5 rounded">
              {flow.numInError} hata
            </span>
          )}
          {hasOffline && (
            <span className="text-[10px] bg-yellow-500/20 text-yellow-400 border border-yellow-500/30 px-1.5 py-0.5 rounded">
              {flow.numOffline} offline
            </span>
          )}
        </div>
        <span className="text-[10px] text-slate-600">{flow.nodeCount} node</span>
      </div>

      {/* Baglantilar — her zaman goster */}
      {flow.connections?.length > 0 && (
        <div className="space-y-1 ml-5">
          {flow.connections.map((conn, i) => (
            <div key={conn.id || i} className="flex items-center gap-2 text-xs">
              <span className="text-white font-medium">{conn.sourceName}</span>
              <NodeTypeBadge type={conn.sourceType} />
              <span className="text-green-400">→</span>
              <span className="text-white font-medium">{conn.destinationName}</span>
              <NodeTypeBadge type={conn.destinationType} />
              {conn.label && (
                <span className="text-slate-500 text-[10px]">({conn.label})</span>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Genisletilmis detay */}
      {expanded && (
        <div className="mt-2 ml-5 text-[10px] text-slate-500 space-y-1">
          <div>ID: {flow.id}</div>
          {flow.activatedDate && <div>Aktif: {flow.activatedDate}</div>}
          {flow.numInProgress > 0 && <div>Devam eden: {flow.numInProgress}</div>}
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
