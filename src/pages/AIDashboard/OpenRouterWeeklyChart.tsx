import { useId, useMemo, useRef, useState } from 'react';
import { Alert, Empty, Segmented, Space, Tag, Typography } from 'antd';
import type { OpenRouterWeeklyHistory } from './types';
import { weeklyChartGeometry, type WeeklyChartScale } from './openRouterWeeklyGeometry';
import './OpenRouterWeeklyChart.css';

const { Text, Link } = Typography;
const WIDTH = 1040;
const LEFT = 54;
const TOP = 18;
const PLOT_HEIGHT = 290;
const BOTTOM = TOP + PLOT_HEIGHT;
const tickLabel = (value: number) => value >= 1e15 ? `${value / 1e15}Qa` : `${value / 1e12}T`;

export default function OpenRouterWeeklyChart({ history, latestDate, error }: {
  history?: OpenRouterWeeklyHistory | null;
  latestDate?: string | null;
  error?: string | null;
}) {
  const [scale, setScale] = useState<WeeklyChartScale>('linear');
  const [activeIndex, setActiveIndex] = useState<number | null>(null);
  const refs = useRef<Array<SVGGElement | null>>([]);
  const patternId = useId();
  const chart = useMemo(() => history ? weeklyChartGeometry(history, scale) : null, [history, scale]);
  if (!history || !chart) return <Empty description={error || '暂无官网每周 Token 图表快照'} />;
  const selected = activeIndex === null ? null : history.weeks[activeIndex];
  const columnWidth = (WIDTH - LEFT - 6) / history.weeks.length;
  const labelEvery = Math.ceil(history.weeks.length / 9);
  const outdated = Boolean(latestDate && history.asOf < latestDate);
  return <div className="or-weekly">
    <div className="or-weekly-toolbar">
      <Space wrap size={8}>
        <Text type="secondary">{history.weeks.length} 周 · 按模型堆叠 · 数据截至 {history.asOf}（UTC）</Text>
        {outdated && <Tag color="warning">周图待更新</Tag>}
      </Space>
      <Segmented aria-label="每周 Token 图表刻度" options={[{ label: 'Linear', value: 'linear' }, { label: 'Log', value: 'log' }]}
        value={scale} onChange={(value) => setScale(value as WeeklyChartScale)} />
    </div>
    {(error || outdated) && <Alert type="warning" showIcon title={error || `榜单已更新至 ${latestDate}，周图仍为 ${history.asOf} 的官网快照。`} />}
    <div className="or-weekly-plot" onMouseLeave={() => setActiveIndex(null)}>
      <div className="or-weekly-scroll">
        <svg className="or-weekly-svg" viewBox={`0 0 ${WIDTH} 350`} role="group" aria-label={`OpenRouter ${history.weeks.length} 周模型 Token 用量，${scale === 'linear' ? '线性' : '对数'}刻度。可聚焦柱形并用左右箭头查看每周明细。`}>
          <defs><pattern id={patternId} width="8" height="8" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
            <rect width="8" height="8" fill="#526170" /><rect width="4" height="8" fill="#6b7988" />
          </pattern></defs>
          {chart.ticks.map((value) => <text key={value} x={LEFT - 12} y={TOP + (1 - chart.position(value)) * PLOT_HEIGHT + 4}
            textAnchor="end" className="or-weekly-axis">{tickLabel(value)}</text>)}
          {chart.columns.map((column, index) => {
            const week = history.weeks[index];
            const x = LEFT + index * columnWidth;
            const isActive = activeIndex === index;
            return <g key={week.startDate} ref={(element) => { refs.current[index] = element; }} role="button"
              tabIndex={index === (activeIndex ?? history.weeks.length - 1) ? 0 : -1}
              aria-label={`${week.startDate} 至 ${week.endDate}，实际用量约 ${week.totalDisplay}${week.partial ? '，本周未完结' : ''}${week.pace ? `，预计整周 ${week.pace.totalDisplay}` : ''}`}
              onMouseEnter={() => setActiveIndex(index)} onFocus={() => setActiveIndex(index)}
              onClick={() => setActiveIndex(index)} onBlur={() => setActiveIndex(null)}
              onKeyDown={(event) => {
                if (event.key === 'Escape') { setActiveIndex(null); return; }
                const next = event.key === 'ArrowRight' ? Math.min(index + 1, history.weeks.length - 1)
                  : event.key === 'ArrowLeft' ? Math.max(index - 1, 0) : event.key === 'Home' ? 0 : event.key === 'End' ? history.weeks.length - 1 : null;
                if (next !== null) { event.preventDefault(); refs.current[next]?.focus(); }
              }}>
              <rect x={x} y={TOP} width={columnWidth} height={PLOT_HEIGHT} fill="currentColor" opacity={isActive ? 0.07 : 0} />
              {column.segments.map((segment) => <rect key={segment.modelId} x={x + 1} width={Math.max(1, columnWidth - 2)}
                y={TOP + (1 - segment.top) * PLOT_HEIGHT} height={Math.max(0, segment.top - segment.bottom) * PLOT_HEIGHT} fill={segment.color} />)}
              {column.pace && <rect x={x + 1} width={Math.max(1, columnWidth - 2)} fill={`url(#${patternId})`}
                y={TOP + (1 - column.pace.top) * PLOT_HEIGHT} height={(column.pace.top - column.pace.bottom) * PLOT_HEIGHT} />}
              {index % labelEvery === 0 && <text x={x + columnWidth / 2} y={BOTTOM + 28} textAnchor={index === 0 ? 'start' : 'middle'}
                className="or-weekly-axis">{index === 0 ? `${week.startDate.slice(0, 4)}年` : ''}{Number(week.startDate.slice(5, 7))}月{Number(week.startDate.slice(8, 10))}日</text>}
            </g>;
          })}
        </svg>
      </div>
      {selected && <div className={`or-weekly-tooltip ${activeIndex! > history.weeks.length / 2 ? 'or-weekly-tooltip-left' : 'or-weekly-tooltip-right'}`} role="tooltip">
        <strong>{selected.startDate} — {selected.endDate}</strong>
        {selected.partial && <span className="or-weekly-partial">本周未完结 · 截至 {history.asOf}</span>}
        <div className="or-weekly-total"><span>实际总量（约）</span><strong>{selected.totalDisplay}</strong></div>
        {selected.segments.map((segment) => {
          const model = history.models.find((item) => item.id === segment.modelId)!;
          return <div className="or-weekly-tooltip-row" key={segment.modelId}>
            <i style={{ backgroundColor: model.color }} /><span>{model.name}</span><b>{segment.display}</b>
          </div>;
        })}
        {selected.pace && <div className="or-weekly-pace"><span>预计整周（Weekly Pace）</span><strong>{selected.pace.totalDisplay}（+{selected.pace.additionalDisplay}）</strong></div>}
      </div>}
    </div>
    <div className="or-weekly-caption">
      <Text type="secondary">每柱为周一至周日，含 Others；斜纹为未完结周的预计增量。数值为官网显示约数，与下方滚动七天榜单的窗口不同。</Text>
      <Text type="secondary"><Link href={history.sourceUrl} target="_blank" rel="noreferrer">OpenRouter 官网图表 ↗</Link> · 网页快照采集于 {history.capturedAt.slice(0, 10)} · CC BY 4.0</Text>
    </div>
  </div>;
}
