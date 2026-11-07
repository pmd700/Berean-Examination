import { describe, it, expect } from 'vitest';
import JSZip from 'jszip';
import { createWorkbook, createSheet, setCell, copyCellRange, moveCellRange } from '@/lib/spreadsheet/model';
import { createCalculator } from '@/lib/spreadsheet/formulas';
import { exportXlsx, importWorkbook } from '@/lib/spreadsheet/files';
const inputFile = bytes => ({ name:'styles.xlsx',size:bytes.length,arrayBuffer:async()=>bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength) });
function book(entries) {const b=createWorkbook();for(const[a,v]of entries)b.sheets[0]=setCell(b.sheets[0],a,v);return b;}

describe('Atomic spreadsheet cell moves',()=>{
  it('moves complete cells, blanks and styles while updating same-sheet, cross-sheet and absolute references',()=>{
    const b=book([['A1',2],['A2',3],['B1','=A1+$A$2'],['C1','=SUM(A1:A2)'],['D1','="A1"&A1'],['E5','destination to clear']]);
    const source=b.sheets[0];source.name='Scores';source.cells.A1.style={bold:true,borders:{left:{width:2,color:'#ff0000'}}};source.cells.A1.note='source';source.cells.A1.choices=['a','b'];
    const other=createSheet('Other');other.cells.A1={f:"'Scores'!$A$1+Scores!A2"};other.cells.B1={f:'A1'};b.sheets.push(other);
    const frozen=JSON.stringify(b),next=moveCellRange(b,source.id,{r0:0,r1:1,c0:0,c1:1},3,3),s=next.sheets[0];
    expect(JSON.stringify(b)).toBe(frozen);expect(s.cells.A1).toBeUndefined();expect(s.cells.A2).toBeUndefined();expect(s.cells.B1).toBeUndefined();
    expect(s.cells.D4).toEqual(source.cells.A1);expect(s.cells.E4.f).toBe('D4+$D$5');expect(s.cells.E5).toBeUndefined();
    expect(s.cells.C1.f).toBe('SUM(D4:D5)');expect(s.cells.D1.f).toBe('"A1"&D4');expect(next.sheets[1].cells.A1.f).toBe("'Scores'!$D$4+Scores!D5");expect(next.sheets[1].cells.B1.f).toBe('A1');
    const calc=createCalculator(next);expect(calc(s.id,'E4')).toBe(5);expect(calc(s.id,'C1')).toBe(5);expect(calc(other.id,'A1')).toBe(5);
  });
  it('handles overlapping moves without smearing values or retaining destination cells under source blanks',()=>{
    const b=book([['A1',1],['C1',3],['D1','old'],['F1','=SUM(A1:C1)']]);
    const next=moveCellRange(b,b.sheets[0].id,{r0:0,r1:0,c0:0,c1:2},0,1),s=next.sheets[0];
    expect(s.cells.A1).toBeUndefined();expect(s.cells.B1.v).toBe(1);expect(s.cells.C1).toBeUndefined();expect(s.cells.D1.v).toBe(3);expect(s.cells.F1.f).toBe('SUM(B1:D1)');expect(createCalculator(next)(s.id,'F1')).toBe(4);
  });
  it('copies a bounded sparse rectangle with full metadata and moves whole merged ranges',()=>{
    const b=book([['A1','merged']]),s=b.sheets[0];s.merges=['A1:B2'];s.cells.A1.style={textMode:'clip'};
    const copy=copyCellRange(s,{r0:0,r1:1,c0:0,c1:1});expect(copy.rows).toBe(2);expect(copy.columns).toBe(2);expect(copy.cells).toEqual({A1:s.cells.A1});expect(copy.merges).toEqual(['A1:B2']);
    copy.cells.A1.style.textMode='wrap';expect(s.cells.A1.style.textMode).toBe('clip');
    const next=moveCellRange(b,s.id,{r0:0,r1:1,c0:0,c1:1},3,3);expect(next.sheets[0].merges).toEqual(['D4:E5']);
    expect(()=>copyCellRange(s,{r0:0,r1:0,c0:0,c1:0})).toThrow(/entire merged/);
    expect(()=>moveCellRange(b,s.id,{r0:10,r1:11,c0:0,c1:1},0,1)).toThrow(/part of a merged/);
  });
  it('rejects unsafe ranges and split formula ranges atomically',()=>{
    const b=book([['A1',1],['A2',2],['B1','=SUM(A1:A3)']]),before=JSON.stringify(b),id=b.sheets[0].id;
    expect(()=>moveCellRange(b,id,{r0:0,r1:1,c0:0,c1:0},3,3)).toThrow(/split a formula range/);
    expect(JSON.stringify(b)).toBe(before);
    expect(()=>moveCellRange(b,id,{r0:0,r1:999,c0:0,c1:100},0,0)).toThrow(/100,000/);
    expect(()=>moveCellRange(b,id,{r0:0,r1:1,c0:0,c1:0},1048575,0)).toThrow(/valid range/);
  });
});

describe('Native and BEX extended cell style round trips',()=>{
  it('preserves all text modes, horizontal/vertical alignment and exact border edge widths/colors',async()=>{
    const b=createWorkbook(),s=b.sheets[0];
    ['overflow','clip','wrap'].forEach((textMode,i)=>{s.cells[`A${i+1}`]={v:'Evidence',style:{textMode,verticalAlign:['top','middle','bottom'][i],align:['left','center','right'][i],borders:{top:{color:'#123456',width:1},right:{color:'#aabbcc',width:2},bottom:{color:'#ff0000',width:3},left:{color:'#00aa00',width:4}}}};});
    const bytes=await exportXlsx(b),again=await importWorkbook(inputFile(bytes));
    for(let i=1;i<=3;i++)expect(again.sheets[0].cells[`A${i}`].style).toMatchObject(s.cells[`A${i}`].style);
    const zip=await JSZip.loadAsync(bytes),styles=await zip.file('xl/styles.xml').async('string');
    expect(styles).toContain('vertical="center"');expect(styles).toContain('wrapText="1"');expect(styles).toContain('style="medium"');expect(styles).toContain('rgb="FF123456"');
    zip.remove('customXml/bexSpreadsheet.xml');const native=await importWorkbook(inputFile(await zip.generateAsync({type:'uint8array'})));
    expect(native.sheets[0].cells.A2.style.verticalAlign).toBe('middle');expect(native.sheets[0].cells.A3.style.textMode).toBe('wrap');expect(native.sheets[0].cells.A1.style.borders.right).toEqual({color:'#AABBCC',width:2});
  });
  it('modifies new formatting without dropping original font size, underline, border diagonal or alignment properties',async()=>{
    const b=book([['A1','Existing style']]),zip=await JSZip.loadAsync(await exportXlsx(b));
    let styles=await zip.file('xl/styles.xml').async('string');
    styles=styles.replace('<sz val="11"/>','<sz val="19"/><u/>').replace('<border/>','<border diagonalUp="1"><diagonal style="thin"><color rgb="FF445566"/></diagonal></border>');
    zip.file('xl/styles.xml',styles);
    const imported=await importWorkbook(inputFile(await zip.generateAsync({type:'uint8array'})));
    imported.sheets[0].cells.A1.style={...imported.sheets[0].cells.A1.style,textMode:'clip',verticalAlign:'middle',borders:{bottom:{width:2,color:'#112233'}}};
    const out=await JSZip.loadAsync(await exportXlsx(imported)),outStyles=await out.file('xl/styles.xml').async('string');
    expect(outStyles).toContain('<sz val="19"');expect(outStyles).toContain('<u');expect(outStyles).toContain('diagonalUp="1"');expect(outStyles).toContain('FF445566');
  });
});
