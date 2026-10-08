'use strict';

const MEDIA_SCHEME = 'bex-media';

function registerLocalMediaScheme(protocol) {
  if (!protocol || typeof protocol.registerSchemesAsPrivileged !== 'function') {
    throw new TypeError('Electron protocol support is unavailable.');
  }
  protocol.registerSchemesAsPrivileged([{
    scheme: MEDIA_SCHEME,
    privileges: {
      bypassCSP: false,
      corsEnabled: false,
      secure: true,
      standard: true,
      stream: true,
      supportFetchAPI: true,
    },
  }]);
}

function registerLocalMediaProtocol({ protocol, readLocalMedia }) {
  if (!protocol || typeof protocol.handle !== 'function' || typeof readLocalMedia !== 'function') {
    throw new TypeError('The local media display route is incomplete.');
  }
  protocol.handle(MEDIA_SCHEME, async (request) => {
    try {
      const media = readLocalMedia(request.url);
      const responseBytes = Uint8Array.from(media.bytes);
      media.bytes.fill(0);
      return new Response(responseBytes, {
        headers: {
          'Cache-Control': 'no-store',
          'Content-Security-Policy': "default-src 'none'",
          'Content-Type': media.mimeType,
          'X-Content-Type-Options': 'nosniff',
        },
        status: 200,
      });
    } catch (error) {
      const status = error?.code === 'BEX_PRIVACY_LOCKED' ? 423 : 404;
      return new Response('Local media unavailable', {
        headers: { 'Content-Type': 'text/plain; charset=utf-8' },
        status,
      });
    }
  });
}

module.exports = {
  MEDIA_SCHEME,
  registerLocalMediaProtocol,
  registerLocalMediaScheme,
};
