import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const root = path.dirname(fileURLToPath(import.meta.url));
const evidence = path.join(root, 'evidence');
const raw = fs.readdirSync(evidence).filter(f => f.startsWith('ornn-') && f.endsWith('.json')).map(f => ({file:f, ...JSON.parse(fs.readFileSync(path.join(evidence,f),'utf8'))}));
const value = (gpu,date) => raw.find(r => r.gpu_type === gpu).data.find(r => r.timestamp.startsWith(date)).index_value;
const rate = (a,b) => b/a-1;
const first = [
  ['H100 SXM',3.06,6.6], ['H200',null,2.5], ['B200',6.42,5.9], ['A100 SXM4',null,5.8], ['RTX 5090',null,18.9],
];
const matched = first.map(([gpu,quotedPrice,quotedPercent],order) => {
  const before=value(gpu,'2026-08-29'), after=value(gpu,'2026-09-05'), change=rate(before,after);
  if(Number((change*100).toFixed(1))!==quotedPercent || (quotedPrice!==null && quotedPrice!==after)) throw new Error(`Mismatch: ${gpu}`);
  return {order,gpu,before,after,reportedChange:quotedPercent/100,calculatedChange:change,status:'吻合（按原文精度）'};
});
const secondInput = [
  ['Silicon Data','B200',5.62,5.69],['Silicon Data','A100',1.60,1.59],['Silicon Data','H100',2.63,2.63],
  ['Ornn','H100 SXM',2.83,3.17],['Compute Desk','Hopper US',2.93,2.98],['Compute Desk','Blackwell US',5.26,5.28],
  ['平台未注明','B300',7.89,7.89],['平台未注明','B200',6.01,6.25],['平台未注明','H100',3.32,3.25],['平台未注明','H200',4.40,4.4046],
  ['平台未注明','A100',1.76,1.7252],['平台未注明','L4',0.8938,0.8856],['平台未注明','RTX Pro 6000',2.20,2.195],['平台未注明','L40S',1.50,1.395],['平台未注明','RTX 4090',0.42,0.4385],
];
const second=secondInput.map(([provider,gpu,before,after],order)=>({order,provider,gpu,before,after,change:rate(before,after),verification:provider==='Ornn'?'官方历史逐日已核实':provider==='Silicon Data'?'官网当前展示值吻合；区间历史待核实':provider==='Compute Desk'?'方法已核实；本期数值待核实':'来源、样本及日期待补'}));
const platform=second.filter(r=>r.provider==='平台未注明');
const signs={up:platform.filter(r=>r.change>0).length,flat:platform.filter(r=>r.change===0).length,down:platform.filter(r=>r.change<0).length};
if(signs.up!==3 || signs.flat!==1 || signs.down!==5) throw new Error('Unexpected platform profile');
const h100=raw.find(r=>r.gpu_type==='H100 SXM').data.map(r=>({date:r.timestamp.slice(0,10),timestamp:r.timestamp,gpu:'H100 SXM',price:r.index_value,unit:'USD/GPU/hour',priceType:'daily settled',provider:'Ornn'}));
if(value('H100 SXM','2026-09-01')!==2.83 || value('H100 SXM','2026-09-04')!==2.89 || value('H100 SXM','2026-09-07')!==3.17) throw new Error('H100 history mismatch');
const urls={
  ornn:'https://index.ornn.com/docs', sd:'https://www.silicondata.com/products/silicon-index/h100', sdb:'https://www.silicondata.com/products/silicon-index/b200',
  sdChanges:'https://docs.silicondata.com/products/gpu-index-announcements', desk:'https://www.general-index.com/post/compute-desks-indexes-are-now-regulated',
  lambda:'https://ca.finance.yahoo.com/news/anthropic-signs-35-billion-cloud-005022618.html',
  cerebras:'https://cerebras.gcs-web.com/news-releases/news-release-details/cerebras-and-compute-nordic-finland-announce-new-165-mw-ai-data',
  crusoe:'https://finance.yahoo.com/technology/ai/articles/crusoe-signs-13-billion-ai-195326470.html',
  bytedance:'https://www.investing.com/news/stock-market-news/bytedance-secures-296-billion-loan-in-ai-push-sources-say-4889439',
  yangguang:'https://file.finance.sina.com.cn/211.154.219.97%3A9494/MRGG/CNSESZ_STOCK/2026/2026-9/2026-09-02/12579716.PDF',
  yangdian:'https://finance.sina.com.cn/stock/aigc/zdht/2026-09-01/doc-iniqitrq4734815.shtml',
  xingyun:'https://finance.sina.com.cn/stock/zqgd/2026-09-04/doc-iniqriie1517859.shtml',
  thailand:'https://www.nationthailand.com/business/economy/40070655',
};
const sources=[
  {id:'ornn-history',label:'Ornn OCPI 官方逐日结算历史，2026年8月27日至9月7日',href:urls.ornn,path:'evidence/ornn-H100%20SXM.json',query:{engine:'javascript',sql: "const fs = await import('node:fs'); const raw = JSON.parse(fs.readFileSync('evidence/ornn-H100%20SXM.json', 'utf8')); const rows = raw.data.map(r => ({ date: r.timestamp.slice(0, 10), timestamp: r.timestamp, gpu: 'H100 SXM', price: r.index_value, unit: 'USD/GPU/hour', priceType: 'daily settled', provider: 'Ornn' })); console.log(JSON.stringify(rows));",description:'GET /api/gpu/{gpuName}/index-history?startDate=2026-08-27&endDate=2026-09-07；五档原始 JSON 保存在 evidence。',tables_used:['Ornn OCPI daily settled history'],language:'javascript'}},
  {id:'user-notes',label:'用户提供的两份算力跟踪材料；第二份平台名称缺失',path:'evidence/user-inputs.json'},
  {id:'reconciliation',label:'用户材料与 Ornn 官方历史逐项对照',path:'evidence/reconciliation.json',href:urls.ornn,query:{engine:'JavaScript',description:'每档变化＝期末结算价÷期初结算价−1；按原文一位小数比较。计算脚本 build-audit.mjs。',tables_used:['User GPU monitoring notes','Ornn OCPI daily settled history'],language:'javascript'}},
  ...Object.entries(urls).filter(([id])=>id!=='ornn').map(([id,href])=>({id,label:id,href})),
];
const title='GPU 租金数据一致性核验';
const md=(id,body)=>({id,type:'markdown',body});
const blocks=[
  md('title',`# ${title}`),
  md('summary',`## Executive Summary\n\n**核心价格可以对上，但两份材料不能合并成“各口径全面上涨”。** 第一份五个周涨幅全部吻合 Ornn 2026年9月5日结算值相对8月29日的变化；第二份 Ornn H100 的2.83→3.17及途中2.89也吻合官方历史。\n\n**需要修正第一份的时间和单位，并保留不同来源。** 3.06美元是每GPU每小时，所匹配结算日为9月5日，其时间戳在中国是9月6日凌晨，无法支持“截至9月4日”。第二份同时列举不同指数及未注明平台的报价，不能将它们相互替代。\n\n**第二份有一处明确事件错误。** 阳光股份6.33亿元合同的双方是子公司阳光金汇与外部A公司。其他产业事件主要金额可找到官方公告或公开报道支持，但媒体报道、合同签署、交付、收入和资金到账必须区别记录。`),
  md('basis',`## 先对齐日期、单位和对象\n\n本次按2026年处理材料中的月日。价格统一为美元/GPU/小时。Ornn 的当前小时值与每日结算值是两个字段；本次使用官方每日结算历史。7日变化定义为P(t)/P(t−7日)−1。9月1日到9月7日虽覆盖7个日期，但首末相隔6天，称为区间变化，不应直接等同滚动7日涨幅。[Ornn 官方接口说明](${urls.ornn})\n\n原始来源、GPU具体规格、地区、合约期限、样本和指数方法都属于价格的身份。Hopper/Blackwell系列指数与单型号报价存在覆盖范围差异。[General Index 官方说明](${urls.desk})`),
  md('first-finding',`## 第一份五档周涨幅全部可复算\n\n下表以Ornn官方8月29日和9月5日结算价计算，五档均与第一份材料的一位小数涨幅一致；H100的3.06及B200的6.42也精确吻合。这是数值对应关系，不能据此证明Valliance的原始采集链路。材料中的“每天”及“截至9/4”应修正。`),
  {id:'first-table-block',type:'table',tableId:'first-table'},
  md('h100-finding',`## 第二份 H100 历史吻合，涨幅窗口不同\n\n官方结算历史显示：9月1日2.83，9月3日2.92，9月4日2.89，9月5日3.06，9月7日3.17。第二份列出的起点、回落值和终点均吻合，区间涨幅为**+12.01%**。\n\n若严格计算9月7日滚动7日变化，基准应为8月31日2.97，结果是**+6.73%**；第一份的**+6.62%**则是9月5日相对8月29日。三者均可成立，差异来自窗口。下图仅绘Ornn这一条同口径历史，不与其他指数拼接。[官方历史接口](${urls.ornn})`),
  {id:'h100-chart-block',type:'chart',chartId:'h100-history'},
  md('second-finding',`## 其余价格呈现来源分化\n\n按第二份提供的首末值计算，Silicon Data B200约+1.25%、A100约−0.63%、H100持平；未注明平台的报价共有**3涨、5跌、1平**。H100平台报价约−2.11%，A100约−1.98%，L40S为−7.00%。因此这些报价不支持“所有GPU、所有来源都上涨”的概括。\n\nSilicon Data官网当前展示的B200 5.69、A100 1.59及H100 2.63与材料终值吻合；尚未取得其本期完整历史，不能确认9月1日起值、区间路径或7月14日高点。平台报价尚缺平台名、计费模式、地区、样本及明确观察时刻，以下为**材料内算术核对，不是全部独立验真**。[H100页面](${urls.sd}) · [B200页面](${urls.sdb})\n\n跨来源价差并不自动意味着错误。Silicon Data对租期、集群规模等做标准化，H100又区分Neo-Cloud与Hyperscaler；Compute Desk的家族指数覆盖多个芯片。只能在同一系列内计算变化。[Silicon Data口径](${urls.sd}) · [Compute Desk/GX口径](${urls.desk})`),
  {id:'second-table-block',type:'table',tableId:'second-table'},
  md('events',`## 产业更新：金额多数有出处，合同主体需修正\n\n- **Anthropic–Lambda：报道一致。** 路透8月31日援引知情人士报道350亿美元云计算协议，应保留“据报道”。[路透原稿转载](${urls.lambda})\n- **扬电科技：公开报道支持。** 32节点、9月1日起计费、约2.15亿元及约25%相符。对应的是已交付部分的合同金额，不能写成当期确认收入；本轮未直接取得公告PDF。[公告摘要报道](${urls.yangdian})\n- **Cerebras：官方确认。** 公司9月1日新闻稿载明芬兰Mikkeli项目165MW、首期50MW在建。规划规模不等于已投运规模。[公司新闻稿](${urls.cerebras})\n- **阳光股份：合同主体写错，金额与期限相符。** 公告原文写子公司阳光金汇向A公司提供服务器租赁综合服务，含税6.33亿元、自计费起5年；公告落款9月1日、披露文件日期9月2日。原材料把母子公司写成交易双方，应更正。[公告原文](${urls.yangguang})\n- **Crusoe–Jane Street：报道一致。** 路透9月3日转述彭博的130亿美元、5年云合同，属于媒体报道。[路透原稿转载](${urls.crusoe})\n- **行云科技：公开报道支持。** 9.216亿元、VD客户、5年相符。本轮核验至证券时报公告报道，未直接取得公告PDF。[证券时报报道](${urls.xingyun})\n- **字节跳动：金额及主要条款有报道支持。** 路透9月4日报道296亿美元无抵押贷款、初始3年；正式用途为一般公司用途，知情人士称主要支持AI。报道还称即将签署，不能记为全部到账。[路透原稿](${urls.bytedance})\n- **泰国：当地报道支持数量和会议日期。** 9月4日会议、约49在建及117待批项目暂缓，与The Nation相符；应记为监管进程及项目延期，不能改写为永久取消。[当地报道](${urls.thailand})`),
  md('next',`## 在 shifeng-investment 中如何使用\n\n1. 在AI看板→算力租赁下，为Ornn、Silicon Data、Compute Desk和厂商报价保留各自系列，并注明GPU范围、期限、地区及单位。\n2. Ornn五档可优先作为本次已核验的数据来源；本次仅保存核验快照，自动采集需另行接入。\n3. 每条数据同时保存来源结算日期、原始时间戳、北京时间展示日期及抓取时间。严格使用同系列、同方法的t−7日基准，缺值时不冒充7日涨幅。\n4. 合同、交付、起租、收入及融资到账分别标注事件状态。阳光股份修正签约主体。`),
  md('questions',`## 尚需补充的证据\n\n“算力平台报价”的原始链接和平台名称；Silicon Data及Compute Desk本期逐日导出、准确ticker及方法版本；Valliance原始出处；第一份“连续第二周全部上涨”和“30日基准切换”的依据。后两句话目前不应作为已核实事实。`),
  md('caveats',`## 核验边界\n\n**高置信度：** 五档Ornn价格及周涨幅、第二份H100路径、首末变化算术、单位与时间窗口问题、阳光股份签约主体。\n\n**部分核实：** Silicon Data官网当前展示终值、Compute Desk指数含义、多数产业报道。\n\n**待核实：** 未注明平台的原始价格、本期Silicon Data/Compute Desk完整历史、连续两周及基准切换说法。公开API也可能回补历史，保存的原始JSON代表本次查询结果。价格上涨可作为供需观察，不能单独证明需求增加、全产业链景气或盈利改善。`),
];
const artifact={surface:'report',manifest:{version:1,surface:'report',title,description:'两份算力租金材料的数值、口径及事件核对；截至2026年9月8日。',generatedAt:new Date().toISOString(),sources,blocks,
  charts:[{id:'h100-history',title:'Ornn H100 每日结算价格',description:'2026年8月27日至9月7日；美元/GPU/小时。',type:'line',dataset:'h100History',sourceId:'ornn-history',valueFormat:'number',encodings:{x:{field:'date',type:'temporal',label:'结算日'},y:{field:'price',type:'quantitative',label:'美元/GPU/小时'}}}],
  tables:[{id:'first-table',title:'第一份材料与 Ornn 历史对照',dataset:'firstComparison',sourceId:'reconciliation',defaultSort:{field:'gpu',direction:'asc'},columns:[{field:'gpu',label:'GPU',type:'text'},{field:'before',label:'8月29日'},{field:'after',label:'9月5日'},{field:'reportedChange',label:'原文7日变化',format:'percent'},{field:'calculatedChange',label:'复算7日变化',format:'percent'},{field:'status',label:'判断',type:'text'}]},
  {id:'second-table',title:'第二份材料首末值与区间变化',dataset:'secondComparison',sourceId:'user-notes',defaultSort:{field:'provider',direction:'asc'},columns:[{field:'provider',label:'来源',type:'text'},{field:'gpu',label:'GPU / 指数',type:'text'},{field:'before',label:'材料起值'},{field:'after',label:'材料终值'},{field:'change',label:'区间变化',format:'percent',movement:true},{field:'verification',label:'核验状态',type:'text'}]}]},
  snapshot:{version:1,status:'partial',generatedAt:new Date().toISOString(),datasets:{firstComparison:matched,secondComparison:second,h100History:h100},accessIssues:[{id:'missing-originals',dataset:'secondComparison',message:'未注明平台的原始报价，以及Silicon Data / Compute Desk本期完整历史仍缺失；对应行仅按用户材料复算。'}]},sources};
fs.writeFileSync(path.join(evidence,'user-inputs.json'),JSON.stringify({yearAssumption:2026,firstNote:{claimedAsOf:'9/4',claimedUnit:'每天',rows:first},secondNote:{statedIndexWindow:'9/1–9/7',platformWindow:'未明确；不假定与指数相同',rows:secondInput}},null,2));
fs.writeFileSync(path.join(evidence,'reconciliation.json'),JSON.stringify({formula:'end/start - 1',firstComparison:matched,secondComparison:second,platformCounts:signs,sourceUrls:urls,apiEndpoints:raw.map(r=>({gpu:r.gpu_type,file:r.file,url:`https://api.ornnai.com/api/gpu/${encodeURIComponent(r.gpu_type)}/index-history?startDate=2026-08-27&endDate=2026-09-07`}))},null,2));
// Derive the delivered chart and tables directly from the saved inputs with SQL.
// The portable reader requires original runnable SQL provenance for these blocks.
const sqls = {
  h100History: `SELECT substr(json_extract(value,'$.timestamp'),1,10) AS date, json_extract(value,'$.timestamp') AS timestamp, 'H100 SXM' AS gpu, json_extract(value,'$.index_value') AS price, 'USD/GPU/hour' AS unit, 'daily settled' AS priceType, 'Ornn' AS provider FROM json_each(readfile('evidence/ornn-H100%20SXM.json'),'$.data') ORDER BY date;`,
  firstComparison: `WITH prices AS (${raw.map(r=>`SELECT '${r.gpu_type}' AS gpu, substr(json_extract(value,'$.timestamp'),1,10) AS date, json_extract(value,'$.index_value') AS price FROM json_each(readfile('evidence/${r.file}'),'$.data')`).join(' UNION ALL ')}), notes AS (SELECT CAST(key AS INTEGER) AS ord, json_extract(value,'$[0]') AS gpu, json_extract(value,'$[2]')/100.0 AS reportedChange FROM json_each(readfile('evidence/user-inputs.json'),'$.firstNote.rows')) SELECT n.ord AS 'order', n.gpu, a.price AS before, b.price AS after, n.reportedChange, b.price/a.price-1.0 AS calculatedChange, CASE WHEN round((b.price/a.price-1.0)*100.0,1)=round(n.reportedChange*100.0,1) THEN '吻合（按原文精度）' ELSE '不一致' END AS status FROM notes n JOIN prices a ON a.gpu=n.gpu AND a.date='2026-08-29' JOIN prices b ON b.gpu=n.gpu AND b.date='2026-09-05' ORDER BY n.ord;`,
  secondComparison: `WITH rows AS (SELECT CAST(key AS INTEGER) AS ord, json_extract(value,'$[0]') AS provider, json_extract(value,'$[1]') AS gpu, json_extract(value,'$[2]') AS before, json_extract(value,'$[3]') AS after FROM json_each(readfile('evidence/user-inputs.json'),'$.secondNote.rows')) SELECT ord AS 'order', provider, gpu, before, after, after*1.0/before-1.0 AS change, CASE provider WHEN 'Ornn' THEN '官方历史逐日已核实' WHEN 'Silicon Data' THEN '官网当前展示值吻合；区间历史待核实' WHEN 'Compute Desk' THEN '方法已核实；本期数值待核实' ELSE '来源、样本及日期待补' END AS verification FROM rows ORDER BY ord;`,
};
const sourceIds={h100History:'ornn-history',firstComparison:'reconciliation',secondComparison:'user-notes'};
for(const [dataset,sql] of Object.entries(sqls)) {
  const rows=JSON.parse(execFileSync('sqlite3',['-json',':memory:',sql],{cwd:root,encoding:'utf8'}));
  if(rows.length!==artifact.snapshot.datasets[dataset].length) throw new Error(`SQL row mismatch: ${dataset}`);
  artifact.snapshot.datasets[dataset]=rows;
  fs.writeFileSync(path.join(evidence,`${dataset}.sql`),sql+'\n');
  const source=sources.find(s=>s.id===sourceIds[dataset]);
  source.query={engine:'SQLite',language:'sql',sql,description:'直接从保存的原始JSON计算交付表及图；数值与JavaScript独立复算核对。',tables_used:dataset==='secondComparison'?['User-provided compute monitoring notes']:['Ornn OCPI daily settled history','User-provided compute monitoring notes']};
  source.path=`evidence/${dataset}.sql`;
}
for(let i=0;i<matched.length;i++) if(Math.abs(artifact.snapshot.datasets.firstComparison[i].calculatedChange-matched[i].calculatedChange)>1e-12) throw new Error('SQL/JS reconciliation mismatch');
for(let i=0;i<second.length;i++) if(Math.abs(artifact.snapshot.datasets.secondComparison[i].change-second[i].change)>1e-12) throw new Error('SQL/JS interval mismatch');
fs.writeFileSync(path.join(root,'artifact.json'),JSON.stringify(artifact,null,2));
fs.writeFileSync(path.join(root,'verification-notes.md'),'# 核验说明\n\n报告采用 executive-report 结构；精确对照使用表格。唯一趋势图为官方Ornn H100的12个逐日观察，单系列，日期横轴、USD/GPU/hour纵轴，不叠加不同来源。报告源状态partial反映缺少平台出处和另外两家本期完整历史；未取得历史不会被当作已验真。计算使用可复现JavaScript，运行 node build-audit.mjs。原始JSON保留在evidence。\n\n高严重度问题：单位、结算日、跨来源拼接、签约主体。中严重度问题：滚动7日与六天区间混用、历史和方法版本缺失。事实与推断分别标明。Report结构：标题、Executive Summary、价格证据和事件核验、使用建议、待补证据、核验边界。\n');
console.log(JSON.stringify({matchedRows:matched.length,platformCounts:signs,h100Points:h100.length,h100IntervalChange:rate(2.83,3.17),h100SevenDayChange:rate(2.97,3.17),artifact:path.join(root,'artifact.json')}));
