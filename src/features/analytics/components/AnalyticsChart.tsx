import { useState, useMemo } from 'react';
import type { DailyLearningRecord } from '../store/useAnalyticsStore';
import styles from './AnalyticsChart.module.css';

interface AnalyticsChartProps {
  data: DailyLearningRecord[];
  width?: number;
}

export function AnalyticsChart({ data, width = 280 }: AnalyticsChartProps) {
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);
  const [tooltipPos, setTooltipPos] = useState<{ x: number; y: number } | null>(null);

  const config = useMemo(() => {
    const padding = { top: 8, right: 8, bottom: 24, left: 8 };
    const chartWidth = width - padding.left - padding.right;
    const chartHeight = 120 - padding.top - padding.bottom;
    const maxValue = Math.max(...data.map((d) => d.count), 1);
    const stepX = chartWidth / Math.max(data.length - 1, 1);

    return { padding, chartWidth, chartHeight, maxValue, stepX };
  }, [data, width]);

  const points = useMemo(() => {
    return data.map((d, i) => ({
      x: config.padding.left + i * config.stepX,
      y: config.padding.top + config.chartHeight * (1 - d.count / config.maxValue),
      count: d.count,
      date: d.date,
    }));
  }, [data, config]);

  const pathD = useMemo(() => {
    if (points.length < 2) return '';
    return points
      .map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x} ${p.y}`)
      .join(' ');
  }, [points]);

  const areaD = useMemo(() => {
    if (points.length < 2) return '';
    const baseY = config.padding.top + config.chartHeight;
    const line = points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x} ${p.y}`).join(' ');
    const area = `L ${points[points.length - 1].x} ${baseY} L ${points[0].x} ${baseY} Z`;
    return `${line} ${area}`;
  }, [points, config]);

  const formatDate = (dateStr: string) => {
    const date = new Date(dateStr);
    return `${date.getMonth() + 1}/${date.getDate()}`;
  };

  const handleMouseMove = (index: number, event: React.MouseEvent<SVGGElement>) => {
    const rect = event.currentTarget.ownerSVGElement?.getBoundingClientRect();
    if (rect) {
      setTooltipPos({ x: event.clientX - rect.left, y: event.clientY - rect.top });
    }
    setHoveredIndex(index);
  };

  return (
    <div className={styles.chartContainer}>
      <svg
        viewBox={`0 0 ${width} 120`}
        className={styles.chart}
        style={{ width: '100%' }}
        role="img"
        aria-label="学习进度趋势图"
      >
        <title>学习进度图表</title>
        <desc>显示每日学习词汇数量的趋势图</desc>
        <defs>
          <linearGradient id="chartGradient" x1="0%" y1="0%" x2="0%" y2="100%">
            <stop offset="0%" stopColor="var(--color-analytics-accent)" stopOpacity="0.2" />
            <stop offset="100%" stopColor="var(--color-analytics-accent)" stopOpacity="0" />
          </linearGradient>
          <filter id="glow">
            <feGaussianBlur stdDeviation="2" result="coloredBlur" />
            <feMerge>
              <feMergeNode in="coloredBlur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>

        {data.length >= 7 && (
          <g className={styles.gridLines}>
            {[0.25, 0.5, 0.75].map((ratio) => (
              <line
                key={ratio}
                x1={config.padding.left}
                y1={config.padding.top + config.chartHeight * ratio}
                x2={width - config.padding.right}
                y2={config.padding.top + config.chartHeight * ratio}
                className={styles.gridLine}
              />
            ))}
          </g>
        )}

        {areaD && <path d={areaD} fill="url(#chartGradient)" className={styles.area} />}

        {pathD && (
          <path
            d={pathD}
            className={styles.line}
            filter="url(#glow)"
            vectorEffect="non-scaling-stroke"
          />
        )}

        {points.map((point, index) => (
          <g
            key={index}
            className={styles.pointGroup}
            onMouseMove={(e) => handleMouseMove(index, e)}
            onMouseLeave={() => {
              setHoveredIndex(null);
              setTooltipPos(null);
            }}
          >
            <circle
              cx={point.x}
              cy={point.y}
              r={hoveredIndex === index ? 5 : 3}
              className={styles.point}
              style={{
                opacity: hoveredIndex === index ? 1 : 0.6,
              }}
            />
          </g>
        ))}

        {data.length >= 5 &&
          data
            .filter((_, i) => i % Math.ceil(data.length / 5) === 0)
            .map((d) => {
              const point = points.find((p) => p.date === d.date);
              return (
                <text
                  key={d.date}
                  x={point?.x || 0}
                  y={config.padding.top + config.chartHeight + 18}
                  className={styles.label}
                  textAnchor="middle"
                >
                  {formatDate(d.date)}
                </text>
              );
            })}

        {hoveredIndex !== null && tooltipPos && (
          <g className={styles.tooltip}>
            <rect
              x={tooltipPos.x + 8}
              y={tooltipPos.y - 24}
              width={80}
              height={24}
              rx={4}
              className={styles.tooltipBg}
            />
            <text
              x={tooltipPos.x + 14}
              y={tooltipPos.y - 12}
              className={styles.tooltipDate}
            >
              {formatDate(data[hoveredIndex].date)}
            </text>
            <text
              x={tooltipPos.x + 14}
              y={tooltipPos.y - 4}
              className={styles.tooltipValue}
            >
              {data[hoveredIndex].count} 词汇
            </text>
          </g>
        )}
      </svg>
    </div>
  );
}