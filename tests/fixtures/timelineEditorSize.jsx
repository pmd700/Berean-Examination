import React from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import TimegraphEventPanel from '@/components/timegraph/TimegraphEventPanel';
import { normalizeEvent } from '@/lib/timegraph/timegraphModel';
import '@/index.css';

window.bexDesktop = { isDesktop: true, listLocalEntities: async () => ({ ok: true, records: [] }) };
function Fixture() {
  const [event, setEvent] = React.useState(() => normalizeEvent({ id: 'size-proof', title: 'Three editor sizes', start: '2026',
    description: '<p>Preserve this text and selection.</p><p><a href="https://example.com">Source link</a></p>' }));
  React.useEffect(() => { window.timelineSizeProof = { event }; }, [event]);
  return <MemoryRouter>
    <header style={{ height: 36 }}>Disposable timeline fixture</header>
    <main className="bex-timegraph-body flex" style={{ height: 'calc(100vh - 36px)', transform: 'translateZ(0)' }}>
      <div className="flex-1 min-w-0" style={{ background: 'rgb(var(--app))' }}>Timeline canvas</div>
      <TimegraphEventPanel event={event} onChange={setEvent} />
    </main>
  </MemoryRouter>;
}
createRoot(document.getElementById('root')).render(<Fixture />);
