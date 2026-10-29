'use strict';

// Convert THIS Mac's installed sbix artwork into the browser's CBDT path.
// Apple font bytes are never bundled, uploaded, or committed. No Python/native
// addon dependency; only standard OpenType tables and the built-in Node Buffer.
const FAMILY = 'BEX Native Apple Emoji';
const PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
const u16 = (value) => { const b = Buffer.alloc(2); b.writeUInt16BE(value); return b; };
const u32 = (value) => { const b = Buffer.alloc(4); b.writeUInt32BE(value >>> 0); return b; };
const join = (parts) => Buffer.concat(parts);

function tablesFromCollection(bytes) {
  if (!Buffer.isBuffer(bytes) || bytes.length < 32) throw new Error('Invalid system font.');
  const base = bytes.toString('ascii', 0, 4) === 'ttcf' ? bytes.readUInt32BE(12) : 0;
  const count = bytes.readUInt16BE(base + 4);
  if (count < 5 || count > 100) throw new Error('Invalid system font directory.');
  const tables = new Map();
  for (let index = 0; index < count; index += 1) {
    const entry = base + 12 + index * 16;
    const tag = bytes.toString('ascii', entry, entry + 4);
    const offset = bytes.readUInt32BE(entry + 8), size = bytes.readUInt32BE(entry + 12);
    if (offset + size > bytes.length) throw new Error('Invalid system font table bounds.');
    tables.set(tag, bytes.subarray(offset, offset + size));
  }
  return tables;
}

function characterMap(cmap) {
  let selected;
  for (let index = 0; index < cmap.readUInt16BE(2); index += 1) {
    const offset = cmap.readUInt32BE(4 + index * 8 + 4);
    if (cmap.readUInt16BE(offset) === 12) { selected = offset; break; }
  }
  if (selected === undefined) throw new Error('System emoji font has no Unicode map.');
  const result = new Map();
  const groups = cmap.readUInt32BE(selected + 12);
  for (let index = 0; index < groups; index += 1) {
    const offset = selected + 16 + index * 12;
    const start = cmap.readUInt32BE(offset), end = cmap.readUInt32BE(offset + 4), glyph = cmap.readUInt32BE(offset + 8);
    if (end < start || end > 0x10ffff || end - start > 0x10000) throw new Error('Invalid emoji mapping range.');
    for (let cp = start; cp <= end; cp += 1) result.set(cp, glyph + cp - start);
  }
  return result;
}

function bitmapTables(tables) {
  const sbix = tables.get('sbix'), head = tables.get('head'), hhea = tables.get('hhea');
  const count = tables.get('maxp').readUInt16BE(4), units = head.readUInt16BE(18);
  const strikes = sbix.readUInt32BE(4);
  let strike;
  for (let index = 0; index < strikes; index += 1) {
    const offset = sbix.readUInt32BE(8 + index * 4);
    if (sbix.readUInt16BE(offset) === 64) { strike = offset; break; }
  }
  if (strike === undefined) throw new Error('System emoji font has no supported bitmap size.');
  const glyphData = tables.get('glyf'), loca = tables.get('loca'), hmtx = tables.get('hmtx');
  const longLoca = head.readInt16BE(50) === 1;
  const metricCount = hhea.readUInt16BE(34);
  const scale = 64 / units;
  // sbix artwork occupies a square above its design origin. A CBDT bitmap
  // needs an explicit baseline within that square; otherwise its bottom sits
  // on the text baseline and faces float above adjacent letters. Preserve the
  // source font's typographic descender share (Apple: 250 / 1000 = 1/4 em).
  const os2 = tables.get('OS/2');
  const typoAscent = os2.readInt16BE(68), typoDescent = os2.readInt16BE(70);
  const baselineOffset = Math.round(64 * Math.max(0, -typoDescent) / (typoAscent - typoDescent));
  const offsets = [], glyphOffsets = [], advances = [], bitmapGlyphs = new Set();
  const parts = [u32(0x00030000)];
  let size = 0;
  for (let id = 0; id < count; id += 1) {
    const glyphOffset = longLoca ? loca.readUInt32BE(id * 4) : loca.readUInt16BE(id * 2) * 2;
    glyphOffsets.push(glyphOffset);
    advances.push(hmtx.readUInt16BE(Math.min(id, metricCount - 1) * 4));
    offsets.push(size);
    const start = sbix.readUInt32BE(strike + 4 + id * 4), end = sbix.readUInt32BE(strike + 8 + id * 4);
    if (end <= start || end - start < 8) continue;
    const data = sbix.subarray(strike + start, strike + end);
    if (data.toString('ascii', 4, 8) !== 'png ') continue;
    const png = data.subarray(8);
    if (!png.subarray(0, 8).equals(PNG_SIGNATURE)) throw new Error('Invalid system emoji bitmap.');
    const width = png.readUInt32BE(16), height = png.readUInt32BE(20);
    if (!width || !height || width > 255 || height > 255) throw new Error('Unsupported emoji bitmap metrics.');
    const nextGlyph = longLoca ? loca.readUInt32BE((id + 1) * 4) : loca.readUInt16BE((id + 1) * 2) * 2;
    const yMin = nextGlyph > glyphOffset ? glyphData.readInt16BE(glyphOffset + 4) : 0;
    const metrics = Buffer.alloc(9);
    metrics[0] = height; metrics[1] = width;
    metrics.writeInt8(data.readInt16BE(0), 2);
    metrics.writeInt8(height + data.readInt16BE(2) + Math.round(yMin * scale) - baselineOffset, 3);
    metrics[4] = Math.round(advances[id] * scale);
    metrics.writeUInt32BE(png.length, 5);
    parts.push(metrics, png); size += metrics.length + png.length;
    bitmapGlyphs.add(id);
  }
  offsets.push(size);
  glyphOffsets.push(longLoca ? loca.readUInt32BE(count * 4) : loca.readUInt16BE(count * 2) * 2);
  const location = Buffer.alloc(56);
  location.writeUInt32BE(0x00030000, 0); location.writeUInt32BE(1, 4);
  location.writeUInt32BE(56, 8); location.writeUInt32BE(16 + offsets.length * 4, 12);
  location.writeUInt32BE(1, 16);
  for (const offset of [24, 36]) {
    location.writeInt8(Math.round(hhea.readInt16BE(4) * scale), offset);
    location.writeInt8(Math.round(hhea.readInt16BE(6) * scale), offset + 1);
    location[offset + 2] = 80; location[offset + 3] = 1;
  }
  location.writeUInt16BE(count - 1, 50);
  location[52] = 64; location[53] = 64; location[54] = 32; location[55] = 1;
  const index = join([u16(0), u16(count - 1), u32(8), u16(1), u16(17), u32(4), ...offsets.map(u32)]);
  return { cbdt: join(parts), cblc: join([location, index]), count, glyphOffsets, advances, bitmapGlyphs };
}

function coverage(glyphs) { return join([u16(1), u16(glyphs.length), ...glyphs.map(u16)]); }

function substitutionTables(cmap, sequences, shaped, bitmaps) {
  if (sequences.length !== shaped.length) throw new Error('Incomplete native emoji shape map.');
  const rules = new Map(), expansions = new Map();
  for (let index = 0; index < sequences.length; index += 1) {
    const input = Array.from(sequences[index], (cp) => cmap.get(cp.codePointAt(0)));
    const output = shaped[index];
    if (input.length < 2 || input.some((id) => !Number.isInteger(id) || id < 1)
      || !Array.isArray(output) || output.length < 1 || output.some((id) => !bitmaps.bitmapGlyphs.has(id))) continue;
    let target = output[0];
    if (output.length > 1) {
      const key = output.join(',');
      if (!expansions.has(key)) expansions.set(key, { id: bitmaps.count + expansions.size, output });
      target = expansions.get(key).id;
    }
    const key = input.join(',');
    if (rules.has(key) && rules.get(key).target !== target) throw new Error('Ambiguous native emoji shaping.');
    rules.set(key, { input, target });
  }
  const groups = new Map();
  for (const rule of rules.values()) {
    const first = rule.input[0];
    if (!groups.has(first)) groups.set(first, []);
    groups.get(first).push(rule);
  }
  const subtables = [];
  for (const [first, group] of [...groups].sort(([a], [b]) => a - b)) {
    group.sort((a, b) => b.input.length - a.input.length);
    const ligatures = group.map(({ input, target }) => join([u16(target), u16(input.length), ...input.slice(1).map(u16)]));
    let offset = 2 + group.length * 2;
    const ligatureOffsets = ligatures.map((bytes) => { const current = offset; offset += bytes.length; return u16(current); });
    const set = join([u16(group.length), ...ligatureOffsets, ...ligatures]);
    subtables.push(join([u16(1), u16(8 + set.length), u16(1), u16(8), set, coverage([first])]));
  }
  // Extension lookup keeps all offsets valid even when the complete emoji
  // sequence set is larger than a 16-bit OpenType subtable offset.
  let offset = subtables.length * 8;
  const wrappers = subtables.map((subtable, index) => {
    const wrapper = join([u16(1), u16(4), u32(offset - index * 8)]);
    offset += subtable.length; return wrapper;
  });
  const lookup1Header = 6 + subtables.length * 2;
  const lookup1 = join([u16(7), u16(0), u16(subtables.length), ...subtables.map((_, index) => u16(lookup1Header + index * 8)), ...wrappers, ...subtables]);
  const expansionEntries = [...expansions.values()];
  const outputs = expansionEntries.map(({ output }) => join([u16(output.length), ...output.map(u16)]));
  offset = 6 + outputs.length * 2;
  const outputOffsets = outputs.map((bytes) => { const current = offset; offset += bytes.length; return u16(current); });
  const multi = join([u16(1), u16(offset), u16(outputs.length), ...outputOffsets, ...outputs, coverage(expansionEntries.map(({ id }) => id))]);
  const lookup2 = join([u16(2), u16(0), u16(1), u16(8), multi]);
  // Lookup-list offsets are also 16-bit. Place the short multiple-substitution
  // lookup physically before the long extension lookup. Lookup index 0 must
  // still be the ligatures: shapers apply lookup indices in increasing order.
  const lookupList = join([u16(2), u16(6 + lookup2.length), u16(6), lookup2, lookup1]);
  const script = join([u16(1), Buffer.from('DFLT'), u16(8), u16(4), u16(0), u16(0), u16(0xffff), u16(1), u16(0)]);
  const features = join([u16(1), Buffer.from('ccmp'), u16(8), u16(0), u16(2), u16(0), u16(1)]);
  return { gsub: join([u32(0x00010000), u16(10), u16(10 + script.length), u16(10 + script.length + features.length), script, features, lookupList]), extraGlyphs: expansions.size };
}

function fontName() {
  const entries = [[1, FAMILY], [2, 'Regular'], [4, FAMILY], [6, 'BEXNativeAppleEmoji']];
  const strings = entries.map(([, value]) => Buffer.from(value, 'utf16le').swap16());
  let offset = 0;
  const records = entries.map(([id], index) => {
    const record = join([u16(3), u16(1), u16(0x409), u16(id), u16(strings[index].length), u16(offset)]);
    offset += strings[index].length; return record;
  });
  return join([u16(0), u16(records.length), u16(6 + records.length * 12), ...records, ...strings]);
}

function checksum(bytes) {
  let sum = 0;
  for (let offset = 0; offset < bytes.length; offset += 4) sum = (sum + bytes.readUInt32BE(offset)) >>> 0;
  return sum;
}

function buildSfnt(tables) {
  const entries = [...tables].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0);
  const count = entries.length, power = 2 ** Math.floor(Math.log2(count));
  const header = join([u32(0x00010000), u16(count), u16(power * 16), u16(Math.log2(power)), u16(count * 16 - power * 16)]);
  const directory = [], chunks = [];
  let offset = 12 + count * 16, headOffset;
  for (const [tag, bytes] of entries) {
    const padded = Buffer.alloc(Math.ceil(bytes.length / 4) * 4); bytes.copy(padded);
    directory.push(join([Buffer.from(tag), u32(checksum(padded)), u32(offset), u32(bytes.length)]));
    if (tag === 'head') headOffset = offset;
    chunks.push(padded); offset += padded.length;
  }
  const result = join([header, ...directory, ...chunks]);
  result.writeUInt32BE((0xb1b0afba - checksum(result)) >>> 0, headOffset + 8);
  return result;
}

function buildAppleEmojiFont(source, sequences, shaped) {
  const original = tablesFromCollection(source), tables = new Map();
  for (const tag of ['head', 'hhea', 'maxp', 'OS/2', 'hmtx', 'cmap', 'loca', 'glyf']) {
    if (!original.has(tag)) throw new Error('Unsupported system emoji font.');
    tables.set(tag, Buffer.from(original.get(tag)));
  }
  const bitmaps = bitmapTables(original);
  const { gsub, extraGlyphs } = substitutionTables(characterMap(tables.get('cmap')), sequences, shaped, bitmaps);
  const count = bitmaps.count + extraGlyphs;
  tables.get('head').writeUInt32BE(0, 8);
  tables.get('head').writeInt16BE(1, 50);
  tables.get('maxp').writeUInt16BE(count, 4);
  tables.get('hhea').writeUInt16BE(count, 34);
  const oldHmtx = original.get('hmtx'), metricCount = original.get('hhea').readUInt16BE(34);
  const hmtx = Buffer.alloc(count * 4);
  for (let id = 0; id < bitmaps.count; id += 1) {
    hmtx.writeUInt16BE(bitmaps.advances[id], id * 4);
    hmtx.writeInt16BE(oldHmtx.readInt16BE(id < metricCount ? id * 4 + 2 : metricCount * 4 + (id - metricCount) * 2), id * 4 + 2);
  }
  tables.set('hmtx', hmtx);
  const offsets = [...bitmaps.glyphOffsets];
  for (let index = 0; index < extraGlyphs; index += 1) offsets.push(offsets.at(-1));
  tables.set('loca', join(offsets.map(u32)));
  tables.set('name', fontName());
  const post = Buffer.alloc(32); post.writeUInt32BE(0x00030000); tables.set('post', post);
  tables.set('CBDT', bitmaps.cbdt); tables.set('CBLC', bitmaps.cblc); tables.set('GSUB', gsub);
  return buildSfnt(tables);
}

module.exports = { FAMILY, buildAppleEmojiFont };
