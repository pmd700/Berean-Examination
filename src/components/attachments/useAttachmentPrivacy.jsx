import { useEffect, useRef, useState } from 'react';
import { getAttachmentDesktopApi } from './attachmentModel';

// Drop canvas and media elements as soon as the vault locks, even if this
// component is mounted somewhere outside DesktopPrivacyGate in the future.
export default function useAttachmentPrivacy(onLocked) {
  // A newly mounted preview can have missed the lock event that closed its
  // viewer. Keep it hidden until the authoritative current status arrives.
  const [locked, setLocked] = useState(() => Boolean(getAttachmentDesktopApi()?.getPrivacyStatus));
  const onLockedRef = useRef(onLocked);
  onLockedRef.current = onLocked;
  useEffect(() => {
    const desktop = getAttachmentDesktopApi();
    let active = true;
    let receivedEvent = false;
    const update = (status) => {
      setLocked(Boolean(status?.locked));
      if (status?.locked) onLockedRef.current?.();
    };
    const unsubscribe = desktop?.onPrivacyStatusChanged?.((status) => {
      receivedEvent = true;
      update(status);
    });
    if (desktop?.getPrivacyStatus) {
      desktop.getPrivacyStatus().then(result => {
        if (active && !receivedEvent) update(result?.ok && result.status ? result.status : { locked: true });
      }).catch(() => { if (active && !receivedEvent) update({ locked: true }); });
    }
    return () => { active = false; unsubscribe?.(); };
  }, []);
  return locked;
}
