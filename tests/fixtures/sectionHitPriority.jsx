import React from 'react';
import { createRoot } from 'react-dom/client';
import CanvasSection from '@/components/knowledgeweb/CanvasSection';
function Fixture(){
 const [obj,setObj]=React.useState({id:1,x:100,y:100,width:400,height:300,title:'Green section',color:'green'});
 window.sectionProof={lock:()=>setObj(o=>({...o,is_locked:true})),size:()=>({width:obj.width,height:obj.height})};
 return <div className="relative" style={{width:900,height:700}}><CanvasSection obj={obj} zoom={1} isSelected onSelect={()=>{}} onDragEnd={()=>{}} onUpdate={(_id,patch)=>setObj(o=>({...o,...patch}))} onResize={(_id,width,height)=>setObj(o=>({...o,width,height}))}/>
 <svg className="absolute inset-0 pointer-events-none z-[7]" width="900" height="700"><path data-connection-hit="true" d="M400 300L600 500 M120 220L480 220 M480 250L520 250 M120 120L480 120" stroke="gray" strokeWidth="18" fill="none" className="pointer-events-auto" /></svg>
 <div data-card="true" className="absolute z-10" style={{left:250,top:180,width:150,height:50,background:'#333'}}>Card</div></div>;
}
createRoot(document.getElementById('root')).render(<Fixture/>);
