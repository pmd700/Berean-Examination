import { useEffect, useState } from 'react';
let resolver = async source => source;
let custom = false;
export function initialMediaSource(source) { return custom && source?.startsWith('bex-media:') ? '' : source; }
export function setMediaSourceResolver(next) { custom = Boolean(next); resolver = next || (async source => source); }
export function resolveMediaSource(source) { return resolver(source); }
export function useMediaSource(source) {
  const [resolved, setResolved] = useState(initialMediaSource(source));
  useEffect(() => {
    let current = true;
    setResolved(initialMediaSource(source));
    resolveMediaSource(source).then(value => { if (current) setResolved(value); }).catch(() => { if (current) setResolved(''); });
    return () => { current = false; };
  }, [source]);
  return resolved;
}
