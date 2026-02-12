import React, { useState, useEffect, useCallback, useRef } from 'react';
import axios from 'axios';
import {
  RefreshCw,
  Clock,
  AlertTriangle,
  Loader2,
  ChevronDown,
  ChevronUp,
  Activity,
  Database,
  TrendingDown,
  TrendingUp,
  Minus,
  Circle,
  Pause,
  Play,
  Timer,
  HardDrive,
  ArrowRightLeft,
  Info,
} from 'lucide-react';
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Area,
  AreaChart,
} from 'recharts';

const REFRESH_OPTIONS = [
  { label: '1 dk', value: 60000 },
  { label: '2 dk', value: 120000 },
  { label: '5 dk', value: 300000 },
  { label: '10 dk', value: 600000 },
  { label: '15 dk', value: 900000 },
];

const JOURNAL_STATUS_MAP = {
  SMPL: { label: 'Kullanilmiyor', severity: 'info', color: 'gray' },
  PJNN: { label: 'Normal', severity: 'ok', color: 'green' },
  SJNN: { label: 'Normal', severity: 'ok', color: 'green' },
  PJSN: { label: 'Normal Bolunme', severity: 'warning', color: 'yellow' },
  SJSN: { label: 'Normal Bolunme', severity: 'warning', color: 'yellow' },
  PJNF: { label: 'Journal Dolu', severity: 'high', color: 'orange' },
  SJNF: { label: 'Journal Dolu', severity: 'high', color: 'orange' },
  PJSF: { label: 'Dolu + Bolunme', severity: 'critical', color: 'red' },
  SJSF: { label: 'Dolu + Bolunme', severity: 'critical', color: 'red' },
  PJSE: { label: 'Hata Bolunme', severity: 'critical', color: 'red' },
  SJSE: { label: 'Hata Bolunme', severity: 'critical', color: 'red' },
  PJNS: { label: '3DC Delta Esitleme', severity: 'warning', color: 'yellow' },
  SJNS: { label: '3DC Delta Esitleme', severity: 'warning', color: 'yellow' },
  PJES: { label: 'Hata (3DC Delta)', severity: 'critical', color: 'red' },
  SJES: { label: 'Hata (3DC Delta)', severity: 'critical', color: 'red' },
};

const PAIR_STATUS_MAP = {
  PAIR: { label: 'Normal', color: 'green' },
  COPY: { label: 'Senkronize Ediliyor', color: 'blue' },
  PSUS: { label: 'Askiya Alindi (P)', color: 'red' },
  SSUS: { label: 'Askiya Alindi (S)', color: 'red' },
  PSUE: { label: 'Hata (Askiya Alindi)', color: 'red' },
  SSWS: { label: 'S-VOL Yazilabilir', color: 'orange' },
};

function getStatusColor(color) {
  const map = {
    green: 'text-green-500',
    yellow: 'text-yellow-500',
    orange: 'text-orange-500',
    red: 'text-red-500',
    gray: 'text-gray-500',
    blue: 'text-blue-500',
  };
  return map[color] || 'text-slate-400';
}

function getStatusBg(color) {
  const map = {
    green: 'bg-green-500/10 border-green-500/30',
    yellow: 'bg-yellow-500/10 border-yellow-500/30',
    orange: 'bg-orange-500/10 border-orange-500/30',
    red: 'bg-red-500/10 border-red-500/30',
    gray: 'bg-gray-500/10 border-gray-500/30',
    blue: 'bg-blue-500/10 border-blue-500/30',
  };
  return map[color] || 'bg-slate-500/10 border-slate-500/30';
}

function getUsageRateColor(rate) {
  if (rate < 5) return 'green';
  if (rate < 20) return 'yellow';
  return 'red';
}

function getTrendIcon(trend) {
  if (trend === 'decreasing') return <TrendingDown className="w-4 h-4 text-green-400" />;
  if (trend === 'increasing') return <TrendingUp className="w-4 h-4 text-red-400" />;
  return <Minus className="w-4 h-4 text-slate-400" />;
}

function getTrendLabel(trend) {
  if (trend === 'decreasing') return 'Azaliyor';
  if (trend === 'increasing') return 'Artiyor';
  return 'Stabil';
}

function formatTime(seconds) {
  if (seconds < 60) return `${Math.round(seconds)} sn`;
  if (seconds < 3600) return `${Math.round(seconds / 60)} dk`;
  const h = Math.floor(seconds / 3600);
  const m = Math.round((seconds % 3600) / 60);
  return `${h} sa ${m} dk`;
}

function formatBytes(bytes) {
  if (bytes == null || bytes === 0) return '0 B';
  const absBytes = Math.abs(bytes);
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB', 'PB'];
  const i = Math.min(Math.floor(Math.log(absBytes) / Math.log(k)), sizes.length - 1);
  const value = parseFloat((absBytes / Math.pow(k, i)).toFixed(2));
  return (bytes < 0 ? '-' : '') + value + ' ' + sizes[i];
}

function formatNumber(num) {
  if (num === null || num === undefined) return '-';
  return num.toLocaleString('tr-TR');
}

function formatTimestamp(ts) {
  if (!ts) return '-';
  const d = new Date(ts);
  return d.toLocaleString('tr-TR', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  });
}

function formatChartTime(ts) {
  if (!ts) return '';
  const d = new Date(ts);
  return d.toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' });
}

export default function Dashboard() {
  const [groups, setGroups] = useState([]);
  const [alerts, setAlerts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [lastRefresh, setLastRefresh] = useState(null);
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [refreshInterval, setRefreshInterval] = useState(300000); // 5 min
  const [staleData, setStaleData] = useState(false);
  const intervalRef = useRef(null);

  const fetchData = useCallback(async (showLoading = false) => {
    if (showLoading) setLoading(true);
    try {
      const [groupsRes, alertsRes] = await Promise.all([
        axios.get('/api/monitoring/groups'),
        axios.get('/api/alerts?acknowledged=false').catch(() => ({ data: { alerts: [] } })),
      ]);
      setGroups(groupsRes.data.groups || []);
      setAlerts(alertsRes.data.alerts || []);
      setLastRefresh(new Date());
      setStaleData(false);
    } catch (err) {
      console.error('Veri alinirken hata:', err);
      // If we had data before, mark as stale; don't clear it
      if (groups.length > 0) {
        setStaleData(true);
      }
    } finally {
      setLoading(false);
    }
  }, []);

  const handleManualRefresh = async () => {
    setRefreshing(true);
    try {
      await axios.post('/api/monitoring/poll');
      await fetchData();
    } catch (err) {
      console.error('Yoklama basarisiz:', err);
    } finally {
      setRefreshing(false);
    }
  };

  // Initial fetch
  useEffect(() => {
    fetchData(true);
  }, [fetchData]);

  // Auto-refresh
  useEffect(() => {
    if (intervalRef.current) clearInterval(intervalRef.current);
    if (autoRefresh) {
      intervalRef.current = setInterval(() => fetchData(), refreshInterval);
    }
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [autoRefresh, refreshInterval, fetchData]);

  // Check staleness
  useEffect(() => {
    const staleCheck = setInterval(() => {
      if (lastRefresh) {
        const elapsed = Date.now() - lastRefresh.getTime();
        if (elapsed > refreshInterval * 2) {
          setStaleData(true);
        }
      }
    }, 30000);
    return () => clearInterval(staleCheck);
  }, [lastRefresh, refreshInterval]);

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-center">
          <Loader2 className="w-10 h-10 text-blue-400 animate-spin mx-auto mb-4" />
          <p className="text-slate-400">Izleme verileri yukleniyor...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="p-6">
      {/* Header bar */}
      <div className="flex flex-wrap items-center justify-between gap-4 mb-6">
        <div>
          <h1 className="text-2xl font-bold text-white flex items-center gap-3">
            <Activity className="w-7 h-7 text-blue-400" />
            3DC RPO Monitor
          </h1>
        </div>

        <div className="flex items-center gap-3">
          {/* Stale warning */}
          {staleData && (
            <div className="flex items-center gap-2 px-3 py-1.5 bg-yellow-500/10 border border-yellow-500/30 rounded-lg">
              <AlertTriangle className="w-4 h-4 text-yellow-500" />
              <span className="text-xs text-yellow-400">Veri guncel degil</span>
            </div>
          )}

          {/* Last refresh */}
          {lastRefresh && (
            <div className="flex items-center gap-2 text-xs text-slate-400">
              <Clock className="w-3.5 h-3.5" />
              {formatTimestamp(lastRefresh)}
            </div>
          )}

          {/* Auto-refresh control */}
          <div className="flex items-center gap-2">
            <button
              onClick={() => setAutoRefresh(!autoRefresh)}
              className={`p-1.5 rounded-lg transition-colors ${
                autoRefresh
                  ? 'bg-green-500/20 text-green-400'
                  : 'bg-slate-700 text-slate-400'
              }`}
              title={autoRefresh ? 'Otomatik yenileme acik' : 'Otomatik yenileme kapali'}
            >
              {autoRefresh ? <Play className="w-4 h-4" /> : <Pause className="w-4 h-4" />}
            </button>
            <select
              value={refreshInterval}
              onChange={(e) => setRefreshInterval(Number(e.target.value))}
              className="bg-slate-700 border border-slate-600 text-slate-300 text-xs rounded-lg px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              {REFRESH_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </div>

          {/* Manual refresh */}
          <button
            onClick={handleManualRefresh}
            disabled={refreshing}
            className="flex items-center gap-2 px-3 py-1.5 bg-blue-600 hover:bg-blue-700 disabled:bg-blue-800 text-white text-sm rounded-lg transition-colors"
          >
            <RefreshCw className={`w-4 h-4 ${refreshing ? 'animate-spin' : ''}`} />
            Simdi Yenile
          </button>
        </div>
      </div>

      {/* Active alerts summary */}
      {alerts.length > 0 && (
        <div className="mb-6 p-4 bg-red-500/10 border border-red-500/30 rounded-xl">
          <div className="flex items-center gap-2 mb-2">
            <AlertTriangle className="w-5 h-5 text-red-400" />
            <span className="text-red-400 font-medium">
              {alerts.length} Aktif Uyari
            </span>
          </div>
          <div className="space-y-1">
            {alerts.slice(0, 5).map((alert, idx) => (
              <p key={idx} className="text-sm text-red-300">
                {alert.message}
              </p>
            ))}
            {alerts.length > 5 && (
              <p className="text-xs text-red-400 mt-1">
                ve {alerts.length - 5} uyari daha...
              </p>
            )}
          </div>
        </div>
      )}

      {/* Empty state */}
      {groups.length === 0 && (
        <div className="text-center py-20">
          <Database className="w-16 h-16 text-slate-600 mx-auto mb-4" />
          <h2 className="text-xl font-semibold text-slate-400 mb-2">
            Izlenen Grup Yok
          </h2>
          <p className="text-slate-500 mb-4">
            Henuz izleme icin yapilandirilmis tutarlilik grubu bulunmuyor.
          </p>
          <a
            href="/setup"
            className="inline-flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition-colors"
          >
            Kuruluma Git
          </a>
        </div>
      )}

      {/* Group cards */}
      <div className="space-y-6">
        {groups.map((group) => (
          <GroupCard key={group.id} group={group} />
        ))}
      </div>
    </div>
  );
}

// --- Group Card ---
function GroupCard({ group }) {
  const [expanded, setExpanded] = useState(false);
  const [timeRange, setTimeRange] = useState('24h');
  const [trendData, setTrendData] = useState([]);
  const [volumes, setVolumes] = useState([]);
  const [volumesLoading, setVolumesLoading] = useState(false);
  const [trendDirection, setTrendDirection] = useState(null);

  const latestRpo = group.latest_rpo || {};
  const journalStatusCode = latestRpo.journal_status || '';
  const journalStatus = JOURNAL_STATUS_MAP[journalStatusCode] || {
    label: journalStatusCode || 'Bilinmiyor',
    color: 'gray',
  };

  const usageColor = getUsageRateColor(latestRpo.usage_rate || 0);

  // Fetch volumes when expanded
  useEffect(() => {
    if (!expanded) return;
    const fetchVolumes = async () => {
      setVolumesLoading(true);
      try {
        const res = await axios.get(`/api/monitoring/groups/${group.cg_id}/volumes`);
        setVolumes(res.data.volumes || []);
      } catch {
        setVolumes([]);
      } finally {
        setVolumesLoading(false);
      }
    };
    fetchVolumes();
  }, [expanded, group.cg_id]);

  // Fetch trend data and actual trend direction
  useEffect(() => {
    const fetchTrend = async () => {
      try {
        const [historyRes, detailRes] = await Promise.all([
          axios.get(`/api/monitoring/groups/${group.cg_id}/history?timeframe=${timeRange}`),
          axios.get(`/api/monitoring/groups/${group.cg_id}`).catch(() => null),
        ]);
        setTrendData(historyRes.data.history || []);
        if (detailRes?.data?.trend) {
          setTrendDirection(detailRes.data.trend);
        }
      } catch {
        setTrendData([]);
      }
    };
    fetchTrend();
  }, [group.cg_id, timeRange]);

  return (
    <div className="bg-slate-800 border border-slate-700 rounded-xl shadow-lg overflow-hidden">
      {/* Card header */}
      <div className="flex items-center justify-between px-6 py-4 border-b border-slate-700">
        <div className="flex items-center gap-3">
          <div
            className={`w-3 h-3 rounded-full ${
              journalStatus.color === 'green'
                ? 'bg-green-500'
                : journalStatus.color === 'yellow'
                ? 'bg-yellow-500'
                : journalStatus.color === 'orange'
                ? 'bg-orange-500'
                : journalStatus.color === 'red'
                ? 'bg-red-500 animate-pulse'
                : 'bg-gray-500'
            }`}
          />
          <h3 className="text-lg font-semibold text-white">
            Tutarlilik Grubu: {group.name || `CG-${group.cg_id}`}
          </h3>
          {group.source_storage_id && (
            <span className="text-xs bg-slate-700 text-slate-400 px-2 py-0.5 rounded">
              {group.source_storage_id}
            </span>
          )}
        </div>
        <div className="flex items-center gap-3">
          <span
            className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-medium border ${getStatusBg(
              journalStatus.color
            )} ${getStatusColor(journalStatus.color)}`}
          >
            <Circle className="w-2 h-2 fill-current" />
            {journalStatusCode || '—'} - {journalStatus.label}
          </span>
        </div>
      </div>

      {/* Card body */}
      <div className="px-6 py-5">
        {/* Two methods side by side */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-5">
          {/* Method 1: Journal RPO */}
          <div className="bg-slate-900/50 border border-slate-700 rounded-lg p-4">
            <div className="flex items-center gap-2 mb-3">
              <Timer className="w-4 h-4 text-blue-400" />
              <h4 className="text-sm font-medium text-blue-400">
                Yontem 1: Journal RPO
              </h4>
            </div>
            <div className="space-y-3">
              {/* Pending data */}
              <div className="flex items-center justify-between">
                <span className="text-xs text-slate-400">Bekleyen Veri</span>
                <span
                  className={`text-sm font-semibold ${getStatusColor(usageColor)}`}
                >
                  {formatBytes(latestRpo.pending_data_bytes || 0)}
                </span>
              </div>
              {/* Estimated time */}
              <div className="flex items-center justify-between">
                <span className="text-xs text-slate-400">Tahmini Sure</span>
                <span className="text-sm font-semibold text-white">
                  ~{latestRpo.estimated_rpo_seconds
                    ? formatTime(latestRpo.estimated_rpo_seconds)
                    : '-'}
                </span>
              </div>
              {/* qCount */}
              <div className="flex items-center justify-between">
                <span className="text-xs text-slate-400">qCount</span>
                <span className="text-sm font-mono text-white">
                  {formatNumber(latestRpo.q_count)}
                </span>
              </div>
              {/* Usage Rate */}
              <div className="flex items-center justify-between">
                <span className="text-xs text-slate-400">Kullanim Orani</span>
                <div className="flex items-center gap-2">
                  <div className="w-20 h-2 bg-slate-700 rounded-full overflow-hidden">
                    <div
                      className={`h-full rounded-full ${
                        usageColor === 'green'
                          ? 'bg-green-500'
                          : usageColor === 'yellow'
                          ? 'bg-yellow-500'
                          : 'bg-red-500'
                      }`}
                      style={{ width: `${Math.min(100, latestRpo.usage_rate || 0)}%` }}
                    />
                  </div>
                  <span
                    className={`text-xs font-mono ${getStatusColor(usageColor)}`}
                  >
                    %{latestRpo.usage_rate ?? 0}
                  </span>
                </div>
              </div>
              {/* Trend */}
              <div className="flex items-center justify-between">
                <span className="text-xs text-slate-400">Trend</span>
                <div className="flex items-center gap-1.5">
                  {getTrendIcon(trendDirection || 'stable')}
                  <span className="text-xs text-slate-300">
                    {getTrendLabel(trendDirection || 'stable')}
                  </span>
                </div>
              </div>
              {/* qMarker */}
              {/* qMarker Delta - reserved for future use */}
            </div>
          </div>

          {/* Method 2: Block Allocation Delta */}
          <div className="bg-slate-900/50 border border-slate-700 rounded-lg p-4">
            <div className="flex items-center gap-2 mb-3">
              <HardDrive className="w-4 h-4 text-indigo-400" />
              <h4 className="text-sm font-medium text-indigo-400">
                Yontem 2: Blok Tahsis Farki
              </h4>
            </div>
            <div className="space-y-3">
              {/* Block delta */}
              <div className="flex items-center justify-between">
                <span className="text-xs text-slate-400">Blok Farki</span>
                <span className="text-sm font-semibold text-white">
                  {formatBytes(latestRpo.block_delta_bytes || 0)}
                </span>
              </div>
              {/* Block count */}
              <div className="flex items-center justify-between">
                <span className="text-xs text-slate-400">Blok Sayisi Farki</span>
                <span className="text-sm font-mono text-white">
                  {formatNumber(null)}
                </span>
              </div>
            </div>
            {/* Supplementary warning */}
            <div className="mt-4 flex items-start gap-2 p-2 bg-slate-800 border border-slate-700 rounded-lg">
              <Info className="w-4 h-4 text-slate-500 mt-0.5 flex-shrink-0" />
              <p className="text-xs text-slate-500 leading-relaxed">
                Bu yontem yalnizca yeni blok tahsislerini (yeni alan) tespit eder.
                Mevcut bloklara yapilan uzerine yazma islemlerini gostermez.
                Tamamlayici bilgi olarak kullanin.
              </p>
            </div>
          </div>
        </div>

        {/* Trend chart */}
        <div className="bg-slate-900/50 border border-slate-700 rounded-lg p-4 mb-4">
          <div className="flex items-center justify-between mb-3">
            <h4 className="text-sm font-medium text-slate-300">
              RPO Trend Grafigi
            </h4>
            <div className="flex gap-1">
              {['1h', '6h', '24h', '7d'].map((range) => (
                <button
                  key={range}
                  onClick={() => setTimeRange(range)}
                  className={`px-2 py-1 text-xs rounded transition-colors ${
                    timeRange === range
                      ? 'bg-blue-600 text-white'
                      : 'bg-slate-700 text-slate-400 hover:text-white'
                  }`}
                >
                  {range}
                </button>
              ))}
            </div>
          </div>
          {trendData.length > 0 ? (
            <ResponsiveContainer width="100%" height={180}>
              <AreaChart data={trendData}>
                <defs>
                  <linearGradient id={`gradient-${group.id}`} x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#3b82f6" stopOpacity={0.3} />
                    <stop offset="100%" stopColor="#3b82f6" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
                <XAxis
                  dataKey="timestamp"
                  tickFormatter={formatChartTime}
                  stroke="#64748b"
                  fontSize={10}
                />
                <YAxis stroke="#64748b" fontSize={10} />
                <Tooltip
                  contentStyle={{
                    backgroundColor: '#1e293b',
                    border: '1px solid #475569',
                    borderRadius: '8px',
                    color: '#e2e8f0',
                    fontSize: '12px',
                  }}
                  labelFormatter={formatTimestamp}
                />
                <Area
                  type="monotone"
                  dataKey="usageRate"
                  stroke="#3b82f6"
                  fill={`url(#gradient-${group.id})`}
                  strokeWidth={2}
                  name="Kullanim Orani (%)"
                />
              </AreaChart>
            </ResponsiveContainer>
          ) : (
            <div className="flex items-center justify-center h-[180px] text-slate-500 text-sm">
              Trend verisi henuz mevcut degil
            </div>
          )}
        </div>

        {/* Expandable volume list */}
        <button
          onClick={() => setExpanded(!expanded)}
          className="flex items-center gap-2 w-full text-left px-3 py-2 bg-slate-700/30 hover:bg-slate-700/50 rounded-lg transition-colors"
        >
          {expanded ? (
            <ChevronUp className="w-4 h-4 text-slate-400" />
          ) : (
            <ChevronDown className="w-4 h-4 text-slate-400" />
          )}
          <span className="text-sm text-slate-300 font-medium">
            Hacimler ({group.volume_count || 0})
          </span>
        </button>

        {expanded && volumes.length > 0 && (
          <div className="mt-3 overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-700">
                  <th className="text-left py-2 px-3 text-xs font-medium text-slate-400 uppercase">
                    Journal:MU
                  </th>
                  <th className="text-center py-2 px-3 text-xs font-medium text-slate-400 uppercase">
                    &nbsp;
                  </th>
                  <th className="text-left py-2 px-3 text-xs font-medium text-slate-400 uppercase">
                    Journal Durumu
                  </th>
                  <th className="text-left py-2 px-3 text-xs font-medium text-slate-400 uppercase">
                    Cift Durumu
                  </th>
                  <th className="text-right py-2 px-3 text-xs font-medium text-slate-400 uppercase">
                    qCount
                  </th>
                  <th className="text-right py-2 px-3 text-xs font-medium text-slate-400 uppercase">
                    Blok Farki
                  </th>
                  <th className="text-right py-2 px-3 text-xs font-medium text-slate-400 uppercase">
                    Kullanim
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-700/50">
                {volumes.map((vol, idx) => {
                  const pairStatus = PAIR_STATUS_MAP[vol.pair_status] || {
                    label: vol.pair_status || '-',
                    color: 'gray',
                  };
                  return (
                    <tr
                      key={idx}
                      className="hover:bg-slate-700/20 transition-colors"
                    >
                      <td className="py-2 px-3 font-mono text-slate-300">
                        J{vol.journal_id}:{vol.mu_number}
                      </td>
                      <td className="py-2 px-3 text-center">
                        <ArrowRightLeft className="w-3.5 h-3.5 text-slate-500 mx-auto" />
                      </td>
                      <td className="py-2 px-3 font-mono text-slate-300">
                        {vol.journal_status || '-'}
                      </td>
                      <td className="py-2 px-3">
                        <span
                          className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs border ${getStatusBg(
                            pairStatus.color
                          )} ${getStatusColor(pairStatus.color)}`}
                        >
                          {pairStatus.label}
                        </span>
                      </td>
                      <td className="py-2 px-3 text-right font-mono text-slate-300">
                        {formatNumber(vol.q_count)}
                      </td>
                      <td className="py-2 px-3 text-right font-mono text-slate-300">
                        {vol.block_delta_bytes != null
                          ? formatBytes(vol.block_delta_bytes)
                          : '-'}
                      </td>
                      <td className="py-2 px-3 text-right">
                        <span className="text-xs text-slate-400">
                          %{vol.usage_rate ?? '-'}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
