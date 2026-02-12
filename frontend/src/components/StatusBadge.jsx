import React from 'react';
import { getStatusColor, getStatusLabel } from '../utils/formatters';

/**
 * StatusBadge - Pill-shaped badge for journal or pair status.
 *
 * @param {Object} props
 * @param {string} props.status - Status code (e.g. "PJNN", "PAIR", "COPY")
 * @param {'journal'|'pair'} props.type - Whether this is a journal or pair status
 * @param {string} [props.className] - Additional classes
 */
export default function StatusBadge({ status, type = 'journal', className = '' }) {
  if (!status) {
    return (
      <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium bg-gray-500/20 text-gray-400 ${className}`}>
        —
      </span>
    );
  }

  const colors = getStatusColor(status, type);
  const label = getStatusLabel(status, type);

  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ${colors.bg} ${colors.text} ${className}`}
      title={label}
    >
      <span className={`inline-block w-1.5 h-1.5 rounded-full ${colors.text} bg-current`} />
      {status}
    </span>
  );
}
