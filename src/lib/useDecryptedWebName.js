import { useEffect, useState } from 'react';
import { usePrivateWeb } from '@/lib/PrivateWebContext';
import { decryptString } from '@/lib/webCrypto';

export function useDecryptedWebName(web) {
  const { isUnlocked, getKey } = usePrivateWeb();
  const [name, setName] = useState(null);
  const unlocked = web ? isUnlocked(web.id) : false;
  useEffect(() => {
    let cancelled = false;
    if (!web?.is_private) { setName(null); return; }
    const key = getKey(web.id);
    if (!key || !web.enc_name) { setName(null); return; }
    decryptString(key, web.enc_name).then(n => {
      if (!cancelled) setName(n);
    }).catch(() => { if (!cancelled) setName(null); });
    return () => { cancelled = true; };
  }, [web?.id, web?.is_private, web?.enc_name, unlocked, getKey]);
  return name;
}
