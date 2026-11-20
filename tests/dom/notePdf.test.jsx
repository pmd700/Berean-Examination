import { expect,it } from 'vitest';
import {buildNotePrintHtml} from '@/lib/notePdf';
import {setPageTitle} from '@/components/notes/bookModel';
it('prints only selected pages with headings, footnotes and no executable HTML',()=>{
 const pages=[setPageTitle('<p>Omitted page</p>','First'),setPageTitle('<h2>Evidence</h2><p>Selected words<sup data-footnote-id="n" data-footnote-text="&lt;p&gt;Source detail&lt;/p&gt;"></sup></p><script>bad()</script><img src="file:///secret" onerror="bad()"><table><tr><td>Value</td></tr></table>','Second')];
 const html=buildNotePrintHtml({title:'Research <test>',pages,indices:[1]});expect(html).not.toContain('Omitted page');expect(html).toContain('Selected words');expect(html).toContain('Source detail');expect(html).toContain('Second');expect(html).toContain('Research &lt;test&gt;');expect(html).toContain('<table>');expect(html).not.toContain('bad()');expect(html).not.toContain('file:///');expect(html).toContain('break-before:page');
});
