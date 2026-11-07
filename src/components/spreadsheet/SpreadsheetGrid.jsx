import React from 'react';

/** Scroll anchoring lives in native sticky layers, never a delayed React offset.
 * Virtualization only decides which ordinary rows/columns need DOM nodes. */
export default function SpreadsheetGrid({ sheet, rows, columns, rowOffsets, heights, renderRows, renderCols, scrollRef, onScroll, renderCell, onSelectRow, onSelectColumn, onSelectAll, onResize, onAutoFit }) {
  const header = 30, gutter = 48;
  const frozenRows = Math.min(sheet.freezeRows || 0, rows.length);
  const frozenCols = Math.min(sheet.freezeColumns || 0, sheet.columnCount);
  const frozenWidth = columns[frozenCols] || 0;
  const frozenHeight = rowOffsets[frozenRows] || 0;
  const width = gutter + columns.at(-1), height = header + rowOffsets.at(-1);
  const regularCols = renderCols.filter(c => c >= frozenCols);
  const fixedCols = Array.from({ length: frozenCols }, (_, i) => i);
  const rowHeader = i => <div role="rowheader" className="sheet-row-header" style={{ width:gutter,height:heights[i] }} onClick={() => onSelectRow(rows[i])}>{rows[i]+1}<span role="separator" aria-label={`Resize row ${rows[i]+1}`} onPointerDown={e=>onResize(e,'row',rows[i])} /></div>;
  const headerCell = (c, local=false) => <div role="columnheader" key={c} className="sheet-col-header" style={{left:(local?0:gutter)+columns[c],top:0,width:columns[c+1]-columns[c],height:header}} onClick={()=>onSelectColumn(c)}>{columnLabel(c)}<span role="separator" aria-label={`Resize column ${columnLabel(c)}`} onPointerDown={e=>onResize(e,'column',c)} onDoubleClick={e=>{e.stopPropagation();onAutoFit(c);}} /></div>;
  const renderRow = (i, frozen=false) => <div className={`sheet-grid-row ${frozen?'is-frozen-row':''}`} key={rows[i]} style={{position:frozen?'relative':'absolute',top:frozen?undefined:header+rowOffsets[i],height:heights[i],width,gridTemplateColumns:`${gutter}px minmax(0,1fr)`}}>
    {regularCols.map(c=>renderCell(rows[i],c,{left:gutter+columns[c],top:0,width:columns[c+1]-columns[c],height:heights[i],index:i,frozen}))}
    {rowHeader(i)}
    {frozenCols>0&&<div className="sheet-frozen-columns" style={{width:frozenWidth,height:heights[i],left:gutter}}>{fixedCols.map(c=>renderCell(rows[i],c,{left:columns[c],top:0,width:columns[c+1]-columns[c],height:heights[i],index:i,frozen:true}))}</div>}
  </div>;
  return <div className="sheet-scroll" role="grid" aria-label={sheet.name} aria-rowcount={sheet.rowCount} aria-colcount={sheet.columnCount} ref={scrollRef} onScroll={onScroll}>
    <div className="sheet-plane" style={{width,height}}>
      <div className="sheet-column-headers" style={{width,height:header,gridTemplateColumns:`${gutter}px minmax(0,1fr)`}}>
        {regularCols.map(c=>headerCell(c))}
        <div className="sheet-corner" style={{width:gutter,height:header}} onClick={onSelectAll}>▦</div>
        {frozenCols>0&&<div className="sheet-frozen-columns" style={{width:frozenWidth,height:header,left:gutter}}>{fixedCols.map(c=>headerCell(c,true))}</div>}
      </div>
      {frozenRows>0&&<div className="sheet-frozen-rows" style={{top:header,width,height:frozenHeight,marginBottom:-frozenHeight}}>{Array.from({length:frozenRows},(_,i)=>renderRow(i,true))}</div>}
      {renderRows.filter(i=>i>=frozenRows).map(i=>renderRow(i))}
    </div>
  </div>;
}
function columnLabel(index) { let value='';for(let n=index+1;n;n=Math.floor((n-1)/26))value=String.fromCharCode(65+(n-1)%26)+value;return value; }
