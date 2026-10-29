import React from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import CardEditor from '@/components/knowledgeweb/CardEditor';
const card = {id:1,title:'Alignment proof',tags:[],description:'<p>A claim<sup data-footnote-id="proof" data-footnote-text="&lt;p&gt;A source with &lt;em&gt;italic text&lt;/em&gt; that stays in the same place.&lt;/p&gt;"></sup></p>'};
createRoot(document.getElementById('root')).render(<MemoryRouter><CardEditor card={card} allCards={[]} onUpdate={()=>{}} onDelete={()=>{}} onClose={()=>{}} /></MemoryRouter>);
