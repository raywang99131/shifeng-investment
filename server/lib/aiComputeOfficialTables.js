import { normalizeComputeQuote } from './aiComputeData.js';

export function computeObservationDate(retrievedAt) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date(retrievedAt));
}

const clean = (value) => String(value || '').replace(/\s+/g, ' ').trim();
const dollars = (value) => {
  const match = clean(value).match(/^\$([\d,]+(?:\.\d+)?)(?:\s|$|\()/);
  return match ? Number(match[1].replaceAll(',', '')) : null;
};
const cells = ($, row) => $(row).children('th,td').map((_, cell) => clean($(cell).text())).get();

// Follow the existing monitored instances. Identity comes from the verified
// catalog; a new observation requires matching GPU, count, location and rate.
export function parseMonitoredComputeTables($, definition, document, trackedQuotes) {
  const tracked = [...new Map((trackedQuotes || []).filter(row => row.platform === definition.platform)
    .map(row => [row.quoteKey, row])).values()];
  const quotes = [];
  for (const trackedQuote of tracked) {
    const row = trackedQuote;
    if (row.currency !== 'USD') continue;
    const observations = [];
    if (definition.id === 'aws-ec2-pricing' && row.billingMode === 'capacity_block'
      && new URL(document.finalUrl).pathname === '/ec2/capacityblocks/pricing/') {
      $('table').each((_, table) => {
        const headers = cells($, $(table).find('tr').first()).join(' ');
        if (!/Instance Type.*Region.*PER INSTANCE.*ACCELERATOR/i.test(headers)) return;
        $(table).find('tr').each((__, tr) => {
          const [instance, region, price, accelerator] = cells($, tr);
          const gpu = accelerator?.match(/^(\d+)\s*x\s*(.+)$/i);
          if (instance === row.instanceSpec && region === row.region && gpu
            && Number(gpu[1]) === row.gpuCount && row.gpu.split(' ').includes(gpu[2])) {
            observations.push(dollars(price));
          }
        });
      });
    }
    if (definition.id === 'lambda-cloud-pricing' && row.billingMode === 'on_demand'
      && row.region === 'global availability' && row.instanceSpec === `${row.gpuCount}-GPU plan`) {
      $('[role="tab"]').each((_, tab) => {
        if (clean($(tab).text()) !== `${row.gpuCount}x`) return;
        const panelId = $(tab).attr('aria-controls');
        $('[role="tabpanel"]').filter((__, panel) => $(panel).attr('id') === panelId)
          .find('tr').each((__, tr) => {
            const [gpu, vram] = cells($, tr);
            if (`${gpu} ${vram?.replaceAll(' ', '')}` !== row.gpu) return;
            const price = dollars($(tr).find('[data-label="PRICE/GPU/HR*"]').text());
            if (price !== null) observations.push(price * row.gpuCount);
          });
      });
    }
    if (definition.id === 'coreweave-pricing' && ['on_demand', 'spot'].includes(row.billingMode)) {
      $('.table-v2.gpu-pricing').each((_, table) => {
        const regionLabel = clean($(table).prevAll('h5').first().text()).replace(/^REGION:\s*/i, '').toUpperCase();
        const region = regionLabel === 'NORTH AMERICA' ? 'US' : regionLabel;
        if (region !== row.region.toUpperCase()) return;
        $(table).find('.table-grid').each((__, grid) => {
          const columns = $(grid).children('.table-v2-cell');
          const gpu = clean(columns.eq(0).text());
          const count = Number(clean(columns.eq(1).text()));
          const vram = clean(columns.eq(2).text());
          if (`${gpu} ${vram}GB` !== row.gpu || count !== row.gpuCount
            || `${gpu.replace(/^NVIDIA /, '')} ${count}-GPU` !== row.instanceSpec) return;
          observations.push(dollars($(grid).find(row.billingMode === 'spot' ? '.spot-price .item-value' : '.instance-price .item-value').text()));
        });
      });
    }
    if (definition.id === 'gcp-gpu-pricing' && row.region === 'listed regions'
      && ['on_demand', 'spot'].includes(row.billingMode)) {
      $('table').each((_, table) => {
        const headers = cells($, $(table).find('tr').first());
        if (headers[0] !== 'Machine type' || headers[1] !== 'GPU') return;
        const priceColumn = headers.findIndex(header => row.billingMode === 'spot'
          ? /^Current Spot pricing \(USD\)/.test(header) : /^Price \(USD\)/.test(header));
        if (priceColumn < 0) return;
        $(table).find('tr').each((__, tr) => {
          const values = cells($, tr);
          const count = values[2]?.match(/^GPUs:\s*(\d+)(?![\d/])/);
          if (values[0] !== row.instanceSpec || !count || Number(count[1]) !== row.gpuCount
            || !row.gpu.toLowerCase().startsWith(`${values[1].toLowerCase()} `)) return;
          observations.push(dollars(values[priceColumn]));
        });
      });
    }
    const prices = [...new Set(observations.filter(value => value !== null))];
    // Conflicting locations or duplicated prices with different values are not a quote.
    if (prices.length !== 1) continue;
    quotes.push(normalizeComputeQuote({
      platform: row.platform, gpu: row.gpu, instanceSpec: row.instanceSpec, gpuCount: row.gpuCount,
      region: row.region, billingMode: row.billingMode, currency: 'USD', instanceHourlyPrice: prices[0],
      sourceLabel: `${row.platform} 官网`, sourceUrl: document.finalUrl, sourceKind: 'official',
      asOf: computeObservationDate(document.retrievedAt), retrievedAt: document.retrievedAt,
      methodology: '按北京时间逐日记录官网当前报价；同实例、GPU 数量、页面地区和计费方式分别保留。',
    }));
  }
  return quotes;
}
