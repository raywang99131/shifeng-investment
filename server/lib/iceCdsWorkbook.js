import ExcelJS from 'exceljs';

const SHEET_NAMES = Object.freeze([
  'Raw EOD Prices',
  'Derived 5Y Spreads',
  'Daily Dashboard',
  'Discount Curves',
  'Contract Registry',
  'Validation Log',
  'Methodology',
]);
const CDS_SOURCE_COPY = '截图历史回填 + ICE EOD Price · 模型换算';
const SCREENSHOT_BACKFILL_LABEL = 'User screenshot curve backfill (approximate)';

const COLORS = Object.freeze({
  navy: 'FF17365D',
  white: 'FFFFFFFF',
  paleBlue: 'FFDCE6F1',
  lightBorder: 'FFD9E2F3',
  formulaGreen: 'FF008000',
  externalRed: 'FFFF0000',
  warningYellow: 'FFFFFF00',
  readyGreen: 'FFE2F0D9',
  reviewYellow: 'FFFFF2CC',
  staleRed: 'FFFCE4D6',
});

function dateValue(value, label) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new Error(`${label} must be YYYY-MM-DD`);
  }
  const date = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value) {
    throw new Error(`${label} must be a real calendar date`);
  }
  return date;
}

function isoDate(value) {
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  if (typeof value === 'string') return value.slice(0, 10);
  return null;
}

function sourceCell(url, label = 'Open source') {
  return url ? { text: label, hyperlink: url, tooltip: url } : null;
}

function sourceUrl(value) {
  if (value && typeof value === 'object' && typeof value.hyperlink === 'string') return value.hyperlink;
  return typeof value === 'string' && /^https?:\/\//.test(value) ? value : null;
}

function isScreenshotBackfillEvidence({ batchId, instrumentName, curveId, modelVersion }) {
  return modelVersion === 'screenshot-backfill-v1'
    || /^screenshot-(?:reference|backfill)-/i.test(String(batchId || ''))
    || /^SCREENSHOT\./i.test(String(instrumentName || ''))
    || /^screenshot-(?:reference|backfill)/i.test(String(curveId || ''));
}

function sourceMetadataForArchiveRow(row) {
  const screenshotBackfill = isScreenshotBackfillEvidence(row);
  if (row.sourceKind && !['ice_eod_isda', 'screenshot_backfill'].includes(row.sourceKind)) {
    throw new Error(`Derived Source Kind is invalid: ${row.sourceKind}`);
  }
  if (screenshotBackfill && row.sourceKind === 'ice_eod_isda') {
    throw new Error('Derived Source Kind conflicts with screenshot-backfill evidence');
  }
  if (row.sourceKind === 'screenshot_backfill' && row.eodPrice !== null && row.eodPrice !== undefined && row.eodPrice !== '') {
    throw new Error('Screenshot-backfill Derived row must not include an ICE EOD Price');
  }
  return {
    sourceKind: row.sourceKind || (screenshotBackfill ? 'screenshot_backfill' : 'ice_eod_isda'),
    sourceLabel: row.sourceLabel || (screenshotBackfill ? SCREENSHOT_BACKFILL_LABEL : CDS_SOURCE_COPY),
  };
}

function addSheet(workbook, name, headers, widths) {
  const sheet = workbook.addWorksheet(name, {
    views: [{ state: 'frozen', ySplit: 1, activeCell: 'A2', showGridLines: false }],
    properties: { defaultRowHeight: 18 },
  });
  sheet.addRow(headers);
  const header = sheet.getRow(1);
  header.height = 28;
  for (let column = 1; column <= headers.length; column += 1) {
    const cell = header.getCell(column);
    cell.font = { name: 'Aptos', size: 10, bold: true, color: { argb: COLORS.white } };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLORS.navy } };
    cell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
    cell.border = { bottom: { style: 'medium', color: { argb: COLORS.navy } } };
  }
  headers.forEach((_, index) => {
    sheet.getColumn(index + 1).width = widths[index] || 14;
  });
  sheet.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: headers.length } };
  return sheet;
}

function styleBody(sheet, dateColumns = [], numberFormats = {}, urlColumns = []) {
  for (let rowNumber = 2; rowNumber <= sheet.rowCount; rowNumber += 1) {
    for (let column = 1; column <= sheet.columnCount; column += 1) {
      const cell = sheet.getCell(rowNumber, column);
      cell.font = { name: 'Aptos', size: 10, color: { argb: 'FF000000' } };
      cell.alignment = { vertical: 'middle' };
      cell.border = { bottom: { style: 'hair', color: { argb: COLORS.lightBorder } } };
      if (rowNumber % 2 === 0) cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF7F9FC' } };
    }
    for (const column of dateColumns) sheet.getCell(rowNumber, column).numFmt = 'yyyy-mm-dd';
    for (const [column, format] of Object.entries(numberFormats)) {
      const cell = sheet.getCell(rowNumber, Number(column));
      cell.numFmt = format;
      cell.alignment = { vertical: 'middle', horizontal: 'right' };
    }
    for (const column of urlColumns) {
      const cell = sheet.getCell(rowNumber, column);
      cell.font = { name: 'Aptos', size: 10, color: { argb: COLORS.externalRed }, underline: true };
    }
  }
}

function applyQualityFill(cell, status) {
  const fill = status === 'validated'
    ? COLORS.readyGreen
    : status === 'model-derived'
      ? COLORS.paleBlue
      : status === 'needs-review'
        ? COLORS.reviewYellow
        : COLORS.staleRed;
  cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: fill } };
}

function validateState(state) {
  if (!state || typeof state !== 'object' || Array.isArray(state)) throw new Error('ICE CDS archive state is required');
  if (!String(state.batchId || '').trim()) throw new Error('ICE CDS archive batchId is required');
  if (!String(state.generatedAt || '').trim()) throw new Error('ICE CDS archive generatedAt is required');
  for (const field of ['rawRows', 'derivedRows', 'curves', 'registry', 'validationLog']) {
    if (!Array.isArray(state[field])) throw new Error(`ICE CDS archive ${field} must be an array`);
  }
  const uniqueKeys = new Set();
  for (const row of state.derivedRows) {
    const key = `${row.clearingDate}|${row.company}|${row.instrumentName}`;
    if (uniqueKeys.has(key)) throw new Error(`Duplicate derived CDS row: ${key}`);
    uniqueKeys.add(key);
  }
}

function priorMonthDate(value) {
  const date = dateValue(value, 'Dashboard date');
  const targetMonth = date.getUTCMonth() - 1;
  const year = date.getUTCFullYear() + Math.floor(targetMonth / 12);
  const month = ((targetMonth % 12) + 12) % 12;
  const lastDay = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  return new Date(Date.UTC(year, month, Math.min(date.getUTCDate(), lastDay))).toISOString().slice(0, 10);
}

function offsetDate(value, days) {
  const date = dateValue(value, 'Dashboard date');
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function missingChangeFormula() {
  return { formula: 'IFERROR(NA(),"")', result: '' };
}

function changeFormula(currentRow, priorSourceRow, result) {
  if (!priorSourceRow) return missingChangeFormula();
  return {
    formula: `C${currentRow}-'Derived 5Y Spreads'!G${priorSourceRow}`,
    result,
  };
}

function writeRawSheet(workbook, state) {
  const sheet = addSheet(workbook, 'Raw EOD Prices', [
    'Batch ID', 'Clearing Date', 'Company', 'ICE Name', 'Instrument Name', 'EOD Price', 'Source URL', 'Imported At',
  ], [24, 14, 16, 24, 42, 14, 18, 25]);
  for (const row of state.rawRows) {
    sheet.addRow([
      row.batchId,
      dateValue(row.clearingDate, 'Raw clearing date'),
      row.company,
      row.name,
      row.instrumentName,
      row.eodPrice,
      sourceCell(row.sourceUrl, 'ICE EOD Price'),
      row.importedAt,
    ]);
  }
  styleBody(sheet, [2], { 6: '0.0000' }, [7]);
}

function writeDerivedSheet(workbook, state) {
  const sheet = addSheet(workbook, 'Derived 5Y Spreads', [
    'Batch ID', 'Clearing Date', 'Company', 'Instrument Name', 'EOD Price', 'Coupon (bp)', 'Spread (bp)',
    'Maturity Date', 'Round-trip Price', 'Price Residual', 'Hazard Rate', 'Curve ID', 'Recovery Rate',
    'Model Version', 'Quality Status', 'Official Spread (bp)', 'Relative Error', 'Source Kind', 'Source Label', 'Source URL',
  ], [24, 14, 16, 42, 13, 13, 14, 14, 17, 15, 14, 30, 14, 26, 18, 20, 16, 22, 34, 18]);
  const companyOrder = new Map(state.registry.map((row, index) => [row.company, index]));
  const rows = [...state.derivedRows].sort((left, right) => (
    left.clearingDate.localeCompare(right.clearingDate)
    || (companyOrder.get(left.company) ?? Number.MAX_SAFE_INTEGER) - (companyOrder.get(right.company) ?? Number.MAX_SAFE_INTEGER)
    || left.company.localeCompare(right.company)
  ));
  const sourceRows = new Map();
  for (const row of rows) {
    const source = sourceMetadataForArchiveRow(row);
    const excelRow = sheet.addRow([
      row.batchId,
      dateValue(row.clearingDate, 'Derived clearing date'),
      row.company,
      row.instrumentName,
      row.eodPrice,
      row.couponBp,
      row.spreadBp,
      source.sourceKind === 'screenshot_backfill' ? null : dateValue(row.maturityDate, 'Derived maturity date'),
      row.roundTripPrice,
      row.priceResidual,
      row.hazardRate,
      row.curveId,
      row.recoveryRate,
      row.modelVersion,
      row.qualityStatus,
      row.officialSpreadBp,
      row.relativeError,
      source.sourceKind,
      source.sourceLabel,
      sourceCell(row.sourceUrl, '5Y spread 模型换算值'),
    ]);
    sourceRows.set(`${row.company}|${row.clearingDate}`, excelRow.number);
  }
  styleBody(sheet, [2, 8], {
    5: '0.0000', 6: '0.00', 7: '0.00', 9: '0.0000', 10: '0.000000', 11: '0.000000',
    13: '0.00%', 16: '0.00', 17: '0.00%',
  }, [20]);
  for (let row = 2; row <= sheet.rowCount; row += 1) applyQualityFill(sheet.getCell(row, 15), sheet.getCell(row, 15).value);
  return { rows, sourceRows };
}

function writeDashboardSheet(workbook, derived) {
  const sheet = addSheet(workbook, 'Daily Dashboard', [
    'Date', 'Company', 'Spread (bp)', '1D Δ (bp)', '7D Δ (bp)', '1M Δ (bp)', 'EOD Price',
    'Quality Status', 'Batch ID', 'Instrument Name', 'Source Kind', 'Source Label', 'Source URL',
  ], [14, 16, 15, 14, 14, 14, 14, 18, 24, 42, 22, 34, 18]);
  const byCompany = new Map();
  for (const row of derived.rows) {
    if (!byCompany.has(row.company)) byCompany.set(row.company, []);
    byCompany.get(row.company).push(row);
  }
  for (const row of derived.rows) {
    const excelRowNumber = sheet.rowCount + 1;
    const companyRows = byCompany.get(row.company);
    const companyIndex = companyRows.indexOf(row);
    const oneDay = companyIndex > 0 ? companyRows[companyIndex - 1] : null;
    const priorRows = companyRows.slice(0, companyIndex);
    const latestAtOrBefore = (targetDate) => priorRows.toReversed().find((candidate) => candidate.clearingDate <= targetDate) || null;
    const sevenDay = latestAtOrBefore(offsetDate(row.clearingDate, -7));
    const oneMonth = latestAtOrBefore(priorMonthDate(row.clearingDate));
    const sourceRow = derived.sourceRows.get(`${row.company}|${row.clearingDate}`);
    const dashboardRow = sheet.addRow([
      dateValue(row.clearingDate, 'Dashboard date'),
      row.company,
      { formula: `'Derived 5Y Spreads'!G${sourceRow}`, result: row.spreadBp },
      changeFormula(excelRowNumber, oneDay && derived.sourceRows.get(`${oneDay.company}|${oneDay.clearingDate}`), oneDay ? row.spreadBp - oneDay.spreadBp : null),
      changeFormula(excelRowNumber, sevenDay && derived.sourceRows.get(`${sevenDay.company}|${sevenDay.clearingDate}`), sevenDay ? row.spreadBp - sevenDay.spreadBp : null),
      changeFormula(excelRowNumber, oneMonth && derived.sourceRows.get(`${oneMonth.company}|${oneMonth.clearingDate}`), oneMonth ? row.spreadBp - oneMonth.spreadBp : null),
      { formula: `'Derived 5Y Spreads'!E${sourceRow}`, result: row.eodPrice },
      { formula: `'Derived 5Y Spreads'!O${sourceRow}`, result: row.qualityStatus },
      { formula: `'Derived 5Y Spreads'!A${sourceRow}`, result: row.batchId },
      { formula: `'Derived 5Y Spreads'!D${sourceRow}`, result: row.instrumentName },
      { formula: `'Derived 5Y Spreads'!R${sourceRow}`, result: row.sourceKind || 'ice_eod_isda' },
      { formula: `'Derived 5Y Spreads'!S${sourceRow}`, result: row.sourceLabel || CDS_SOURCE_COPY },
      sourceCell(row.sourceUrl),
    ]);
  }
  styleBody(sheet, [1], { 3: '0.00', 4: '+0.00;[Red]-0.00;-', 5: '+0.00;[Red]-0.00;-', 6: '+0.00;[Red]-0.00;-', 7: '0.0000' }, [13]);
  for (let row = 2; row <= sheet.rowCount; row += 1) {
    for (let column = 3; column <= 10; column += 1) {
      sheet.getCell(row, column).font = { name: 'Aptos', size: 10, color: { argb: COLORS.formulaGreen } };
    }
    const qualityCell = sheet.getCell(row, 8);
    const qualityValue = qualityCell.value;
    const qualityStatus = qualityValue && typeof qualityValue === 'object' && 'result' in qualityValue
      ? qualityValue.result
      : qualityValue;
    applyQualityFill(qualityCell, qualityStatus);
  }
}

function writeCurvesSheet(workbook, state) {
  const sheet = addSheet(workbook, 'Discount Curves', [
    'Curve ID', 'As Of', 'Currency', 'Years', 'Continuous Zero Rate', 'Source Label', 'Source URL',
  ], [30, 14, 12, 12, 22, 26, 18]);
  for (const curve of state.curves) {
    for (const node of curve.nodes || []) {
      sheet.addRow([
        curve.curveId,
        dateValue(curve.asOf, 'Curve asOf'),
        curve.currency,
        node.years,
        node.zeroRate,
        curve.sourceLabel,
        sourceCell(curve.sourceUrl),
      ]);
    }
  }
  styleBody(sheet, [2], { 4: '0.00', 5: '0.0000%' }, [7]);
}

function writeRegistrySheet(workbook, state) {
  const sheet = addSheet(workbook, 'Contract Registry', [
    'Company', 'Aliases', 'Symbols', 'Currency', 'Tier', 'Restructuring', 'Coupon (bp)',
  ], [18, 52, 18, 12, 14, 18, 14]);
  for (const row of state.registry) {
    sheet.addRow([
      row.company,
      (row.aliases || []).join('; '),
      (row.symbols || []).join('; '),
      row.currency,
      row.tier,
      row.restructuring,
      row.couponBp,
    ]);
  }
  styleBody(sheet, [], { 7: '0.00' });
}

function writeValidationSheet(workbook, state) {
  const sheet = addSheet(workbook, 'Validation Log', [
    'Batch ID', 'Created At', 'Level', 'Code', 'Company', 'Message',
  ], [24, 25, 14, 24, 18, 60]);
  for (const row of state.validationLog) {
    sheet.addRow([row.batchId, row.createdAt, row.level, row.code, row.company, row.message]);
  }
  styleBody(sheet);
  for (let row = 2; row <= sheet.rowCount; row += 1) {
    if (sheet.getCell(row, 3).value !== 'info') {
      sheet.getCell(row, 3).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLORS.warningYellow } };
    }
    sheet.getCell(row, 6).alignment = { vertical: 'middle', wrapText: true };
  }
}

function writeMethodologySheet(workbook, state) {
  const sheet = addSheet(workbook, 'Methodology', ['Key', 'Value'], [34, 100]);
  const entries = [
    ['schemaVersion', state.schemaVersion ?? 1],
    ['batchId', state.batchId],
    ['generatedAt', state.generatedAt],
    ['modelVersion', state.methodology?.modelVersion || 'ice-isda-compatible-v1'],
    ['priceTolerance', state.methodology?.priceTolerance ?? 0.005],
    ['relativeBenchmarkTolerance', state.methodology?.relativeBenchmarkTolerance ?? 0.01],
    ['note', state.methodology?.note || 'Model-derived unless an official spread benchmark passes validation.'],
    ['sourceDefinition', state.methodology?.sourceDefinition || 'ICE EOD Price is the source input; Spread (bp) is a model-derived estimate.'],
    ['officialStatus', 'This workbook does not present model-derived spreads as official ICE spread quotations.'],
    ...(state.methodology?.cloudDataState ? [['cloudDataState', state.methodology.cloudDataState]] : []),
    ...(state.methodology?.cloudExportedAt ? [['cloudExportedAt', state.methodology.cloudExportedAt]] : []),
    ...(state.methodology?.cloudLatestPublishedAt ? [['cloudLatestPublishedAt', state.methodology.cloudLatestPublishedAt]] : []),
    ...(state.methodology?.cloudLatestClearingDate ? [['cloudLatestClearingDate', state.methodology.cloudLatestClearingDate]] : []),
    ...(state.methodology?.cloudLatestRevision ? [['cloudLatestRevision', state.methodology.cloudLatestRevision]] : []),
    ...(state.methodology?.screenshotBackfillSource ? [['screenshotBackfillSource', state.methodology.screenshotBackfillSource]] : []),
  ];
  for (const entry of entries) sheet.addRow(entry);
  styleBody(sheet);
  for (let row = 2; row <= sheet.rowCount; row += 1) sheet.getCell(row, 2).alignment = { vertical: 'top', wrapText: true };
  sheet.getCell('B6').numFmt = '0.0000';
  sheet.getCell('B7').numFmt = '0.00%';
  sheet.getCell('B6').font = { name: 'Aptos', size: 10, color: { argb: 'FF0000FF' } };
  sheet.getCell('B7').font = { name: 'Aptos', size: 10, color: { argb: 'FF0000FF' } };
}

export async function buildIceCdsWorkbook(state) {
  validateState(state);
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'AI Investment Dashboard';
  workbook.lastModifiedBy = 'AI Investment Dashboard';
  workbook.created = new Date(state.generatedAt);
  workbook.modified = new Date(state.generatedAt);
  workbook.calcProperties.fullCalcOnLoad = true;
  writeRawSheet(workbook, state);
  const derived = writeDerivedSheet(workbook, state);
  writeDashboardSheet(workbook, derived);
  writeCurvesSheet(workbook, state);
  writeRegistrySheet(workbook, state);
  writeValidationSheet(workbook, state);
  writeMethodologySheet(workbook, state);
  return Buffer.from(await workbook.xlsx.writeBuffer());
}

function rowValues(sheet, rowNumber) {
  return Array.from({ length: sheet.columnCount }, (_, index) => sheet.getCell(rowNumber, index + 1).value);
}

function readRows(sheet, mapper) {
  const rows = [];
  for (let rowNumber = 2; rowNumber <= sheet.rowCount; rowNumber += 1) {
    const values = rowValues(sheet, rowNumber);
    if (values.every((value) => value === null || value === '')) continue;
    rows.push(mapper(values));
  }
  return rows;
}

function assertWorkbookShape(workbook) {
  const names = workbook.worksheets.map((sheet) => sheet.name);
  if (names.length !== SHEET_NAMES.length || SHEET_NAMES.some((name, index) => names[index] !== name)) {
    throw new Error(`ICE CDS workbook sheets must be exactly: ${SHEET_NAMES.join(', ')}`);
  }
}

function sourceMetadataForDerivedRow(row, { sourceKindColumn, sourceLabelColumn }) {
  const screenshotEvidence = isScreenshotBackfillEvidence({
    batchId: row[0], instrumentName: row[3], curveId: row[11], modelVersion: row[13],
  });
  const explicitSourceKind = sourceKindColumn === undefined ? null : String(row[sourceKindColumn] || '').trim();
  let sourceKind;
  if (explicitSourceKind) {
    if (!['ice_eod_isda', 'screenshot_backfill'].includes(explicitSourceKind)) {
      throw new Error(`Derived Source Kind is invalid: ${explicitSourceKind}`);
    }
    if (screenshotEvidence && explicitSourceKind !== 'screenshot_backfill') {
      throw new Error('Derived Source Kind conflicts with screenshot-backfill evidence');
    }
    if (explicitSourceKind === 'screenshot_backfill' && row[4] !== null && row[4] !== undefined && row[4] !== '') {
      throw new Error('Screenshot-backfill Derived row must not include an ICE EOD Price');
    }
    sourceKind = explicitSourceKind;
  } else {
    sourceKind = screenshotEvidence ? 'screenshot_backfill' : 'ice_eod_isda';
  }
  const sourceLabel = sourceLabelColumn === undefined || typeof row[sourceLabelColumn] !== 'string' || !row[sourceLabelColumn].trim()
    ? sourceKind === 'screenshot_backfill' ? SCREENSHOT_BACKFILL_LABEL : CDS_SOURCE_COPY
    : row[sourceLabelColumn];
  return { sourceKind, sourceLabel };
}

export async function readIceCdsWorkbook(buffer) {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer);
  assertWorkbookShape(workbook);

  const rawRows = readRows(workbook.getWorksheet('Raw EOD Prices'), (row) => ({
    batchId: row[0], clearingDate: isoDate(row[1]), company: row[2], name: row[3], instrumentName: row[4],
    eodPrice: row[5], sourceUrl: sourceUrl(row[6]), importedAt: row[7],
  }));
  const derivedSheet = workbook.getWorksheet('Derived 5Y Spreads');
  const derivedHeaders = new Map(rowValues(derivedSheet, 1).map((value, index) => [String(value || '').trim(), index]));
  const derivedColumn = (label) => derivedHeaders.get(label);
  const sourceUrlColumn = derivedColumn('Source URL');
  if (sourceUrlColumn === undefined) throw new Error('Derived 5Y Spreads must include Source URL');
  const sourceKindColumn = derivedColumn('Source Kind');
  const sourceLabelColumn = derivedColumn('Source Label');
  const derivedRows = readRows(derivedSheet, (row) => {
    const { sourceKind, sourceLabel } = sourceMetadataForDerivedRow(row, { sourceKindColumn, sourceLabelColumn });
    const maturityDate = sourceKind === 'screenshot_backfill' ? null : isoDate(row[7]);
    if (sourceKind === 'ice_eod_isda') dateValue(maturityDate, 'Derived maturity date');
    return {
    batchId: row[0], clearingDate: isoDate(row[1]), company: row[2], instrumentName: row[3], eodPrice: row[4],
    couponBp: row[5], spreadBp: row[6], maturityDate, roundTripPrice: row[8],
    priceResidual: row[9], hazardRate: row[10], curveId: row[11], recoveryRate: row[12],
    modelVersion: row[13], qualityStatus: row[14], officialSpreadBp: row[15], relativeError: row[16],
    sourceKind, sourceLabel, sourceUrl: sourceUrl(row[sourceUrlColumn]),
  };
  });
  const curveRows = readRows(workbook.getWorksheet('Discount Curves'), (row) => ({
    curveId: row[0], asOf: isoDate(row[1]), currency: row[2], years: row[3], zeroRate: row[4],
    sourceLabel: row[5], sourceUrl: sourceUrl(row[6]),
  }));
  const curveMap = new Map();
  for (const row of curveRows) {
    if (!curveMap.has(row.curveId)) {
      curveMap.set(row.curveId, {
        curveId: row.curveId, asOf: row.asOf, currency: row.currency, sourceLabel: row.sourceLabel,
        sourceUrl: row.sourceUrl, nodes: [],
      });
    }
    curveMap.get(row.curveId).nodes.push({ years: row.years, zeroRate: row.zeroRate });
  }
  const registry = readRows(workbook.getWorksheet('Contract Registry'), (row) => ({
    company: row[0], aliases: String(row[1] || '').split(';').map((value) => value.trim()).filter(Boolean),
    symbols: String(row[2] || '').split(';').map((value) => value.trim()).filter(Boolean),
    currency: row[3], tier: row[4], restructuring: row[5], couponBp: row[6],
  }));
  const validationLog = readRows(workbook.getWorksheet('Validation Log'), (row) => ({
    batchId: row[0], createdAt: row[1], level: row[2], code: row[3], company: row[4], message: row[5],
  }));
  const metadata = new Map(readRows(workbook.getWorksheet('Methodology'), (row) => [row[0], row[1]]));
  const methodology = {
    modelVersion: metadata.get('modelVersion'),
    priceTolerance: metadata.get('priceTolerance'),
    relativeBenchmarkTolerance: metadata.get('relativeBenchmarkTolerance'),
    note: metadata.get('note'),
    ...(metadata.has('cloudLatestClearingDate') ? { cloudLatestClearingDate: metadata.get('cloudLatestClearingDate') } : {}),
    ...(metadata.has('cloudLatestRevision') ? { cloudLatestRevision: metadata.get('cloudLatestRevision') } : {}),
    ...(metadata.has('cloudLatestPublishedAt') ? { cloudLatestPublishedAt: metadata.get('cloudLatestPublishedAt') } : {}),
  };
  const state = {
    schemaVersion: metadata.get('schemaVersion'),
    batchId: metadata.get('batchId'),
    generatedAt: metadata.get('generatedAt'),
    rawRows,
    derivedRows,
    curves: [...curveMap.values()],
    registry,
    validationLog,
    methodology,
  };
  validateState(state);
  return state;
}
