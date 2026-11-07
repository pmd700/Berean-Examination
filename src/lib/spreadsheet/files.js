import JSZip from 'jszip';
import { createWorkbook, createSheet, cellAddress, parseCellAddress, sheetBounds, MAX_ROWS, MAX_COLUMNS, translateFormula } from './model.js';
import { createCalculator } from './formulas.js';
import { REFERENCE_VERSION, tableBounds } from './tableReferences.js';
import { excelFormula } from './syntax.js';
const XMLNS = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
const RELNS = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const PACKAGE_RELNS = 'http://schemas.openxmlformats.org/package/2006/relationships';
const WORKSHEET_ORDER = ['sheetPr','dimension','sheetViews','sheetFormatPr','cols','sheetData','sheetCalcPr','sheetProtection','protectedRanges','scenarios','autoFilter','sortState','dataConsolidate','customSheetViews','mergeCells','phoneticPr','conditionalFormatting','dataValidations','hyperlinks','printOptions','pageMargins','pageSetup','headerFooter','rowBreaks','colBreaks','customProperties','cellWatches','ignoredErrors','smartTags','drawing','legacyDrawing','legacyDrawingHF','picture','oleObjects','controls','webPublishItems','tableParts','extLst'];
const MAX_INPUT = 20 * 1024 * 1024, MAX_INFLATED = 64 * 1024 * 1024, MAX_CELLS = 250000;
const el = (node, name) => Array.from(node.getElementsByTagNameNS('*', name));
const first = (node, name) => el(node, name)[0];
const text = (node, name) => first(node, name)?.textContent ?? '';
const xml = (content) => {
  const doc = new DOMParser().parseFromString(content, 'application/xml');
  if (doc.getElementsByTagName('parsererror').length || /<!DOCTYPE|<!ENTITY/i.test(content)) throw new Error('The workbook contains invalid or unsupported XML.');
  return doc;
};
const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[c]));
const xmlHeader = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';
// Native Chromium retains XML processing instructions that jsdom omits.
const serializeXml = doc => xmlHeader + new XMLSerializer().serializeToString(doc).replace(/^\s*<\?xml[^?]*\?>\s*/i, '');
function encode64(bytes) {
  let out = ''; for (let i = 0; i < bytes.length; i += 32768) out += String.fromCharCode(...bytes.subarray(i, i + 32768));
  return btoa(out);
}
function decode64(value) { return Uint8Array.from(atob(value), c => c.charCodeAt(0)); }
function relativePath(base, target) {
  if (target.startsWith('/')) return target.slice(1);
  const parts = base.split('/'); parts.pop();
  for (const p of target.split('/')) { if (p === '..') parts.pop(); else if (p !== '.' && p) parts.push(p); }
  return parts.join('/');
}
function relFile(path) { const p = path.split('/'); return [...p.slice(0, -1), '_rels', `${p.at(-1)}.rels`].join('/'); }
async function readZip(file) {
  const bytes = file instanceof Uint8Array ? file : new Uint8Array(await file.arrayBuffer());
  if (bytes.length > MAX_INPUT) throw new Error('This workbook exceeds the 20 MB import limit.');
  let zip;
  try { zip = await JSZip.loadAsync(bytes); } catch { throw new Error('The Excel file could not be opened. Use an unencrypted .xlsx or .xlsm workbook.'); }
  const entries = Object.values(zip.files);
  if (entries.length > 10000 || entries.reduce((sum, e) => sum + (e._data?.uncompressedSize || 0), 0) > MAX_INFLATED) throw new Error('The expanded workbook exceeds the safe import limit.');
  return { zip, bytes };
}
async function docFrom(zip, path, fallback = null) {
  const f = zip.file(path); if (!f) { if (fallback != null) return xml(fallback); throw new Error(`The workbook is missing ${path}.`); }
  return xml(await f.async('string'));
}
function parseStyles(doc) {
  if (!doc) return [];
  const fonts = first(doc, 'fonts')?.children || [], fills = first(doc, 'fills')?.children || [], borders = first(doc, 'borders')?.children || [];
  const formats = new Map(el(doc, 'numFmt').map(n => [n.getAttribute('numFmtId'), n.getAttribute('formatCode')]));
  const builtIn = { 1: '0', 2: '0.00', 3: '#,##0', 4: '#,##0.00', 9: '0%', 10: '0.00%', 14: 'mm-dd-yy', 49: '@' };
  return Array.from(first(doc, 'cellXfs')?.children || []).map(xf => {
    const font = fonts[Number(xf.getAttribute('fontId'))], fill = fills[Number(xf.getAttribute('fillId'))];
    const style = {};
    if (font && first(font, 'b')) style.bold = true;
    if (font && first(font, 'i')) style.italic = true;
    const color = font && first(font, 'color')?.getAttribute('rgb');
    if (color) style.color = `#${color.slice(-6)}`;
    const bg = fill && first(fill, 'fgColor')?.getAttribute('rgb');
    if (bg) style.background = `#${bg.slice(-6)}`;
    const alignment = first(xf, 'alignment');
    if (alignment?.getAttribute('horizontal')) style.align = alignment.getAttribute('horizontal');
    if (alignment?.getAttribute('wrapText') === '1') { style.wrap = true; style.textMode = 'wrap'; }
    else if (alignment?.hasAttribute('wrapText')) style.textMode = 'overflow';
    const vertical = alignment?.getAttribute('vertical');
    if (['top','center','bottom'].includes(vertical)) style.verticalAlign = vertical === 'center' ? 'middle' : vertical;
    const border = borders[Number(xf.getAttribute('borderId') || 0)], edges = {};
    if (border) for (const side of ['top','right','bottom','left']) {
      const edge = first(border, side), edgeStyle = edge?.getAttribute('style');
      if (!edgeStyle) continue;
      const rgb = first(edge,'color')?.getAttribute('rgb');
      edges[side] = { color: rgb ? `#${rgb.slice(-6)}` : '#000000', width: /^medium/.test(edgeStyle) ? 2 : ['thick','double'].includes(edgeStyle) ? 3 : 1 };
    }
    if (Object.keys(edges).length) style.borders = edges;
    const id = xf.getAttribute('numFmtId');
    if (formats.has(id) || builtIn[id]) style.numberFormat = formats.get(id) || builtIn[id];
    return style;
  });
}
export function parseCsv(content) {
  content = content.replace(/^\uFEFF/, '');
  const counts = { ',': 0, '\t': 0, ';': 0 }; let inQuote = false;
  for (let i=0;i<content.length;i++) { const c=content[i]; if (c === '"') { if (inQuote && content[i+1] === '"') { i++; continue; } inQuote=!inQuote; } else if (!inQuote) { if (c === '\n' || c === '\r') break; if (c in counts) counts[c]++; } }
  const delimiter = Object.keys(counts).sort((a,b) => counts[b]-counts[a])[0];
  const rows = []; let row = [], value = '', quoted = false;
  for (let i = 0; i < content.length; i++) {
    const c = content[i];
    if (c === '"') {
      if (quoted && content[i + 1] === '"') { value += '"'; i++; }
      else if (quoted || value === '') quoted = !quoted;
      else value += c;
    } else if (c === delimiter && !quoted) { row.push(value); value = ''; }
    else if ((c === '\r' || c === '\n') && !quoted) {
      row.push(value); rows.push(row); row = []; value = '';
      if (c === '\r' && content[i + 1] === '\n') i++;
    } else value += c;
    if (rows.length > MAX_ROWS || row.length > MAX_COLUMNS) throw new Error('CSV exceeds Excel row or column limits.');
  }
  if (quoted) throw new Error('The CSV contains an unclosed quoted field.');
  if (value !== '' || row.length) { row.push(value); rows.push(row); }
  return rows;
}
function csvValue(value) {
  if (value === '') return null;
  // Preserve identifiers such as 00012 and long integer IDs without numeric precision loss.
  if (/^[-+]?(?:0|[1-9]\d{0,14})(?:\.\d+)?(?:e[-+]?\d+)?$/i.test(value) && Number.isFinite(Number(value))) return { v: Number(value) };
  return { v: value };
}
async function readWorkbookReferences(zip, sheets, book = null) {
  book ||= await docFrom(zip, 'xl/workbook.xml');
  const restored = [];
  for (const sheet of sheets) {
    if (Array.isArray(sheet.tables)) { restored.push(sheet); continue; }
    const tables = [];
    if (sheet.sourcePath && zip.file(sheet.sourcePath) && zip.file(relFile(sheet.sourcePath))) {
      const doc = await docFrom(zip, sheet.sourcePath), rels = await docFrom(zip, relFile(sheet.sourcePath));
      const parts = new Set(el(doc, 'tablePart').map(p => p.getAttributeNS(RELNS, 'id') || p.getAttribute('r:id')));
      for (const rel of el(rels, 'Relationship')) {
        if (!parts.has(rel.getAttribute('Id')) || !/\/table$/.test(rel.getAttribute('Type')) || rel.getAttribute('TargetMode') === 'External') continue;
        const path = relativePath(sheet.sourcePath, rel.getAttribute('Target'));
        const node = (await docFrom(zip, path)).documentElement;
        const table = {
          name: node.getAttribute('name'), displayName: node.getAttribute('displayName'),
          ref: node.getAttribute('ref'), headerRowCount: Number(node.getAttribute('headerRowCount') ?? 1),
          totalsRowCount: Number(node.getAttribute('totalsRowCount') || 0), sourcePath: path,
          columns: el(node, 'tableColumn').map(c => ({ id: c.getAttribute('id'), name: c.getAttribute('name') })),
        };
        const bounds = tableBounds(table);
        if (!table.name || table.columns.length !== bounds.c1 - bounds.c0 + 1 || ![0, 1].includes(table.headerRowCount) || ![0, 1].includes(table.totalsRowCount)) throw new Error('The workbook contains an invalid Excel table definition.');
        tables.push(table);
      }
    }
    restored.push({ ...sheet, tables });
  }
  const definedNames = el(book, 'definedName').map(n => ({
    name: n.getAttribute('name'), formula: n.textContent,
    ...(n.hasAttribute('localSheetId') ? { sheetId: restored[Number(n.getAttribute('localSheetId'))]?.id } : {}),
  })).filter(n => n.name && n.formula);
  return { sheets: restored, definedNames };
}

// Earlier imports retained the original ZIP, but not table definitions. Restore
// only missing reference metadata, preserving every edited cell and sheet ID.
export async function restoreWorkbookReferences(workbook) {
  if (!workbook || workbook.referenceVersion === REFERENCE_VERSION) return workbook;
  if (!workbook.sourceXlsx) return { ...workbook, referenceVersion: REFERENCE_VERSION };
  const { zip } = await readZip(decode64(workbook.sourceXlsx));
  const refs = await readWorkbookReferences(zip, workbook.sheets);
  return { ...workbook, ...refs, definedNames: workbook.definedNames ?? refs.definedNames, referenceVersion: REFERENCE_VERSION };
}

export async function importWorkbook(file) {
  const name = String(file.name || '').toLowerCase();
  if (file.size > MAX_INPUT) throw new Error('This file exceeds the 20 MB import limit.');
  if (name.endsWith('.csv') || name.endsWith('.tsv')) {
    const content = file.text ? await file.text() : new TextDecoder().decode(await file.arrayBuffer());
    const wb = createWorkbook(), s = wb.sheets[0]; s.name = 'Imported data';
    let count = 0;
    parseCsv(content).forEach((row, r) => row.forEach((value, c) => { const cell = csvValue(value); if (cell) { if (++count > MAX_CELLS) throw new Error('The file exceeds 250,000 populated cells.'); s.cells[cellAddress(r, c)] = cell; } s.columnCount = Math.max(s.columnCount, c + 1); s.rowCount = Math.max(s.rowCount, r + 1); }));
    return wb;
  }
  if (!/\.(xlsx|xlsm)$/i.test(name)) throw new Error('Choose an Excel .xlsx/.xlsm workbook or a .csv file.');
  const { zip, bytes } = await readZip(file);
  const book = await docFrom(zip, 'xl/workbook.xml');
  const rels = await docFrom(zip, 'xl/_rels/workbook.xml.rels');
  const targets = new Map(el(rels, 'Relationship').map(r => [r.getAttribute('Id'), relativePath('xl/workbook.xml', r.getAttribute('Target'))]));
  const strings = zip.file('xl/sharedStrings.xml') ? el(await docFrom(zip, 'xl/sharedStrings.xml'), 'si').map(si => el(si, 't').map(n => n.textContent).join('')) : [];
  const styles = zip.file('xl/styles.xml') ? parseStyles(await docFrom(zip, 'xl/styles.xml')) : [];
  const sheets = [], warnings = new Set(); let count = 0;
  const nodes = el(book, 'sheet');
  if (!nodes.length || nodes.length > 256) throw new Error('The workbook must contain between 1 and 256 sheets.');
  for (const node of nodes) {
    const target = targets.get(node.getAttributeNS(RELNS, 'id') || node.getAttribute('r:id'));
    if (!target) throw new Error('A worksheet relationship is missing.');
    const doc = await docFrom(zip, target), s = createSheet(node.getAttribute('name') || `Sheet${sheets.length + 1}`);
    s.sourcePath = target; s.hidden = node.getAttribute('state') === 'hidden' || node.getAttribute('state') === 'veryHidden';
    const sharedFormulas = new Map(el(doc, 'c').flatMap(c => { const f = first(c, 'f'); return f?.getAttribute('t') === 'shared' && f.textContent ? [[f.getAttribute('si'), { address: c.getAttribute('r'), formula: f.textContent }]] : []; }));
    for (const c of el(doc, 'c')) {
      const addr = c.getAttribute('r'), p = parseCellAddress(addr);
      if (!p) throw new Error('The workbook contains an invalid cell address.');
      if (++count > MAX_CELLS) throw new Error('The workbook exceeds 250,000 populated cells.');
      const type = c.getAttribute('t'), value = text(c, 'v'), formula = first(c, 'f');
      const cell = {};
      if (type === 's') cell.v = strings[Number(value)] ?? '';
      else if (type === 'inlineStr') cell.v = el(c, 't').map(n => n.textContent).join('');
      else if (type === 'b') cell.v = value === '1';
      else if (type === 'str' || type === 'e' || type === 'd') cell.v = value;
      else if (value !== '') cell.v = Number.isFinite(Number(value)) ? Number(value) : value;
      if (type === 'e' && !formula) cell.error = true;
      if (formula) {
        if (formula.textContent) cell.f = formula.textContent;
        else if (formula.getAttribute('t') === 'shared') { const origin = sharedFormulas.get(formula.getAttribute('si')); if (!origin) throw new Error('A shared formula has no source expression.'); const from = parseCellAddress(origin.address); cell.f = translateFormula(origin.formula, p.row - from.row, p.col - from.col); }
        if (formula.getAttribute('t') === 'array') warnings.add('Array formulas are retained in the original package; dynamic array calculation is not supported.');
      }
      if (c.hasAttribute('s')) { cell.rawStyle = Number(c.getAttribute('s')); if (styles[cell.rawStyle] && Object.keys(styles[cell.rawStyle]).length) cell.style = styles[cell.rawStyle]; }
      s.cells[cellAddress(p.row, p.col)] = cell;
      s.rowCount = Math.max(s.rowCount, p.row + 1); s.columnCount = Math.max(s.columnCount, p.col + 1);
    }
    for (const c of el(doc, 'col')) {
      const min = Math.max(0, Number(c.getAttribute('min')) - 1), max = Math.min(MAX_COLUMNS - 1, Number(c.getAttribute('max')) - 1);
      if (Number.isFinite(Number(c.getAttribute('width')))) for (let i = min; i <= max; i++) s.columnWidths[i] = Math.max(24, Math.round(Number(c.getAttribute('width')) * 7 + 5));
    }
    for (const row of el(doc, 'row')) if (row.hasAttribute('ht')) s.rowHeights[Number(row.getAttribute('r')) - 1] = Number(row.getAttribute('ht')) * 4 / 3;
    s.merges = el(doc, 'mergeCell').map(m => m.getAttribute('ref')).filter(ref => ref.split(':').every(parseCellAddress));
    const pane = first(doc, 'pane');
    if (pane && /frozen/.test(pane.getAttribute('state'))) { s.freezeRows = Number(pane.getAttribute('ySplit') || 0); s.freezeColumns = Number(pane.getAttribute('xSplit') || 0); }
    const sheetRels = zip.file(relFile(target)) ? await docFrom(zip, relFile(target)) : null;
    const links = new Map(sheetRels ? el(sheetRels, 'Relationship').filter(r => /\/hyperlink$/.test(r.getAttribute('Type'))).map(r => [r.getAttribute('Id'), r.getAttribute('Target')]) : []);
    for (const link of el(doc, 'hyperlink')) {
      const address = link.getAttribute('ref'), href = links.get(link.getAttributeNS(RELNS, 'id') || link.getAttribute('r:id')) || (link.getAttribute('location') ? `#${link.getAttribute('location')}` : '');
      if (parseCellAddress(address) && href) s.cells[address] = { ...s.cells[address], link: href };
    }
    for (const [key] of Object.entries(s.columnWidths)) s.columnCount = Math.max(s.columnCount, Number(key)+1);
    for (const [key] of Object.entries(s.rowHeights)) s.rowCount = Math.max(s.rowCount, Number(key)+1);
    for (const range of s.merges) for (const address of range.split(':')) { const p=parseCellAddress(address); if(p) { s.rowCount=Math.max(s.rowCount,p.row+1);s.columnCount=Math.max(s.columnCount,p.col+1); } }
    for (const address of Object.keys(s.cells)) { const p=parseCellAddress(address); if(p) {s.rowCount=Math.max(s.rowCount,p.row+1);s.columnCount=Math.max(s.columnCount,p.col+1);} }
    const commentRel = sheetRels && el(sheetRels,'Relationship').find(r => /\/comments$/.test(r.getAttribute('Type')));
    if(commentRel) { const comments = await docFrom(zip,relativePath(target,commentRel.getAttribute('Target'))); for(const c of el(comments,'comment')) { const addr=c.getAttribute('ref');if(parseCellAddress(addr)) s.cells[addr]={...s.cells[addr],note:el(c,'t').map(t=>t.textContent).join('')}; } }
    for(const address of Object.keys(s.cells)) { const p=parseCellAddress(address); if(p){s.rowCount=Math.max(s.rowCount,p.row+1);s.columnCount=Math.max(s.columnCount,p.col+1);} }
    sheets.push(s);
  }
  let savedMeta = null;
  if(zip.file('customXml/bexSpreadsheet.xml')) { try { savedMeta=JSON.parse((await docFrom(zip,'customXml/bexSpreadsheet.xml')).documentElement.textContent); } catch { warnings.add('BEX-specific workbook metadata could not be restored.'); } }
  if(savedMeta?.version === 1 && Array.isArray(savedMeta.sheets)) for(let i=0;i<sheets.length;i++) { const meta=savedMeta.sheets.find(m=>m.path===sheets[i].sourcePath);if(!meta)continue;
    if(typeof meta.id==='string')sheets[i].id=meta.id;
    if(Array.isArray(meta.conditionalRules))sheets[i].conditionalRules=meta.conditionalRules;
    for(const [address,cell] of Object.entries(meta.cells || {})) if(parseCellAddress(address)) { const extras={};if(typeof cell.note==='string')extras.note=cell.note;if(Array.isArray(cell.choices))extras.choices=cell.choices.filter(c=>typeof c==='string'); if(cell.style && typeof cell.style==='object') extras.style={...sheets[i].cells[address]?.style,...cell.style}; sheets[i].cells[address]={...sheets[i].cells[address],...extras}; }
  }
  const names = Object.keys(zip.files);
  const hasMacros = names.some(n => /vbaProject\.bin$/i.test(n));
  if (hasMacros) warnings.add('VBA is preserved for .xlsm export but cannot execute inside BEX.');
  if (names.some(n => /(?:charts|pivotTables|drawings)\//.test(n))) warnings.add('Original charts, drawings and pivot objects are retained for export but are not rendered or recalculated here.');
  if(savedMeta?.charts?.length) warnings.add('BEX charts are restored as BEX charts; native Excel chart rendering is not generated for them.');
  warnings.add('Import preserves cell data, formulas, common formatting and original package parts; advanced Excel features may require Excel.');
  const refs = await readWorkbookReferences(zip, sheets, book);
  return { version: 1, ...refs, referenceVersion: REFERENCE_VERSION, activeSheetId: sheets.find(s => !s.hidden)?.id || sheets[0].id, sourceXlsx: encode64(bytes), hasMacros, ...(Array.isArray(savedMeta?.charts) ? {charts:savedMeta.charts} : {}), importWarnings: [...warnings] };
}
const baseStyles = `${xmlHeader}<styleSheet xmlns="${XMLNS}"><fonts count="1"><font><sz val="11"/><name val="Calibri"/></font></fonts><fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills><borders count="1"><border/></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>`;
function styleWriter(doc) {
  const cache = new Map(), originals = parseStyles(doc);
  const styleOrder = ['numFmts','fonts','fills','borders','cellStyleXfs','cellXfs','cellStyles','dxfs','tableStyles','colors','extLst'];
  const container = (name) => {
    let n = first(doc, name);
    if (!n) { n = doc.createElementNS(XMLNS, name); const next = Array.from(doc.documentElement.children).find(child => styleOrder.indexOf(child.localName) > styleOrder.indexOf(name)); doc.documentElement.insertBefore(n, next || null); }
    return n;
  };
  const appendNode = (name, child) => { const n = container(name), id = n.children.length; n.appendChild(doc.importNode(child,true)); n.setAttribute('count',n.children.length); return id; };
  const fragment = content => xml(`<root xmlns="${XMLNS}">${content}</root>`).documentElement.firstElementChild;
  const replaceChild = (node, name, child) => { for (const n of Array.from(node.children)) if(n.localName === name)n.remove(); if(child)node.appendChild(child); };
  return cell => {
    if (!cell.style || !Object.keys(cell.style).length || (cell.rawStyle != null && JSON.stringify(cell.style) === JSON.stringify(originals[cell.rawStyle] || {}))) return cell.rawStyle || 0;
    const key = JSON.stringify([cell.rawStyle,cell.style]); if(cache.has(key))return cache.get(key);
    const style = cell.style, old = first(doc,'cellXfs')?.children[cell.rawStyle || 0];
    const xf = old ? old.cloneNode(true) : doc.createElementNS(XMLNS,'xf');
    const oldFont = first(doc,'fonts')?.children[Number(old?.getAttribute('fontId') || 0)];
    const font = oldFont ? oldFont.cloneNode(true) : fragment('<font><sz val="11"/><name val="Calibri"/></font>');
    if ('bold' in style) replaceChild(font,'b',style.bold ? doc.createElementNS(XMLNS,'b') : null);
    if ('italic' in style) replaceChild(font,'i',style.italic ? doc.createElementNS(XMLNS,'i') : null);
    if (/^#[\da-f]{6}$/i.test(style.color || '')) replaceChild(font,'color',fragment(`<color rgb="FF${style.color.slice(1).toUpperCase()}"/>`));
    const fontId = appendNode('fonts',font);
    const fillId = /^#[\da-f]{6}$/i.test(style.background || '') ? appendNode('fills',fragment(`<fill><patternFill patternType="solid"><fgColor rgb="FF${style.background.slice(1).toUpperCase()}"/><bgColor indexed="64"/></patternFill></fill>`)) : Number(old?.getAttribute('fillId') || 0);
    let numFmt = Number(old?.getAttribute('numFmtId') || 0);
    if (style.numberFormat != null) {
      if (!style.numberFormat) numFmt = 0;
      else { const formats=container('numFmts'), found=Array.from(formats.children).find(n=>n.getAttribute('formatCode')===style.numberFormat);
        if(found)numFmt=Number(found.getAttribute('numFmtId')); else { numFmt=Math.max(163,...Array.from(formats.children).map(n=>Number(n.getAttribute('numFmtId'))))+1; appendNode('numFmts',fragment(`<numFmt numFmtId="${numFmt}" formatCode="${esc(style.numberFormat)}"/>`)); }
      }
    }
    for (const [name,value] of Object.entries({fontId,fillId,numFmtId:numFmt,applyFont:1,applyFill:1,applyNumberFormat:1}))xf.setAttribute(name,value);
    if ('borders' in style) {
      const oldBorder = first(doc,'borders')?.children[Number(old?.getAttribute('borderId') || 0)];
      const border=oldBorder?oldBorder.cloneNode(true):doc.createElementNS(XMLNS,'border');
      for(const side of ['left','right','top','bottom']) {
        const edge=style.borders?.[side], n=doc.createElementNS(XMLNS,side);
        if(edge && [1,2,3,4].includes(edge.width)) {n.setAttribute('style',edge.width===1?'thin':edge.width===2?'medium':'thick'); const color=doc.createElementNS(XMLNS,'color');color.setAttribute('rgb',`FF${(/^#[\da-f]{6}$/i.test(edge.color || '')?edge.color:'#000000').slice(1).toUpperCase()}`);n.appendChild(color);}
        replaceChild(border,side,n);
      }
      const edgeOrder=['start','end','left','right','top','bottom','diagonal','vertical','horizontal'];
      for(const n of Array.from(border.children).sort((a,b)=>edgeOrder.indexOf(a.localName)-edgeOrder.indexOf(b.localName)))border.appendChild(n);
      xf.setAttribute('borderId',appendNode('borders',border));xf.setAttribute('applyBorder','1');
    }
    let align=first(xf,'alignment'); if(!align){align=doc.createElementNS(XMLNS,'alignment');xf.appendChild(align);}
    if(style.align)align.setAttribute('horizontal',style.align);
    if(['top','middle','bottom'].includes(style.verticalAlign))align.setAttribute('vertical',style.verticalAlign==='middle'?'center':style.verticalAlign);
    if(style.textMode)align.setAttribute('wrapText',style.textMode==='wrap'?'1':'0');else if('wrap'in style)align.setAttribute('wrapText',style.wrap?'1':'0');
    xf.setAttribute('applyAlignment','1');
    const id=appendNode('cellXfs',xf);cache.set(key,id);return id;
  };
}
export async function exportXlsx(workbook) {
  if (!workbook?.sheets?.length) throw new Error('The workbook has no sheets.');
  workbook = await restoreWorkbookReferences(workbook);
  const zip = workbook.sourceXlsx ? (await readZip(decode64(workbook.sourceXlsx))).zip : new JSZip();
  const styleDoc = await docFrom(zip, 'xl/styles.xml', baseStyles), styleId = styleWriter(styleDoc), calc = createCalculator(workbook);
  let previousMeta=null; if(zip.file('customXml/bexSpreadsheet.xml')) {try {previousMeta=JSON.parse((await docFrom(zip,'customXml/bexSpreadsheet.xml')).documentElement.textContent);} catch { /* Original opaque metadata is replaced by this export. */ }}
  const usedPaths = new Set(), savedSheets = [];
  const originalTables = new Map();
  for (const sheet of workbook.sheets) for (const table of sheet.tables || []) {
    if (table.sourcePath && zip.file(table.sourcePath) && !originalTables.has(table.sourcePath)) originalTables.set(table.sourcePath, await zip.file(table.sourcePath).async('string'));
  }
  const relations = zip.file('xl/_rels/workbook.xml.rels') ? await docFrom(zip, 'xl/_rels/workbook.xml.rels') : xml(`<Relationships xmlns="${PACKAGE_RELNS}"/>`);
  for (const rel of el(relations, 'Relationship')) if (/\/(?:worksheet|calcChain)$/.test(rel.getAttribute('Type'))) rel.remove();
  const book = zip.file('xl/workbook.xml') ? await docFrom(zip, 'xl/workbook.xml') : xml(`<workbook xmlns="${XMLNS}" xmlns:r="${RELNS}"><sheets/></workbook>`);
  let sheetNodes = first(book, 'sheets'); if (!sheetNodes) { sheetNodes = book.createElementNS(XMLNS, 'sheets'); book.documentElement.appendChild(sheetNodes); }
  sheetNodes.replaceChildren();
  const types = zip.file('[Content_Types].xml') ? await docFrom(zip, '[Content_Types].xml') : xml('<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/></Types>');
  const addOverride = (path, contentType) => { let n = el(types, 'Override').find(n => n.getAttribute('PartName') === `/${path}`); if (!n) { n = types.createElementNS(types.documentElement.namespaceURI, 'Override'); n.setAttribute('PartName', `/${path}`); types.documentElement.appendChild(n); } n.setAttribute('ContentType', contentType); };
  for (let index = 0; index < workbook.sheets.length; index++) {
    const sheet = workbook.sheets[index], path = sheet.sourcePath && !usedPaths.has(sheet.sourcePath) ? sheet.sourcePath : `xl/worksheets/bex-${index+1}-${sheet.id}.xml`, rid = `bexSheet${index + 1}`;
    usedPaths.add(path);
    savedSheets.push({id:sheet.id,path,conditionalRules:sheet.conditionalRules||[],cells:Object.fromEntries(Object.entries(sheet.cells).filter(([,c])=>c.note!=null||c.choices||c.style?.textMode||c.style?.verticalAlign||c.style?.borders).map(([a,c])=>[a,{...(c.note!=null?{note:c.note}:{}),...(c.choices?{choices:c.choices}:{}),...(c.style?{style:Object.fromEntries(Object.entries(c.style).filter(([k])=>['textMode','verticalAlign','borders'].includes(k)))}:{})}]))});
    const rel = relations.createElementNS(PACKAGE_RELNS, 'Relationship'); rel.setAttribute('Id', rid); rel.setAttribute('Type', `${RELNS}/worksheet`); rel.setAttribute('Target', path.slice(3)); relations.documentElement.appendChild(rel);
    const sn = book.createElementNS(XMLNS, 'sheet'); sn.setAttribute('name', sheet.name); sn.setAttribute('sheetId', index + 1); sn.setAttributeNS(RELNS, 'r:id', rid); if (sheet.hidden) sn.setAttribute('state', 'hidden'); sheetNodes.appendChild(sn);
    const rows = new Map();
    for (const [address, cell] of Object.entries(sheet.cells)) {
      const p = parseCellAddress(address); if (!p) continue;
      let value = cell.f ? calc(sheet.id, address) : cell.v;
      let type = '', body = cell.f ? `<f>${esc(excelFormula(cell.f))}</f>` : '';
      if (typeof value === 'number') body += `<v>${Number.isFinite(value) ? value : 0}</v>`;
      else if (typeof value === 'boolean') { type = 'b'; body += `<v>${value ? 1 : 0}</v>`; }
      else if ((cell.f || cell.error) && typeof value === 'string' && /^#(?:REF!|DIV\/0!|VALUE!|NAME\?|NUM!|N\/A)$/.test(value)) { type = 'e'; body += `<v>${esc(value)}</v>`; }
      else if (value != null) { type = cell.f ? 'str' : 'inlineStr'; body += cell.f ? `<v>${esc(value)}</v>` : `<is><t xml:space="preserve">${esc(value)}</t></is>`; }
      const row = rows.get(p.row) || []; row.push({ col: p.col, content: `<c r="${address}" s="${styleId(cell)}"${type ? ` t="${type}"` : ''}>${body}</c>` }); rows.set(p.row, row);
    }
    for (const r of Object.keys(sheet.rowHeights || {})) if (!rows.has(Number(r))) rows.set(Number(r), []);
    const rowXml = [...rows].sort(([a], [b]) => a - b).map(([r, cells]) => `<row r="${r + 1}"${sheet.rowHeights?.[r] ? ` ht="${sheet.rowHeights[r] * 3 / 4}" customHeight="1"` : ''}>${cells.sort((a, b) => a.col - b.col).map(c => c.content).join('')}</row>`).join('');
    const cols = Object.entries(sheet.columnWidths || {}).map(([c, width]) => `<col min="${Number(c) + 1}" max="${Number(c) + 1}" width="${Math.max(1, (width - 5) / 7)}" customWidth="1"/>`).join('');
    const bounds = sheetBounds(sheet), dimension = `A1:${cellAddress(Math.max(0, bounds.rows - 1), Math.max(0, bounds.columns - 1))}`;
    const sheetDoc = zip.file(path) ? await docFrom(zip, path) : xml(`<worksheet xmlns="${XMLNS}" xmlns:r="${RELNS}"/>`);
    // Preserve unrelated drawings, print settings and original comments, replacing the editable cell structures only.
    const replacements = xml(`<worksheet xmlns="${XMLNS}" xmlns:r="${RELNS}"><dimension ref="${dimension}"/><sheetViews><sheetView workbookViewId="0">${sheet.freezeRows || sheet.freezeColumns ? `<pane xSplit="${sheet.freezeColumns || 0}" ySplit="${sheet.freezeRows || 0}" topLeftCell="${cellAddress(sheet.freezeRows || 0, sheet.freezeColumns || 0)}" activePane="bottomRight" state="frozen"/>` : ''}</sheetView></sheetViews>${cols ? `<cols>${cols}</cols>` : ''}<sheetData>${rowXml}</sheetData>${sheet.merges?.length ? `<mergeCells count="${sheet.merges.length}">${sheet.merges.map(ref => `<mergeCell ref="${esc(ref)}"/>`).join('')}</mergeCells>` : ''}</worksheet>`);
    for (const name of ['dimension', 'sheetViews', 'cols', 'sheetData', 'mergeCells', 'hyperlinks']) for (const n of el(sheetDoc, name)) n.remove();
    const afterData = sheetDoc.documentElement.firstChild;
    for (const n of Array.from(replacements.documentElement.children)) sheetDoc.documentElement.insertBefore(sheetDoc.importNode(n, true), afterData);
    const sr = zip.file(relFile(path)) ? await docFrom(zip, relFile(path)) : xml(`<Relationships xmlns="${PACKAGE_RELNS}"/>`);
    for (const n of el(sr, 'Relationship')) if (/\/hyperlink$/.test(n.getAttribute('Type'))) n.remove();
    // Keep native Excel tables (and their original style/calculated columns),
    // rather than replacing structured formula text with hardcoded ranges.
    if (Array.isArray(sheet.tables)) {
      for (const n of el(sr, 'Relationship')) if (/\/table$/.test(n.getAttribute('Type'))) n.remove();
      for (const n of el(sheetDoc, 'tableParts')) n.remove();
      if (sheet.tables.length) {
        const parts = sheetDoc.createElementNS(XMLNS, 'tableParts');
        for (const [ti, table] of sheet.tables.entries()) {
          tableBounds(table);
          const tablePath = `xl/tables/bex-${index + 1}-${ti + 1}.xml`, tableRid = `bexTable${ti + 1}`;
          const tableDoc = originalTables.has(table.sourcePath)
            ? xml(originalTables.get(table.sourcePath))
            : xml(`<table xmlns="${XMLNS}"><tableColumns>${table.columns.map((c, ci) => `<tableColumn id="${ci + 1}" name="${esc(typeof c === 'string' ? c : c.name)}"/>`).join('')}</tableColumns></table>`);
          const root = tableDoc.documentElement;
          const tableId = workbook.sheets.slice(0, index).reduce((sum, s) => sum + (s.tables?.length || 0), 0) + ti + 1;
          for (const [key, value] of Object.entries({ id: tableId, name: table.name, displayName: table.displayName || table.name, ref: table.ref, headerRowCount: table.headerRowCount ?? 1, totalsRowCount: table.totalsRowCount || 0 })) root.setAttribute(key, value);
          const filter = first(root, 'autoFilter');
          if (filter) { const b = tableBounds(table); filter.setAttribute('ref', `${cellAddress(b.r0, b.c0)}:${cellAddress(b.r1 - (table.totalsRowCount || 0), b.c1)}`); }
          const columns = first(root, 'tableColumns');
          if (columns) { columns.setAttribute('count', table.columns.length); [...columns.children].forEach((c, ci) => { if (table.columns[ci]) c.setAttribute('name', typeof table.columns[ci] === 'string' ? table.columns[ci] : table.columns[ci].name); }); }
          zip.file(tablePath, serializeXml(tableDoc));
          addOverride(tablePath, 'application/vnd.openxmlformats-officedocument.spreadsheetml.table+xml');
          const relation = sr.createElementNS(PACKAGE_RELNS, 'Relationship');
          relation.setAttribute('Id', tableRid); relation.setAttribute('Type', `${RELNS}/table`); relation.setAttribute('Target', `/${tablePath}`); sr.documentElement.appendChild(relation);
          const part = sheetDoc.createElementNS(XMLNS, 'tablePart'); part.setAttributeNS(RELNS, 'r:id', tableRid); parts.appendChild(part);
        }
        parts.setAttribute('count', sheet.tables.length); sheetDoc.documentElement.appendChild(parts);
      }
    }
    const dropdowns = Object.entries(sheet.cells).filter(([,c])=>c.choices?.length && c.choices.join(',').length<=253 && c.choices.every(v=>!/[",\r\n]/.test(v)));
    if(dropdowns.length) { let list=first(sheetDoc,'dataValidations');if(!list){list=sheetDoc.createElementNS(XMLNS,'dataValidations');sheetDoc.documentElement.appendChild(list);}for(const [address,c]of dropdowns){for(const old of el(list,'dataValidation'))if(old.getAttribute('sqref')===address)old.remove();const n=sheetDoc.createElementNS(XMLNS,'dataValidation');n.setAttribute('type','list');n.setAttribute('allowBlank','1');n.setAttribute('sqref',address);const f=sheetDoc.createElementNS(XMLNS,'formula1');f.textContent='"'+c.choices.join(',')+'"';n.appendChild(f);list.appendChild(n);}list.setAttribute('count',list.children.length); }
    const previousRules=previousMeta?.sheets?.find(s=>s.path===sheet.sourcePath)?.conditionalRules||[];
    for(const cf of el(sheetDoc,'conditionalFormatting')) {for(const cfr of el(cf,'cfRule')) if(cfr.getAttribute('type')==='cellIs' && cfr.getAttribute('operator')==='greaterThan' && previousRules.some(rule=>rule.range===cf.getAttribute('sqref') && String(rule.greaterThan)===text(cfr,'formula'))) cfr.remove();if(!cf.children.length)cf.remove();}
    if(sheet.conditionalRules?.length) for(const rule of sheet.conditionalRules) {
      if(!/^#[\da-f]{6}$/i.test(rule.color||'') || !Number.isFinite(rule.greaterThan) || !String(rule.range).split(':').every(parseCellAddress))continue;
      let dxfs=first(styleDoc,'dxfs');if(!dxfs){dxfs=styleDoc.createElementNS(XMLNS,'dxfs');styleDoc.documentElement.appendChild(dxfs);}const dxfId=dxfs.children.length;
      const dxf=xml(`<dxf xmlns="${XMLNS}"><fill><patternFill patternType="solid"><fgColor rgb="FF${rule.color.slice(1).toUpperCase()}"/><bgColor indexed="64"/></patternFill></fill></dxf>`).documentElement;dxfs.appendChild(styleDoc.importNode(dxf,true));dxfs.setAttribute('count',dxfs.children.length);
      const cf=sheetDoc.createElementNS(XMLNS,'conditionalFormatting');cf.setAttribute('sqref',rule.range);const cfr=sheetDoc.createElementNS(XMLNS,'cfRule');cfr.setAttribute('type','cellIs');cfr.setAttribute('operator','greaterThan');cfr.setAttribute('dxfId',dxfId);cfr.setAttribute('priority',el(sheetDoc,'cfRule').length+1);const f=sheetDoc.createElementNS(XMLNS,'formula');f.textContent=String(rule.greaterThan);cfr.appendChild(f);cf.appendChild(cfr);sheetDoc.documentElement.appendChild(cf);
    }
    const notes=Object.entries(sheet.cells).filter(([,c])=>typeof c.note==='string'&&c.note.length);
    const oldCommentRels=el(sr,'Relationship').filter(r=>/\/comments$/.test(r.getAttribute('Type')));for(const r of oldCommentRels)r.remove();
    if(notes.length){const notePath=`xl/comments/bex-${index+1}.xml`;zip.file(notePath,`${xmlHeader}<comments xmlns="${XMLNS}"><authors><author>BEX</author></authors><commentList>${notes.map(([a,c])=>`<comment ref="${a}" authorId="0"><text><t xml:space="preserve">${esc(c.note)}</t></text></comment>`).join('')}</commentList></comments>`);addOverride(notePath,'application/vnd.openxmlformats-officedocument.spreadsheetml.comments+xml');const r=sr.createElementNS(PACKAGE_RELNS,'Relationship');r.setAttribute('Id','bexComments');r.setAttribute('Type',`${RELNS}/comments`);r.setAttribute('Target',`/${notePath}`);sr.documentElement.appendChild(r);}
    const links = Object.entries(sheet.cells).filter(([, c]) => c.link);
    if (links.length) {
      const h = sheetDoc.createElementNS(XMLNS, 'hyperlinks');
      links.forEach(([address, cell], i) => {
        const n = sheetDoc.createElementNS(XMLNS, 'hyperlink'); n.setAttribute('ref', address);
        if (cell.link.startsWith('#')) n.setAttribute('location', cell.link.slice(1));
        else { const id = `bexLink${i + 1}`; n.setAttributeNS(RELNS, 'r:id', id); const r = sr.createElementNS(PACKAGE_RELNS, 'Relationship'); r.setAttribute('Id', id); r.setAttribute('Type', `${RELNS}/hyperlink`); r.setAttribute('Target', cell.link); r.setAttribute('TargetMode', 'External'); sr.documentElement.appendChild(r); }
        h.appendChild(n);
      });
      const before = Array.from(sheetDoc.documentElement.children).find(n => ['printOptions', 'pageMargins', 'pageSetup', 'headerFooter', 'drawing', 'legacyDrawing', 'extLst'].includes(n.localName));
      sheetDoc.documentElement.insertBefore(h, before || null);
    }
    for (const child of Array.from(sheetDoc.documentElement.children).sort((a,b) => WORKSHEET_ORDER.indexOf(a.localName) - WORKSHEET_ORDER.indexOf(b.localName))) sheetDoc.documentElement.appendChild(child);
    zip.file(path, serializeXml(sheetDoc));
    if (sr.documentElement.children.length) zip.file(relFile(path), serializeXml(sr));
    addOverride(path, 'application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml');
  }
  if (Array.isArray(workbook.definedNames)) {
    for (const old of el(book, 'definedNames')) old.remove();
    const names = book.createElementNS(XMLNS, 'definedNames');
    for (const definition of workbook.definedNames) {
      const index = definition.sheetId ? workbook.sheets.findIndex(s => s.id === definition.sheetId) : -1;
      if (definition.sheetId && index < 0) continue;
      const n = book.createElementNS(XMLNS, 'definedName'); n.setAttribute('name', definition.name);
      if (index >= 0) n.setAttribute('localSheetId', index);
      n.textContent = definition.formula; names.appendChild(n);
    }
    if (names.children.length) book.documentElement.insertBefore(names, first(book, 'calcPr') || null);
  }
  let calcPr = first(book, 'calcPr'); if (!calcPr) { calcPr = book.createElementNS(XMLNS, 'calcPr'); book.documentElement.appendChild(calcPr); } calcPr.setAttribute('fullCalcOnLoad', '1'); calcPr.setAttribute('forceFullCalc', '1');
  zip.remove('xl/calcChain.xml'); for (const n of el(types, 'Override')) if (n.getAttribute('PartName') === '/xl/calcChain.xml') n.remove();
  if (!el(relations, 'Relationship').some(r => /\/styles$/.test(r.getAttribute('Type')))) { const r = relations.createElementNS(PACKAGE_RELNS, 'Relationship'); r.setAttribute('Id', 'bexStyles'); r.setAttribute('Type', `${RELNS}/styles`); r.setAttribute('Target', 'styles.xml'); relations.documentElement.appendChild(r); }
  addOverride('xl/workbook.xml', workbook.hasMacros ? 'application/vnd.ms-excel.sheet.macroEnabled.main+xml' : 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml');
  addOverride('xl/styles.xml', 'application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml');
  if (!zip.file('_rels/.rels')) zip.file('_rels/.rels', `${xmlHeader}<Relationships xmlns="${PACKAGE_RELNS}"><Relationship Id="rId1" Type="${RELNS}/officeDocument" Target="xl/workbook.xml"/></Relationships>`);
  const metadata = {version:1,sheets:savedSheets,charts:workbook.charts||[]};
  zip.file('customXml/bexSpreadsheet.xml',`${xmlHeader}<bexWorkbook xmlns="urn:bex:spreadsheet:1">${esc(JSON.stringify(metadata))}</bexWorkbook>`);
  // A standard custom-XML relationship keeps BEX-only chart/rule/note metadata alongside ordinary Excel cells.
  const rootRels = await docFrom(zip,'_rels/.rels');
  if(!el(rootRels,'Relationship').some(r=>r.getAttribute('Target')==='customXml/bexSpreadsheet.xml')) {const r=rootRels.createElementNS(PACKAGE_RELNS,'Relationship');r.setAttribute('Id','bexMetadata');r.setAttribute('Type',`${RELNS}/customXml`);r.setAttribute('Target','customXml/bexSpreadsheet.xml');rootRels.documentElement.appendChild(r);}
  zip.file('_rels/.rels',serializeXml(rootRels));
  zip.file('xl/workbook.xml', serializeXml(book));
  zip.file('xl/_rels/workbook.xml.rels', serializeXml(relations));
  zip.file('xl/styles.xml', serializeXml(styleDoc));
  zip.file('[Content_Types].xml', serializeXml(types));
  return zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE', compressionOptions: { level: 6 } });
}
export function exportCsv(sheet, workbook = { sheets: [sheet] }) {
  const { rows, columns } = sheetBounds(sheet), calc = createCalculator(workbook);
  if (rows * columns > 2000000) throw new Error('This sparse sheet is too wide for a dense CSV export; use Excel export.');
  const result = [];
  for (let r = 0; r < rows; r++) {
    const row = [];
    for (let c = 0; c < columns; c++) { const value = String(calc(sheet.id, cellAddress(r, c)) ?? ''); row.push(/[",\r\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value); }
    result.push(row.join(','));
  }
  return '\uFEFF' + result.join('\r\n');
}
