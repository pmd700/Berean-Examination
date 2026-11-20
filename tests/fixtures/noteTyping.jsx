import React from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { WorkspaceTabsProvider } from '@/lib/WorkspaceTabs';
import NoteEditorPanel from '@/components/knowledgeweb/NoteEditorPanel';
const fallback={id:1,title:'Typing proof',content:'<p>A short note about a claim.<sup data-footnote-id="one" data-footnote-text="&lt;p&gt;A source.&lt;/p&gt;"></sup></p>'};
const fixture=window.NOTE_FIXTURE||{note:fallback};
const note={...fixture.note,id:1},page=fixture.page||0;
window.bexDesktop={isDesktop:true,listLocalEntities:async()=>({ok:true,records:[]}),getLocalOwner:async()=>({ok:true,owner:{is_local_owner:true}}),updateLocalOwner:async()=>({ok:true,owner:{is_local_owner:true}})};
function Harness(){const [notes,setNotes]=React.useState([note]);React.useEffect(()=>{window.bexDesktop.updateLocalEntity=async(kind,id,patch)=>{const value={...note,...patch};setNotes([value]);return {ok:true,record:value};};},[]);return <MemoryRouter><WorkspaceTabsProvider persist={false}><NoteEditorPanel requestedPage={page} noteId={note.id} notes={notes}/></WorkspaceTabsProvider></MemoryRouter>;}
createRoot(document.getElementById('root')).render(<Harness/>);
