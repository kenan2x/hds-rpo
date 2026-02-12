import React from 'react';
import { formatDurationShort } from '../utils/formatters';

/**
 * RpoGauge - SVG semicircular gauge showing usageRate percentage and estimated RPO time.
 *
 * @param {Object} props
 * @param {number} props.usageRate - Journal usage rate percentage (0-100)
 * @param {number} props.estimatedSeconds - Estimated RPO in seconds
 * @param {{ green: number, yellow: number, red: number }} [props.thresholds] - Threshold breakpoints
 */
export default function RpoGauge({
  usageRate = 0,
  estimatedSeconds = 0,
  thresholds = { green: 5, yellow: 20, red: 50 },
}) {
  const rate = Math.min(Math.max(usageRate || 0, 0), 100);

  // Determine color based on thresholds
  let strokeColor, glowColor, textColor;
  if (rate < thresholds.green) {
    strokeColor = '#22C55E'; // green-500
    glowColor = 'rgba(34, 197, 94, 0.3)';
    textColor = 'text-green-400';
  } else if (rate < thresholds.yellow) {
    strokeColor = '#EAB308'; // yellow-500
    glowColor = 'rgba(234, 179, 8, 0.3)';
    textColor = 'text-yellow-400';
  } else if (rate < thresholds.red) {
    strokeColor = '#F97316'; // orange-500
    glowColor = 'rgba(249, 115, 22, 0.3)';
    textColor = 'text-orange-400';
  } else {
    strokeColor = '#EF4444'; // red-500
    glowColor = 'rgba(239, 68, 68, 0.3)';
    textColor = 'text-red-400';
  }

  // SVG semicircle arc parameters
  const size = 80;
  const cx = size / 2;
  const cy = size / 2 + 4;
  const radius = 30;
  const strokeWidth = 6;

  // Arc from 180deg to 0deg (semicircle, top half)
  const startAngle = Math.PI; // left
  const endAngle = 0; // right
  const totalArc = Math.PI; // 180 degrees

  // Background arc path (full semicircle)
  const bgArcEnd = endAngle;
  const bgX1 = cx + radius * Math.cos(startAngle);
  const bgY1 = cy - radius * Math.sin(startAngle);
  const bgX2 = cx + radius * Math.cos(bgArcEnd);
  const bgY2 = cy - radius * Math.sin(bgArcEnd);

  const bgPath = `M ${bgX1} ${bgY1} A ${radius} ${radius} 0 0 1 ${bgX2} ${bgY2}`;

  // Value arc path
  const valueAngle = startAngle - (rate / 100) * totalArc;
  const vX2 = cx + radius * Math.cos(valueAngle);
  const vY2 = cy - radius * Math.sin(valueAngle);
  const largeArc = rate > 50 ? 1 : 0;

  const valuePath =
    rate > 0
      ? `M ${bgX1} ${bgY1} A ${radius} ${radius} 0 ${largeArc} 1 ${vX2} ${vY2}`
      : '';

  const rpoText = formatDurationShort(estimatedSeconds);

  return (
    <div className="flex flex-col items-center">
      <svg
        width={size}
        height={size / 2 + 16}
        viewBox={`0 0 ${size} ${size / 2 + 16}`}
        className="overflow-visible"
      >
        {/* Glow filter */}
        <defs>
          <filter id="gaugeGlow" x="-20%" y="-20%" width="140%" height="140%">
            <feGaussianBlur stdDeviation="2" result="blur" />
            <feMerge>
              <feMergeNode in="blur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>

        {/* Background track */}
        <path
          d={bgPath}
          fill="none"
          stroke="#334155"
          strokeWidth={strokeWidth}
          strokeLinecap="round"
        />

        {/* Value arc */}
        {rate > 0 && (
          <path
            d={valuePath}
            fill="none"
            stroke={strokeColor}
            strokeWidth={strokeWidth}
            strokeLinecap="round"
            filter="url(#gaugeGlow)"
            style={{ filter: `drop-shadow(0 0 4px ${glowColor})` }}
          />
        )}

        {/* Percentage text */}
        <text
          x={cx}
          y={cy - 6}
          textAnchor="middle"
          className={`text-sm font-bold fill-current ${textColor}`}
          style={{ fill: strokeColor, fontSize: '13px', fontWeight: 700 }}
        >
          %{rate}
        </text>

        {/* RPO time text */}
        <text
          x={cx}
          y={cy + 8}
          textAnchor="middle"
          className="fill-slate-400"
          style={{ fill: '#94a3b8', fontSize: '9px' }}
        >
          {rpoText}
        </text>
      </svg>
    </div>
  );
}
