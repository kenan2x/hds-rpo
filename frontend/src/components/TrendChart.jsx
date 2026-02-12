import React from 'react';
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Line,
  ComposedChart,
} from 'recharts';
import { formatChartTime, formatNumber, formatDuration } from '../utils/formatters';

/**
 * Timeframe options with Turkish labels.
 */
const TIMEFRAMES = [
  { key: '1h', label: '1s' },
  { key: '6h', label: '6s' },
  { key: '24h', label: '24s' },
  { key: '7d', label: '7g' },
];

/**
 * Custom tooltip for the trend chart.
 */
function ChartTooltip({ active, payload, label, timeframe }) {
  if (!active || !payload || payload.length === 0) return null;

  const data = payload[0]?.payload;
  if (!data) return null;

  const time = formatChartTime(label, timeframe);

  return (
    <div className="bg-slate-800 border border-slate-600 rounded-lg px-3 py-2 shadow-xl text-xs">
      <p className="text-slate-300 font-medium mb-1">{time}</p>
      <div className="space-y-0.5">
        {data.usageRate != null && (
          <p className="text-blue-400">
            Kullanim: <span className="font-mono">%{data.usageRate}</span>
          </p>
        )}
        {data.qCount != null && (
          <p className="text-emerald-400">
            qCount: <span className="font-mono">{formatNumber(data.qCount)}</span>
          </p>
        )}
        {data.estimatedRpoSeconds != null && (
          <p className="text-slate-300">
            Tahmini RPO: <span className="font-mono">{formatDuration(data.estimatedRpoSeconds)}</span>
          </p>
        )}
      </div>
    </div>
  );
}

/**
 * TrendChart - Historical RPO trend chart with timeframe selector.
 *
 * @param {Object} props
 * @param {Array<{
 *   timestamp: string|number,
 *   usageRate: number,
 *   qCount: number,
 *   pendingDataBytes: number,
 *   estimatedRpoSeconds: number
 * }>} props.data
 * @param {'1h'|'6h'|'24h'|'7d'} props.timeframe - Selected timeframe
 * @param {(tf: string) => void} props.onTimeframeChange
 * @param {number} [props.height] - Chart height (default 80)
 */
export default function TrendChart({
  data = [],
  timeframe = '24h',
  onTimeframeChange,
  height = 80,
}) {
  const hasData = data && data.length > 0;

  return (
    <div className="w-full">
      {/* Timeframe selector */}
      <div className="flex items-center justify-between mb-2">
        <span className="text-xs text-slate-500 uppercase tracking-wider font-medium">
          RPO Trendi
        </span>
        <div className="flex gap-1">
          {TIMEFRAMES.map((tf) => (
            <button
              key={tf.key}
              onClick={() => onTimeframeChange?.(tf.key)}
              className={`px-2 py-0.5 text-xs rounded font-medium transition-colors ${
                timeframe === tf.key
                  ? 'bg-blue-600 text-white'
                  : 'bg-slate-700/50 text-slate-400 hover:bg-slate-700 hover:text-slate-300'
              }`}
            >
              {tf.label}
            </button>
          ))}
        </div>
      </div>

      {/* Chart */}
      {hasData ? (
        <ResponsiveContainer width="100%" height={height}>
          <ComposedChart
            data={data}
            margin={{ top: 4, right: 4, left: -20, bottom: 0 }}
          >
            <defs>
              <linearGradient id="usageGradient" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="#60A5FA" stopOpacity={0.3} />
                <stop offset="95%" stopColor="#60A5FA" stopOpacity={0} />
              </linearGradient>
              <linearGradient id="qCountGradient" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="#34D399" stopOpacity={0.15} />
                <stop offset="95%" stopColor="#34D399" stopOpacity={0} />
              </linearGradient>
            </defs>

            <CartesianGrid
              strokeDasharray="3 3"
              stroke="#334155"
              vertical={false}
            />

            <XAxis
              dataKey="timestamp"
              tickFormatter={(ts) => formatChartTime(ts, timeframe)}
              tick={{ fill: '#64748B', fontSize: 10 }}
              axisLine={{ stroke: '#334155' }}
              tickLine={false}
              minTickGap={40}
            />

            {/* Left Y-axis: usageRate % */}
            <YAxis
              yAxisId="left"
              tick={{ fill: '#64748B', fontSize: 10 }}
              axisLine={false}
              tickLine={false}
              domain={[0, 'auto']}
              tickFormatter={(v) => `%${v}`}
            />

            {/* Right Y-axis: qCount */}
            <YAxis
              yAxisId="right"
              orientation="right"
              tick={{ fill: '#64748B', fontSize: 10 }}
              axisLine={false}
              tickLine={false}
              domain={[0, 'auto']}
              tickFormatter={(v) => {
                if (v >= 1000000) return `${(v / 1000000).toFixed(1)}M`;
                if (v >= 1000) return `${(v / 1000).toFixed(0)}K`;
                return v;
              }}
              width={40}
            />

            <Tooltip
              content={<ChartTooltip timeframe={timeframe} />}
              cursor={{ stroke: '#475569', strokeDasharray: '3 3' }}
            />

            {/* usageRate area */}
            <Area
              yAxisId="left"
              type="monotone"
              dataKey="usageRate"
              stroke="#60A5FA"
              strokeWidth={1.5}
              fill="url(#usageGradient)"
              dot={false}
              activeDot={{ r: 3, fill: '#60A5FA', stroke: '#1E293B', strokeWidth: 2 }}
            />

            {/* qCount line */}
            <Line
              yAxisId="right"
              type="monotone"
              dataKey="qCount"
              stroke="#34D399"
              strokeWidth={1}
              strokeDasharray="4 2"
              dot={false}
              activeDot={{ r: 3, fill: '#34D399', stroke: '#1E293B', strokeWidth: 2 }}
            />
          </ComposedChart>
        </ResponsiveContainer>
      ) : (
        <div
          className="flex items-center justify-center bg-slate-800/30 rounded border border-dashed border-slate-700"
          style={{ height }}
        >
          <span className="text-xs text-slate-600">Henuz veri yok</span>
        </div>
      )}
    </div>
  );
}
