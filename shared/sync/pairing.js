import { randomSecret, importSyncKey, sealJson, openJson, toBase64, fromBase64 } from './crypto.js';
import { hexDigest, RelayClient } from './relay-client.js';
import { nextAvailableDeviceSlot } from './identity.js';
const utf8 = new TextEncoder();
export async function createInvitation(relay, { identity, syncKey, existingIds = [] }) {
  const devices = (await relay.request('/api/devices')).devices;
  const slot = nextAvailableDeviceSlot(existingIds, devices.map(device => device.slot));
  const ticket = crypto.randomUUID(), secret = randomSecret(), token = randomSecret();
  const phone = { vaultId: identity.vaultId, epoch: identity.epoch, deviceId: crypto.randomUUID(), slot };
  const bundle = await sealJson(await importSyncKey(secret), { identity: phone, syncKey, token, relay: relay.origin }, `bex:sync:pair:${ticket}`);
  await relay.request('/api/pair', { method: 'POST', body: { ticket, deviceId: phone.deviceId, slot, tokenHash: await hexDigest(utf8.encode(token)), proofHash: await hexDigest(utf8.encode(secret)), bundle } });
  return { code: `BEX-SYNC1.${toBase64(utf8.encode(JSON.stringify({ ticket, secret, relay: relay.origin })))}`, expiresAt: Date.now() + 600000 };
}
export async function consumeInvitation(code) {
  if (typeof code !== 'string' || !code.startsWith('BEX-SYNC1.')) throw new TypeError('Paste the pairing code from BEX on your Mac.');
  const invitation = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(fromBase64(code.slice(10), 4096)));
  const relay = new RelayClient(invitation.relay, invitation.secret);
  const { bundle } = await relay.request('/api/pair/consume', { method: 'POST', body: { ticket: invitation.ticket } });
  const secrets = await openJson(await importSyncKey(invitation.secret), bundle, `bex:sync:pair:${invitation.ticket}`);
  if (secrets.relay !== relay.origin) throw new TypeError('Pairing relay mismatch.');
  return secrets;
}
