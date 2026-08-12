import dgram from 'node:dgram';

const args = new Map();
for (let i = 2; i < process.argv.length; i += 2) {
  args.set(process.argv[i], process.argv[i + 1]);
}

const host = args.get('--host') || '127.0.0.1';
const port = Number(args.get('--port') || 53535);
const ttl = 300;

const records = new Map([
  ['region1.v2.argotunnel.com', [
    '198.41.192.7',
    '198.41.192.47',
    '198.41.192.227',
    '198.41.192.107',
    '198.41.192.37',
    '198.41.192.77',
    '198.41.192.67',
    '198.41.192.27',
    '198.41.192.57',
    '198.41.192.167',
  ]],
  ['region2.v2.argotunnel.com', [
    '198.41.200.53',
    '198.41.200.233',
    '198.41.200.43',
    '198.41.200.23',
    '198.41.200.13',
    '198.41.200.193',
    '198.41.200.73',
    '198.41.200.33',
    '198.41.200.63',
    '198.41.200.113',
  ]],
]);

const readName = (message, offset) => {
  const labels = [];
  let cursor = offset;
  while (cursor < message.length) {
    const length = message[cursor];
    if (length === 0) return { name: labels.join('.').toLowerCase(), end: cursor + 1 };
    labels.push(message.subarray(cursor + 1, cursor + 1 + length).toString('ascii'));
    cursor += length + 1;
  }
  return { name: '', end: offset };
};

const ipv4Bytes = (ip) => Buffer.from(ip.split('.').map((part) => Number(part)));

const server = dgram.createSocket('udp4');

server.on('message', (message, remote) => {
  if (message.length < 12) return;

  const id = message.subarray(0, 2);
  const qdcount = message.readUInt16BE(4);
  if (qdcount !== 1) return;

  const question = readName(message, 12);
  const questionEnd = question.end + 4;
  if (questionEnd > message.length) return;

  const qtype = message.readUInt16BE(question.end);
  const qclass = message.readUInt16BE(question.end + 2);
  const ips = qclass === 1 && (qtype === 1 || qtype === 255) ? records.get(question.name) || [] : [];

  const header = Buffer.alloc(12);
  id.copy(header, 0);
  header.writeUInt16BE(0x8180, 2);
  header.writeUInt16BE(1, 4);
  header.writeUInt16BE(ips.length, 6);

  const answers = ips.map((ip) => {
    const answer = Buffer.alloc(16);
    answer.writeUInt16BE(0xc00c, 0);
    answer.writeUInt16BE(1, 2);
    answer.writeUInt16BE(1, 4);
    answer.writeUInt32BE(ttl, 6);
    answer.writeUInt16BE(4, 10);
    ipv4Bytes(ip).copy(answer, 12);
    return answer;
  });

  const response = Buffer.concat([header, message.subarray(12, questionEnd), ...answers]);
  server.send(response, remote.port, remote.address);
});

server.bind(port, host, () => {
  console.log(`Cloudflare edge DNS fallback listening on ${host}:${port}`);
});
