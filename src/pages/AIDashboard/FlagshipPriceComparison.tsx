import { useId, useRef } from 'react';
import { Button, Card, Collapse, Image, Space, Tag, Typography } from 'antd';
import {
  FLAGSHIP_PRICE_ROWS,
  FLAGSHIP_PRICE_SNAPSHOT,
  MUSE_WONDER_RELEASE,
  buildFlagshipPriceCsv,
  flagshipModelLabel,
  type FlagshipPriceValue,
  type FlagshipPriceRow,
} from './flagshipPriceSnapshot';
import './FlagshipPriceComparison.css';

const { Paragraph, Text } = Typography;
const WIDTH = 1280;
const TOP = 150;
const ROW_HEIGHT = 54;
const BOTTOM = TOP + FLAGSHIP_PRICE_ROWS.length * ROW_HEIGHT;
const HEIGHT = BOTTOM + 102;
const SCORE_LEFT = 382;
const SCORE_WIDTH = 248;
const PRICE_LEFT = 704;
const PRICE_WIDTH = 480;
const scorePosition = (score: number) => SCORE_LEFT + (score - 25) / 40 * SCORE_WIDTH;
const priceWidth = (price: number) => price / 50 * PRICE_WIDTH;
const SCORE_TICKS = [25, 30, 35, 40, 45, 50, 55, 60, 65];
const PRICE_TICKS = [0, 10, 20, 30, 40, 50];

function downloadFile(content: string, mimeType: string, filename: string) {
  const url = URL.createObjectURL(new Blob([content], { type: mimeType }));
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function exportChart(svg: SVGSVGElement | null) {
  if (!svg) return;
  const clone = svg.cloneNode(true) as SVGSVGElement;
  const originals = [svg, ...svg.querySelectorAll('*')];
  const copies = [clone, ...clone.querySelectorAll('*')];
  // Embed resolved styles so the downloaded SVG keeps the displayed theme without this site's CSS.
  const properties = ['color', 'fill', 'fill-opacity', 'stroke', 'stroke-opacity', 'stroke-width', 'stroke-dasharray', 'opacity', 'font-family', 'font-size', 'font-weight', 'letter-spacing'];
  originals.forEach((element, index) => {
    const style = getComputedStyle(element);
    const target = copies[index] as SVGElement;
    properties.forEach(property => target.style.setProperty(property, style.getPropertyValue(property)));
  });
  clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
  clone.setAttribute('width', String(WIDTH));
  clone.setAttribute('height', String(HEIGHT));
  downloadFile(`<?xml version="1.0" encoding="UTF-8"?>\n${new XMLSerializer().serializeToString(clone)}`, 'image/svg+xml;charset=utf-8', `旗舰模型API价格与智能指数-${FLAGSHIP_PRICE_SNAPSHOT.date}.svg`);
}

function PriceBar({ price, centerY, direction, suffix = '' }: {
  price: FlagshipPriceValue;
  centerY: number;
  direction: 'input' | 'output';
  suffix?: string;
}) {
  if (price.lower === null || price.upper === null) return null;
  const y = centerY + (direction === 'input' ? -18 : 5);
  const lowerWidth = priceWidth(price.lower);
  const upperWidth = priceWidth(price.upper);
  return <g className={`flagship-price-${direction}`}>
    {price.upper !== price.lower ? <rect x={PRICE_LEFT} y={y} width={upperWidth} height={14} className="flagship-price-upper" /> : null}
    <rect x={PRICE_LEFT} y={y} width={lowerWidth} height={14} className="flagship-price-solid" />
    <text x={PRICE_LEFT + upperWidth + 8} y={y + 12} className="flagship-price-value">
      {price.raw}{suffix}
    </text>
  </g>;
}

function ModelRow({ row, index }: { row: FlagshipPriceRow; index: number }) {
  const centerY = TOP + index * ROW_HEIGHT + ROW_HEIGHT / 2;
  const label = flagshipModelLabel(row);
  return <g className={row.highlighted ? 'flagship-price-row is-highlighted' : 'flagship-price-row'}>
    <title>{`${label}；AA 智能指数 ${row.scoreRaw}；输入价 ${row.input.raw || '未列示'}；输出价 ${row.output.raw || '未列示'}${row.note ? `；${row.note}` : ''}`}</title>
    {row.highlighted ? <rect x={12} y={centerY - ROW_HEIGHT / 2 + 2} width={WIDTH - 24} height={ROW_HEIGHT - 4} className="flagship-price-highlight" /> : null}
    <text x={24} y={centerY + 7} className="flagship-price-model">{label}</text>
    {row.score !== null ? <>
      <line x1={SCORE_LEFT} x2={scorePosition(row.score)} y1={centerY} y2={centerY} className="flagship-score-guide" />
      <rect x={scorePosition(row.score) - 22} y={centerY - 18} width={44} height={36} rx={14} className="flagship-score-pill" />
      <text x={scorePosition(row.score)} y={centerY + 7} textAnchor="middle" className="flagship-score-value">{row.scoreRaw}</text>
    </> : <>
      <rect x={504} y={centerY - 18} width={90} height={36} rx={14} className="flagship-score-missing" />
      <text x={549} y={centerY + 7} textAnchor="middle" className="flagship-score-missing-text">{row.scoreRaw}</text>
    </>}
    {row.input.lower === null && row.output.lower === null
      ? <text x={PRICE_LEFT + 8} y={centerY + 6} className="flagship-price-note">{row.note}</text>
      : <>
        <PriceBar price={row.input} centerY={centerY} direction="input" />
        <PriceBar price={row.output} centerY={centerY} direction="output" suffix={row.outputSuffix} />
        {row.note && !row.outputSuffix ? <text x={965} y={centerY + 6} className="flagship-price-note flagship-price-tier-note">{row.note}</text> : null}
      </>}
  </g>;
}

function MuseWonderRelease({ titleId }: { titleId: string }) {
  const maxTaskCost = Math.max(...MUSE_WONDER_RELEASE.taskCosts.map(row => row.usdPerTask));
  return <section className="muse-release" data-testid="muse-release-update" aria-labelledby={titleId}>
    <div className="muse-release-heading">
      <h3 id={titleId}>{MUSE_WONDER_RELEASE.title}</h3>
      <Tag color="blue">新增纪要</Tag>
    </div>
    <p className="muse-release-source">{MUSE_WONDER_RELEASE.sourceLabel} · 未经独立核实</p>
    <p className="muse-release-lead">据纪要，Meta 旗下超级智能实验室于 10 月 13 日凌晨发布基础版 Muse Wonder 及增强版 Muse Wonder Full。</p>
    <dl className="muse-release-pricing">
      <div>
        <dt>Muse Wonder 基础版 · API</dt>
        <dd className="muse-release-rate"><strong>${MUSE_WONDER_RELEASE.api.input}</strong> 输入 <span>/</span> <strong>${MUSE_WONDER_RELEASE.api.output}</strong> 输出</dd>
        <dd className="muse-release-small">单位：{MUSE_WONDER_RELEASE.api.unit}；与原图报价一致。</dd>
      </div>
      <div>
        <dt>Muse Wonder Full · Muse Code 订阅</dt>
        <dd className="muse-release-rate">{MUSE_WONDER_RELEASE.subscriptions.map((plan, index) => <span key={plan.monthlyUsd}>
          {index > 0 ? <span className="muse-release-plan-divider">或</span> : null}
          <strong>${plan.monthlyUsd}</strong> / 月 <small>（基础档 {plan.baselineUsageMultiplier}x 用量）</small>
        </span>)}</dd>
        <dd className="muse-release-small">向 Muse Code 订阅用户开放；纪要未列示 Full 的独立 API 报价。</dd>
      </div>
    </dl>
    <div className="muse-release-content">
      <div className="muse-release-report">
        <h4>纪要观点：长周期智能体与闭源策略</h4>
        <ul>
          <li><strong>Active Memory（主动记忆）：</strong>主动记录用户的重要信息与偏好。</li>
          <li><strong>Active Focus（主动专注）：</strong>持续处理疑难问题，遇到障碍时换方法，并在出错后检查。</li>
          <li><strong>性能与长周期项目：</strong>纪要称，两款模型在多个基准中可匹敌甚至超越 Claude Fable 5.1、GPT-6 Astra 和 Claude Opus 5.5，在长时间、长周期项目中领先于 Opus、Fable 和 Astra。</li>
          <li><strong>商业化方向：</strong>据纪要，Muse Wonder 不再开源，旗舰模型走向闭源；个人 Agent Muse 计划接入 Wonder。</li>
        </ul>
      </div>
      <figure className="muse-task-cost">
        <figcaption><strong>单任务成本</strong><span>美元 / 任务</span></figcaption>
        <ol aria-label="财通海外转引的五款模型单任务成本估算，单位美元每任务">
          {MUSE_WONDER_RELEASE.taskCosts.map(row => <li key={row.model} className={row.highlighted ? 'is-highlighted' : undefined}>
            <span className="muse-task-model">{row.model}</span>
            <span className="muse-task-track" aria-hidden="true"><span style={{ width: `${row.usdPerTask / maxTaskCost * 100}%` }} /></span>
            <strong>${row.usdPerTask.toFixed(2)}</strong>
          </li>)}
        </ol>
        <p className="muse-release-small">{MUSE_WONDER_RELEASE.taskCostSource}。该指标为单任务成本估算，与 API 的每百万 tokens 刊例价分别展示。</p>
      </figure>
    </div>
    <p className="muse-release-limit">本区为后续补充纪要；下方 29 个模型的原图分数与报价保持原值。纪要未提供具体评测任务集、配置与成本估算方法，性能判断和成本数据均按所供内容归属来源。</p>
  </section>;
}

export default function FlagshipPriceComparison() {
  const svgRef = useRef<SVGSVGElement>(null);
  const id = useId();
  const titleId = `${id}-title`;
  const descriptionId = `${id}-description`;
  return <Card
    className="ai-section-card flagship-price-comparison"
    id="flagship-api-price-comparison"
    title={FLAGSHIP_PRICE_SNAPSHOT.title}
    extra={<Space wrap size={8}>
      <Button size="small" onClick={() => downloadFile(`\uFEFF${buildFlagshipPriceCsv()}`, 'text/csv;charset=utf-8', `旗舰模型API价格-${FLAGSHIP_PRICE_SNAPSHOT.date}.csv`)}>导出 CSV</Button>
      <Button size="small" onClick={() => exportChart(svgRef.current)}>导出 SVG</Button>
    </Space>}
  >
    <Space wrap size={[8, 8]}>
      <Tag color="blue">截图日期 {FLAGSHIP_PRICE_SNAPSHOT.date}</Tag>
      <Tag>用户提供快照</Tag>
      <Tag>{FLAGSHIP_PRICE_ROWS.length} 个模型 · 原图顺序</Tag>
    </Space>
    <Paragraph className="flagship-price-intro" type="secondary">
      按原图重绘，保留星标、价格区间与限定条件。该快照与下方自动采集的 AA 数据分别展示；截图内容未经独立核实，原图未注明 AA 指数版本。
    </Paragraph>
    <MuseWonderRelease titleId={`${id}-muse-release-title`} />
    <Text type="secondary" className="flagship-price-scroll-hint">小屏可左右滑动查看完整图表；导出保留原图数据与备注。</Text>
    <div className="flagship-price-scroll" role="region" aria-label="旗舰模型 API 价格与智能指数图表，可左右滚动" tabIndex={0}>
      <svg ref={svgRef} data-testid="flagship-price-comparison-chart" className="flagship-price-svg" viewBox={`0 0 ${WIDTH} ${HEIGHT}`} role="img" aria-labelledby={`${titleId} ${descriptionId}`}>
        <title id={titleId}>{FLAGSHIP_PRICE_SNAPSHOT.title}，2026 年 10 月 13 日用户截图快照</title>
        <desc id={descriptionId}>29 个模型按原图顺序排列。左侧蓝色数字为 Artificial Analysis 智能指数，刻度为 25 至 65；右侧输入价为粉色、输出价为红色，统一使用 0 至 50 美元每百万 tokens 的线性刻度。实心条表示价格下限，浅色虚线条延伸到上限。Muse Wonder Full 和 Muse Wonder 保留原图框选。缺失报价不画条，未收录指数保持缺失。下方可展开完整文字数据。</desc>
        <rect width={WIDTH} height={HEIGHT} className="flagship-price-background" />
        <text x={WIDTH / 2} y={37} textAnchor="middle" className="flagship-price-chart-title">{FLAGSHIP_PRICE_SNAPSHOT.title}</text>
        <text x={WIDTH / 2} y={68} textAnchor="middle" className="flagship-price-chart-subtitle">2026/10/13 · 【{FLAGSHIP_PRICE_SNAPSHOT.team}】</text>
        <text x={SCORE_LEFT + SCORE_WIDTH / 2} y={103} textAnchor="middle" className="flagship-score-heading">Artificial Analysis 智能指数</text>
        <text x={PRICE_LEFT + PRICE_WIDTH / 2} y={103} textAnchor="middle" className="flagship-price-heading">API 刊例价（美元 / 百万 tokens）</text>
        <g className="flagship-price-input"><rect x={810} y={117} width={30} height={12} className="flagship-price-solid" /></g>
        <text x={848} y={129} className="flagship-price-legend">输入价</text>
        <g className="flagship-price-output"><rect x={946} y={117} width={30} height={12} className="flagship-price-solid" /></g>
        <text x={984} y={129} className="flagship-price-legend">输出价</text>
        {SCORE_TICKS.map(tick => <g key={tick}>
          <line x1={scorePosition(tick)} x2={scorePosition(tick)} y1={TOP} y2={BOTTOM} className="flagship-score-grid" />
          <line x1={scorePosition(tick)} x2={scorePosition(tick)} y1={TOP - 9} y2={TOP - 2} className="flagship-score-axis" />
          <text x={scorePosition(tick)} y={TOP - 15} textAnchor="middle" className="flagship-score-tick">{tick}</text>
        </g>)}
        <line x1={SCORE_LEFT} x2={SCORE_LEFT + SCORE_WIDTH} y1={TOP - 2} y2={TOP - 2} className="flagship-score-axis" />
        <line x1={667} x2={667} y1={TOP - 24} y2={BOTTOM + 16} className="flagship-price-divider" />
        {PRICE_TICKS.map(tick => <g key={tick}>
          <line x1={PRICE_LEFT + priceWidth(tick)} x2={PRICE_LEFT + priceWidth(tick)} y1={TOP} y2={BOTTOM} className="flagship-price-grid" />
          <line x1={PRICE_LEFT + priceWidth(tick)} x2={PRICE_LEFT + priceWidth(tick)} y1={BOTTOM} y2={BOTTOM + 8} className="flagship-price-axis" />
          <text x={PRICE_LEFT + priceWidth(tick)} y={BOTTOM + 31} textAnchor="middle" className="flagship-price-tick">{tick}</text>
        </g>)}
        {FLAGSHIP_PRICE_ROWS.map((row, index) => <ModelRow key={row.id} row={row} index={index} />)}
        <line x1={PRICE_LEFT} x2={PRICE_LEFT + PRICE_WIDTH + 22} y1={BOTTOM} y2={BOTTOM} className="flagship-price-axis" />
        <text x={24} y={BOTTOM + 65} className="flagship-price-footnote">实心 = 下限；浅色虚线 = 上限。分档与区间均保留原值；★ 沿用原图标记。</text>
        <text x={24} y={BOTTOM + 90} className="flagship-price-footnote">资料来源：厂商官网、Artificial Analysis、中信建投整理（用户提供截图，未独立核实）</text>
      </svg>
    </div>
    <Paragraph className="flagship-price-caption" type="secondary">
      来源：{FLAGSHIP_PRICE_SNAPSHOT.credit}；图中注明厂商官网、Artificial Analysis。价格单位统一为{FLAGSHIP_PRICE_SNAPSHOT.unit}。
    </Paragraph>
    <Collapse className="flagship-price-details" items={[
      { key: 'method', label: '口径说明与原图（点击图片放大）', children: <>
        <ul className="flagship-price-method">
          <li>固定快照日期为 2026-10-13；页面刷新不会改变该日期。原图星标含义未提供，沿用标记。</li>
          <li>所有价格条均从 0 起、共用 0–50 线性刻度。区间及分档以实心绘制较低端、浅色虚线绘制较高端；标签保留两端精度。</li>
          <li>Claude Haiku 5.5 的两档依原图对应 ≤100K / &gt;100K；DeepSeek 两项区间的条件在图中未注明。首发、限时、Preview、首发半价均沿用原图。</li>
          <li>Muse Wonder Full 与 MiniMax M3.1 Flash 的订阅说明、Ling 3.1 Flash 的报价未核实说明，以及两项“未收录”指数均保留；缺失数据不按 0 处理。</li>
        </ul>
        <figure className="flagship-price-original">
          <Image width="100%" src={FLAGSHIP_PRICE_SNAPSHOT.imageUrl} alt="用户提供的 2026 年 10 月 13 日建投 AI 互联网团队原图：29 个旗舰模型的 API 刊例价与 Artificial Analysis 智能指数对比。" />
          <figcaption>{FLAGSHIP_PRICE_SNAPSHOT.sourceLabel}。原图标题日期为 2026/10/13。</figcaption>
        </figure>
      </> },
      { key: 'data', label: `查看完整文字数据（${FLAGSHIP_PRICE_ROWS.length} 项）`, children: <div className="flagship-price-data-scroll">
        <table className="flagship-price-data">
          <caption>2026-10-13 截图转录 · 价格单位：美元 / 百万 tokens；两款 Muse 的后续纪要单独列示。</caption>
          <thead><tr><th scope="col">模型（原图星标）</th><th scope="col">AA 指数</th><th scope="col">输入价</th><th scope="col">输出价</th><th scope="col">原图备注</th><th scope="col">补充纪要（未经独立核实）</th></tr></thead>
          <tbody>{FLAGSHIP_PRICE_ROWS.map(row => <tr key={row.id}>
            <th scope="row">{flagshipModelLabel(row)}</th><td>{row.scoreRaw}</td><td>{row.input.raw || '未列示'}</td><td>{row.output.raw || '未列示'}</td><td>{row.note || '—'}</td><td className="flagship-price-supplement-note">{row.supplementNote || '—'}</td>
          </tr>)}</tbody>
        </table>
      </div> },
    ]} />
  </Card>;
}
