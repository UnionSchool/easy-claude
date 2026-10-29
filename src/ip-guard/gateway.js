import http from 'node:http';
import net from 'node:net';
import { Transform } from 'node:stream';

export function createGateway(guard, targets = null) {
  const sockets = new Set();
  const closeConnections = () => { for (const socket of sockets) socket.destroy(); };
  guard.on('blocked', closeConnections);
  const server = http.createServer((_req, res) => { res.writeHead(405); res.end(); });
  server.headersTimeout = 5000; server.requestTimeout = 5000;
  server.on('connection', socket => {
    sockets.add(socket); socket.on('close', () => sockets.delete(socket));
    socket.on('error', () => {});
  });
  server.on('connect', (req, client, head) => {
    client.on('error', () => {});
    const permitted = () => guard.usable();
    let target;
    try {
      if (targets) target = targets.get(req.url);
      else {
        const match = /^([a-zA-Z0-9.-]+):443$/.exec(req.url);
        if (match && match[1].length <= 253 && !match[1].startsWith('-')) target = { host: match[1], port: 443, family: 4 };
      }
    } catch { /* 无效 CONNECT 请求在下面统一拒绝。 */ }
    if (!permitted() || !target) { client.end('HTTP/1.1 403 Forbidden\r\n\r\n'); return; }
    const generation = guard.generation;
    if (guard.enabled && net.isIP(target.host) && net.isIP(target.host) !== guard.family) { client.end('HTTP/1.1 403 Forbidden\r\n\r\n'); return; }
    const upstream = net.connect(target);
    upstream.setTimeout(12000, () => upstream.destroy());
    for (const socket of [client, upstream]) {
      sockets.add(socket); socket.on('close', () => sockets.delete(socket));
    }
    upstream.on('error', () => client.destroy());
    upstream.on('close', () => client.destroy());
    client.on('close', () => upstream.destroy());
    upstream.on('connect', () => {
      if (!permitted() || generation !== guard.generation) { client.destroy(); upstream.destroy(); return; }
      upstream.setTimeout(0);
      client.write('HTTP/1.1 200 Connection Established\r\n\r\n');
      if (head.length) upstream.write(head);
      // 每批数据重新核对租约，防止事件循环暂停后先转发、后执行到期计时器。
      const check = () => new Transform({ transform(data, _encoding, done) {
        if (!permitted() || generation !== guard.generation) { client.destroy(); upstream.destroy(); done(); }
        else done(null, data);
      } });
      const outbound = check(), inbound = check();
      client.on('close', () => { outbound.destroy(); inbound.destroy(); });
      client.pipe(outbound).pipe(upstream); upstream.pipe(inbound).pipe(client);
    });
  });
  server.on('clientError', (_error, socket) => socket.destroy());
  return { server, close: () => {
    closeConnections(); guard.removeListener('blocked', closeConnections);
    return new Promise(resolve => server.close(resolve));
  } };
}
