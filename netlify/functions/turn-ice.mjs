export default async function turnIce() {
  const keyId = process.env.CLOUDFLARE_TURN_KEY_ID;
  const keyToken = process.env.CLOUDFLARE_TURN_KEY_API_TOKEN;

  if (!keyId || !keyToken) {
    return Response.json({ error: 'Cloudflare TURN credentials are not configured.' }, { status: 503 });
  }

  if (!/^[a-f\d]{32}$/i.test(keyId)) {
    return Response.json({ error: 'Cloudflare TURN key ID is invalid.' }, { status: 500 });
  }

  try {
    const response = await fetch(
      `https://rtc.live.cloudflare.com/v1/turn/keys/${keyId}/credentials/generate-ice-servers`,
      {
        method: 'POST',
        headers: {
          authorization: `Bearer ${keyToken}`,
          'content-type': 'application/json',
          accept: 'application/json',
        },
        body: JSON.stringify({ ttl: 86400 }),
      },
    );

    if (!response.ok) {
      return Response.json({ error: `Cloudflare TURN returned ${response.status}. Check the key ID and key token.` }, { status: 502 });
    }

    const result = await response.json();
    const iceServers = result.iceServers;
    const hasTurnServer = Array.isArray(iceServers) && iceServers.some(server => {
      const urls = Array.isArray(server.urls) ? server.urls : [server.urls];
      return urls.some(url => typeof url === 'string' && /^(turn|turns):/i.test(url));
    });

    if (!hasTurnServer) {
      return Response.json({ error: 'Cloudflare returned no TURN relay servers.' }, { status: 502 });
    }

    return Response.json(iceServers, {
      headers: { 'Cache-Control': 'no-store, max-age=0' },
    });
  } catch {
    return Response.json({ error: 'Could not reach Cloudflare TURN.' }, { status: 502 });
  }
}
