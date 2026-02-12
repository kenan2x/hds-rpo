import React from 'react';
import StatusBadge from './StatusBadge';
import { formatNumber, formatBytes } from '../utils/formatters';

/**
 * VolumeTable - Compact table showing volume-level detail within a consistency group card.
 *
 * @param {Object} props
 * @param {Array<{
 *   pvolLdevId: number,
 *   svolLdevId: number,
 *   pairStatus: string,
 *   journalStatus: string,
 *   qCount: number,
 *   copyProgressRate: number|null,
 *   blockDelta: number
 * }>} props.volumes
 */
export default function VolumeTable({ volumes = [] }) {
  if (!volumes || volumes.length === 0) {
    return (
      <div className="text-sm text-slate-500 py-3 text-center">
        Bu grupta volume bulunamadi.
      </div>
    );
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="text-slate-400 text-xs uppercase tracking-wider border-b border-slate-700">
            <th className="text-left py-2 pr-3 font-medium">P-VOL</th>
            <th className="text-left py-2 pr-3 font-medium">S-VOL</th>
            <th className="text-left py-2 pr-3 font-medium">Durum</th>
            <th className="text-right py-2 pr-3 font-medium">qCount</th>
            <th className="text-right py-2 font-medium">Blok Farki</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-700/50">
          {volumes.map((vol, index) => (
            <tr
              key={`${vol.pvolLdevId}-${vol.svolLdevId}`}
              className={`${
                index % 2 === 0 ? 'bg-slate-800' : 'bg-slate-800/60'
              } hover:bg-slate-700/40 transition-colors`}
            >
              {/* P-VOL LDEV */}
              <td className="py-2 pr-3 text-slate-200 font-mono text-xs">
                {vol.pvolLdevId != null ? vol.pvolLdevId : '—'}
              </td>

              {/* S-VOL LDEV */}
              <td className="py-2 pr-3 text-slate-200 font-mono text-xs">
                <span className="text-slate-500 mr-1">&rarr;</span>
                {vol.svolLdevId != null ? vol.svolLdevId : '—'}
              </td>

              {/* Pair Status */}
              <td className="py-2 pr-3">
                <div className="flex items-center gap-2">
                  <StatusBadge status={vol.pairStatus} type="pair" />
                  {vol.pairStatus === 'COPY' && vol.copyProgressRate != null && (
                    <div className="flex items-center gap-1.5 min-w-[80px]">
                      <div className="flex-1 h-1.5 bg-slate-700 rounded-full overflow-hidden">
                        <div
                          className="h-full bg-blue-500 rounded-full transition-all duration-500"
                          style={{ width: `${Math.min(vol.copyProgressRate, 100)}%` }}
                        />
                      </div>
                      <span className="text-xs text-blue-400 font-mono whitespace-nowrap">
                        %{vol.copyProgressRate}
                      </span>
                    </div>
                  )}
                </div>
              </td>

              {/* qCount */}
              <td className="py-2 pr-3 text-right text-slate-300 font-mono text-xs">
                {vol.qCount != null ? formatNumber(vol.qCount) : '—'}
              </td>

              {/* Block Delta */}
              <td className="py-2 text-right text-slate-300 text-xs">
                {vol.blockDelta != null ? formatBytes(vol.blockDelta) : '—'}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
