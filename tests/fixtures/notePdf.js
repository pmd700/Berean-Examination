import {buildNotePrintHtml} from '@/lib/notePdf';
const footnote='<sup data-footnote-id="source" data-footnote-text="&lt;p&gt;A preserved source note.&lt;/p&gt;"></sup>';
const first='<h2>Research</h2><p>Selectable text, <strong>bold</strong>, <em>italics</em> and a <a href="https://example.com">reference link</a>.'+footnote+'</p>'+Array.from({length:35},(_,i)=>`<p>Paragraph ${i+1}. This is a readable paragraph used to verify natural PDF pagination without cutting lines in half.</p>`).join('')+'<table><tr><th>Exhibition</th><th>Contents</th></tr><tr><td>Example</td><td>A table cell with wrapped text.</td></tr></table>';
const pages=[first,'<!--bex-page-title:Selected%20second%20page--><h2>Selected page content</h2><p>This page is exported alone in the second proof.</p>'+footnote];
window.pdfCases={whole:buildNotePrintHtml({title:'BEX PDF export proof',pages}),selected:buildNotePrintHtml({title:'BEX PDF export proof',pages,indices:[1]})};
