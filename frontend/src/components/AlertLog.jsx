import React, { useState } from 'react';
import {
  AlertTriangle,
  AlertCircle,
  Info,
  Check,
  ChevronDown,
  ChevronUp,
} from 'lucide-react';
import { formatTimestamp, getAlertSeverityColor } from '../utils/formatters';

/**
 * Severity → icon component mapping.
 */
const SEVERITY_ICONS = {
  critical: AlertCircle,
  warning: AlertTriangle,
  info: Info,
};

/**
 * AlertItem - Single alert row.
 */
function AlertItem({ alert, onAcknowledge }) {
  const colors = getAlertSeverityColor(alert.severity);
  const IconComponent = SEVERITY_ICONS[alert.severity] || Info;

  return (
    <div
      className={`flex items-start gap-3 px-3 py-2.5 border-l-2 ${colors.border} ${colors.bg} rounded-r transition-colors`}
    >
      {/* Severity icon */}
      <div className={`mt-0.5 flex-shrink-0 ${colors.text}`}>
        <IconComponent size={14} />
      </div>

      {/* Content */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 mb-0.5">
          <span className="text-xs text-slate-500 font-mono">
            {formatTimestamp(alert.timestamp)}
          </span>
          {alert.groupName && (
            <span className="text-xs text-slate-400 font-medium truncate">
              {alert.groupName}
            </span>
          )}
        </div>
        <p className="text-sm text-slate-300 leading-snug">{alert.message}</p>
      </div>

      {/* Acknowledge button */}
      {!alert.acknowledged && onAcknowledge && (
        <button
          onClick={() => onAcknowledge(alert.id)}
          className="flex-shrink-0 flex items-center gap-1 px-2 py-1 text-xs rounded
                     bg-slate-700/60 text-slate-400 hover:bg-slate-600 hover:text-slate-200
                     transition-colors"
          title="Onayla"
        >
          <Check size={12} />
          <span>Onayla</span>
        </button>
      )}

      {alert.acknowledged && (
        <span className="flex-shrink-0 text-xs text-slate-600 flex items-center gap-1">
          <Check size={12} />
          Onaylandi
        </span>
      )}
    </div>
  );
}

/**
 * AlertLog - Expandable alert history panel.
 *
 * @param {Object} props
 * @param {Array<{
 *   id: string|number,
 *   timestamp: string,
 *   severity: 'info'|'warning'|'critical',
 *   groupName: string,
 *   message: string,
 *   acknowledged: boolean
 * }>} props.alerts
 * @param {(id: string|number) => void} props.onAcknowledge
 * @param {() => void} [props.onViewAll]
 */
export default function AlertLog({ alerts = [], onAcknowledge, onViewAll }) {
  const [expanded, setExpanded] = useState(true);

  const displayAlerts = alerts.slice(0, 20);
  const hasMore = alerts.length > 20;

  // Count unacknowledged
  const unacknowledgedCount = alerts.filter((a) => !a.acknowledged).length;

  // Count by severity
  const criticalCount = alerts.filter((a) => a.severity === 'critical' && !a.acknowledged).length;
  const warningCount = alerts.filter((a) => a.severity === 'warning' && !a.acknowledged).length;

  return (
    <div className="bg-slate-800 rounded-xl border border-slate-700 shadow-lg overflow-hidden">
      {/* Header - always visible */}
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center justify-between px-4 py-3 hover:bg-slate-750
                   transition-colors text-left"
      >
        <div className="flex items-center gap-3">
          <AlertTriangle size={16} className="text-slate-400" />
          <span className="text-sm font-medium text-slate-200">
            Uyarilar
          </span>

          {/* Badge counts */}
          {unacknowledgedCount > 0 && (
            <div className="flex items-center gap-1.5">
              {criticalCount > 0 && (
                <span className="inline-flex items-center rounded-full px-1.5 py-0.5 text-xs font-medium bg-red-500/10 text-red-400">
                  {criticalCount}
                </span>
              )}
              {warningCount > 0 && (
                <span className="inline-flex items-center rounded-full px-1.5 py-0.5 text-xs font-medium bg-yellow-500/10 text-yellow-400">
                  {warningCount}
                </span>
              )}
            </div>
          )}
        </div>

        <div className="flex items-center gap-2">
          {!expanded && unacknowledgedCount > 0 && (
            <span className="text-xs text-slate-500">
              {unacknowledgedCount} yeni
            </span>
          )}
          {expanded ? (
            <ChevronUp size={16} className="text-slate-500" />
          ) : (
            <ChevronDown size={16} className="text-slate-500" />
          )}
        </div>
      </button>

      {/* Alert list - expandable */}
      {expanded && (
        <div className="border-t border-slate-700">
          {displayAlerts.length === 0 ? (
            <div className="px-4 py-6 text-center">
              <Info size={20} className="mx-auto mb-2 text-slate-600" />
              <p className="text-sm text-slate-500">Aktif uyari bulunmuyor</p>
            </div>
          ) : (
            <div className="divide-y divide-slate-700/30 p-2 space-y-1">
              {displayAlerts.map((alert) => (
                <AlertItem
                  key={alert.id}
                  alert={alert}
                  onAcknowledge={onAcknowledge}
                />
              ))}
            </div>
          )}

          {/* See all link */}
          {hasMore && (
            <div className="border-t border-slate-700 px-4 py-2">
              <button
                onClick={onViewAll}
                className="text-xs text-blue-400 hover:text-blue-300 transition-colors font-medium"
              >
                Tumunu Gor ({alerts.length} uyari)
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
