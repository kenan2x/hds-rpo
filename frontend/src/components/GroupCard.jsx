import React, { useState } from 'react';
import {
  ChevronDown,
  ChevronRight,
  ArrowUp,
  ArrowDown,
  Minus,
  Info,
  Clock,
  Database,
  Layers,
} from 'lucide-react';
import StatusBadge from './StatusBadge';
import RpoGauge from './RpoGauge';
import VolumeTable from './VolumeTable';
import TrendChart from './TrendChart';
import {
  formatBytes,
  formatDuration,
  formatNumber,
  getTrendInfo,
  getUsageRateBorderColor,
  getStatusColorName,
} from '../utils/formatters';

/**
 * Trend icon selector.
 */
const TREND_ICONS = {
  'arrow-up': ArrowUp,
  'arrow-down': ArrowDown,
  minus: Minus,
};

/**
 * InfoTooltip - Small info icon with hover tooltip.
 */
function InfoTooltip({ text }) {
  const [show, setShow] = useState(false);

  return (
    <span
      className="relative inline-flex"
      onMouseEnter={() => setShow(true)}
      onMouseLeave={() => setShow(false)}
    >
      <Info size={12} className="text-slate-500 cursor-help" />
      {show && (
        <span className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 px-3 py-2 text-xs text-slate-200 bg-slate-700 border border-slate-600 rounded-lg shadow-xl whitespace-normal w-56 z-50 leading-relaxed">
          {text}
        </span>
      )}
    </span>
  );
}

/**
 * Determine worst status color from group and volumes for the card border.
 */
function getWorstStatusColor(group) {
  const severityOrder = { green: 0, blue: 1, yellow: 2, orange: 3, red: 4, gray: -1 };

  let worstColor = 'green';
  let worstSeverity = 0;

  // Check journal status
  const journalColor = getStatusColorName(group.journalStatus, 'journal');
  if ((severityOrder[journalColor] ?? -1) > worstSeverity) {
    worstColor = journalColor;
    worstSeverity = severityOrder[journalColor] ?? -1;
  }

  // Check each volume pair status
  if (group.volumes) {
    for (const vol of group.volumes) {
      const pairColor = getStatusColorName(vol.pairStatus, 'pair');
      if ((severityOrder[pairColor] ?? -1) > worstSeverity) {
        worstColor = pairColor;
        worstSeverity = severityOrder[pairColor] ?? -1;
      }
    }
  }

  return worstColor;
}

/**
 * Map color name to Tailwind border-left class.
 */
function getBorderLeftClass(colorName) {
  const map = {
    green: 'border-l-green-500',
    yellow: 'border-l-yellow-500',
    orange: 'border-l-orange-500',
    red: 'border-l-red-500',
    blue: 'border-l-blue-500',
    gray: 'border-l-slate-600',
  };
  return map[colorName] || 'border-l-slate-600';
}

/**
 * GroupCard - Consistency group card component.
 *
 * @param {Object} props
 * @param {{
 *   cgId: number,
 *   name: string,
 *   status: string,
 *   journalStatus: string,
 *   journalRpo: {
 *     pendingBytes: number,
 *     estimatedSeconds: number,
 *     usageRate: number,
 *     qCount: number,
 *     qMarkerDelta: number,
 *     copySpeedMbps: number
 *   },
 *   blockDelta: { totalBytes: number },
 *   volumes: Array,
 *   trend: {
 *     direction: 'increasing'|'decreasing'|'stable',
 *     data: Array<{ timestamp, usageRate, qCount, pendingDataBytes, estimatedRpoSeconds }>
 *   }
 * }} props.group
 * @param {{ green: number, yellow: number, red: number }} [props.thresholds]
 */
export default function GroupCard({
  group,
  thresholds = { green: 5, yellow: 20, red: 50 },
}) {
  const [volumesExpanded, setVolumesExpanded] = useState(false);
  const [trendTimeframe, setTrendTimeframe] = useState('24h');

  if (!group) return null;

  const {
    cgId,
    name,
    status,
    journalStatus,
    journalRpo = {},
    blockDelta = {},
    volumes = [],
    trend = {},
  } = group;

  const worstColor = getWorstStatusColor(group);
  const borderLeftClass = getBorderLeftClass(worstColor);
  const trendInfo = getTrendInfo(trend.direction);
  const TrendIconComponent = TREND_ICONS[trendInfo.icon] || Minus;

  return (
    <div
      className={`bg-slate-800 rounded-xl border border-slate-700 shadow-lg border-l-4 ${borderLeftClass} overflow-hidden`}
    >
      {/* Card Header */}
      <div className="px-4 pt-4 pb-3 flex items-center justify-between gap-3">
        <div className="flex items-center gap-3 min-w-0">
          <div className="flex-shrink-0 flex items-center justify-center w-8 h-8 rounded-lg bg-slate-700/60">
            <Layers size={16} className="text-slate-400" />
          </div>
          <div className="min-w-0">
            <h3 className="text-sm font-semibold text-slate-100 truncate">
              {name || `CG-${cgId}`}
            </h3>
            <div className="flex items-center gap-2 mt-0.5">
              <StatusBadge status={journalStatus} type="journal" />
              {status && (
                <span className="text-xs text-slate-500">{status}</span>
              )}
            </div>
          </div>
        </div>

        {/* Gauge in header */}
        <div className="flex-shrink-0">
          <RpoGauge
            usageRate={journalRpo.usageRate}
            estimatedSeconds={journalRpo.estimatedSeconds}
            thresholds={thresholds}
          />
        </div>
      </div>

      {/* RPO Data - Two columns */}
      <div className="px-4 pb-3 grid grid-cols-1 sm:grid-cols-2 gap-3">
        {/* Left: Journal RPO */}
        <div className="bg-slate-900/40 rounded-lg p-3 border border-slate-700/50">
          <div className="flex items-center gap-1.5 mb-2.5">
            <Database size={12} className="text-blue-400" />
            <h4 className="text-xs font-semibold text-blue-400 uppercase tracking-wider">
              Journal RPO
            </h4>
          </div>

          <div className="space-y-2">
            {/* Pending data */}
            <div className="flex items-center justify-between">
              <span className="text-xs text-slate-500">Bekleyen Veri</span>
              <span className="text-sm font-mono font-medium text-slate-200">
                {formatBytes(journalRpo.pendingBytes)}
              </span>
            </div>

            {/* Estimated time */}
            <div className="flex items-center justify-between">
              <span className="text-xs text-slate-500">Tahmini Sure</span>
              <span className="text-sm font-mono font-medium text-slate-200 flex items-center gap-1">
                <Clock size={12} className="text-slate-500" />
                {formatDuration(journalRpo.estimatedSeconds)}
              </span>
            </div>

            {/* qCount */}
            <div className="flex items-center justify-between">
              <span className="text-xs text-slate-500">qCount</span>
              <span className="text-sm font-mono font-medium text-slate-200">
                {formatNumber(journalRpo.qCount)}
              </span>
            </div>

            {/* Trend indicator */}
            <div className="flex items-center justify-between">
              <span className="text-xs text-slate-500">Trend</span>
              <span className={`text-sm font-medium flex items-center gap-1 ${trendInfo.color}`}>
                <TrendIconComponent size={14} />
                {trendInfo.label}
              </span>
            </div>
          </div>
        </div>

        {/* Right: Block Allocation Delta */}
        <div className="bg-slate-900/40 rounded-lg p-3 border border-slate-700/50">
          <div className="flex items-center gap-1.5 mb-2.5">
            <Layers size={12} className="text-slate-400" />
            <h4 className="text-xs font-semibold text-slate-400 uppercase tracking-wider">
              Blok Tahsis Farki
            </h4>
            <InfoTooltip
              text="Bu yontem yalnizca yeni blok tahsislerini (ilk yazma) tespit eder. Mevcut bloklara yapilan ustune-yazma islemlerini GOSTERMEZ. Ilk kopyalama ve yeni VM takibi icin uygundur."
            />
          </div>

          <div className="space-y-2">
            {/* Block delta */}
            <div className="flex items-center justify-between">
              <span className="text-xs text-slate-500">Toplam Fark</span>
              <span className="text-sm font-mono font-medium text-slate-200">
                {formatBytes(blockDelta.totalBytes)}
              </span>
            </div>

            {/* Supplementary label */}
            <div className="mt-2 p-2 bg-slate-800/60 rounded border border-dashed border-slate-700">
              <p className="text-xs text-slate-500 leading-relaxed">
                <span className="text-yellow-500/80 font-medium">Tamamlayici:</span>{' '}
                Sadece yeni alan tahsislerini olcer. Tam RPO icin Journal yontemini kullanin.
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* Trend Chart */}
      <div className="px-4 pb-3">
        <TrendChart
          data={trend.data || []}
          timeframe={trendTimeframe}
          onTimeframeChange={setTrendTimeframe}
          height={80}
        />
      </div>

      {/* Expandable Volumes Section */}
      <div className="border-t border-slate-700">
        <button
          onClick={() => setVolumesExpanded(!volumesExpanded)}
          className="w-full flex items-center justify-between px-4 py-2.5 hover:bg-slate-700/30 transition-colors text-left"
        >
          <div className="flex items-center gap-2">
            {volumesExpanded ? (
              <ChevronDown size={14} className="text-slate-500" />
            ) : (
              <ChevronRight size={14} className="text-slate-500" />
            )}
            <span className="text-xs font-medium text-slate-400">
              Volume&apos;ler
            </span>
            <span className="text-xs text-slate-600">
              ({volumes.length} adet)
            </span>
          </div>
        </button>

        {volumesExpanded && (
          <div className="px-4 pb-3">
            <VolumeTable volumes={volumes} />
          </div>
        )}
      </div>
    </div>
  );
}
