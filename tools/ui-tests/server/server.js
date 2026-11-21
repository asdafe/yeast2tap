import http from 'node:http';
import { WebSocketServer } from 'ws';
import { loadEmbeddedAssets } from './embedded-assets.js';
import { createFixtures } from './fixtures.js';

const FORBIDDEN_WRITES = new Set([
  '/tschedule',
  '/fputs',
  '/rm',
  '/log',
  '/mqtt',
  '/config',
  '/rh',
  '/psi',
  '/ptc',
  '/cap',
]);

const FORBIDDEN_ANY = new Set(['/pill', '/tcmd', '/wifiscan', '/wificon']);

function isForbidden(method, pathname) {
  if (FORBIDDEN_ANY.has(pathname)) return true;
  if (pathname === '/gravity' && method === 'POST') return true;
  if (pathname === '/device.cfg' && method !== 'GET') return true;
  return method === 'POST' && FORBIDDEN_WRITES.has(pathname);
}

async function readBody(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 1_000_000) throw new Error('request body too large');
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString('utf8');
}

function formField(body, name) {
  const params = new URLSearchParams(body);
  return params.get(name);
}

// PiLink's JSON is lenient: the web UI sends `j{mode:o,beerSet:18.5}` with
// unquoted keys, and the firmware parses it token by token.
function parsePiJson(text) {
  const out = {};
  const pattern = /([A-Za-z0-9_]+)\s*:\s*("(?:[^"\\]|\\.)*"|[^,}]+)/g;
  let match;
  while ((match = pattern.exec(text)) !== null) {
    const raw = match[2].trim();
    if (raw === 'null') out[match[1]] = null;
    else if (raw.startsWith('"')) out[match[1]] = JSON.parse(raw);
    else out[match[1]] = Number.isNaN(Number(raw)) ? raw : Number(raw);
  }
  return out;
}

export async function startServer({ repoRoot, port = 4173, language = 'english' } = {}) {
  if (!repoRoot) throw new Error('startServer requires repoRoot');

  const assets = loadEmbeddedAssets(repoRoot, language);
  const fixtures = createFixtures();
  const requests = [];
  globalThis.__scalePosts = [];

  // PiLink's 'j' write and 's' read-back, so the control page's Apply
  // confirmation can be exercised without a controller.
  const control = {
    mode: 'o',
    beerSetting: 20,
    fridgeSetting: 4,
    heatEstimator: 0.5,
    coolEstimator: 0.5,
    hystMode: 0,
    indKp: 20,
    indKi: 8,
    indPulse: 1,
  };
  let ignoreWrites = false;
  let muteReads = false;
  // PiLink::sendControlSettings() sends the write keys (beerSet/fridgeSet),
  // not the internal names used by the fixture object.
  const controlReply = () =>
    'S:' +
    JSON.stringify({
      mode: control.mode,
      beerSet: control.beerSetting,
      fridgeSet: control.fridgeSetting,
      heatEstimator: control.heatEstimator,
      coolEstimator: control.coolEstimator,
      hystMode: control.hystMode,
      indKp: control.indKp,
      indKi: control.indKi,
      indPulse: control.indPulse,
    });

  const server = http.createServer((req, res) => {
    handle(req, res).catch((error) => {
      if (!res.headersSent) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: error.message }));
      } else {
        res.end();
      }
    });
  });

  const wss = new WebSocketServer({ noServer: true });

  server.on('upgrade', (req, socket, head) => {
    const url = new URL(req.url, 'http://127.0.0.1');
    if (url.pathname !== '/ws') {
      socket.destroy();
      return;
    }
    wss.handleUpgrade(req, socket, head, (client) => wss.emit('connection', client, req));
  });

  wss.on('connection', (client) => {
    client.send('A:' + JSON.stringify(fixtures.statusMessage(control)));
    client.send(
      'W:' +
        JSON.stringify({ m: 0, ssid: 'mock-network', ip: '192.168.1.50', rssi: -55 }),
    );

    const timer = setInterval(() => {
      if (client.readyState === client.OPEN) {
        client.send('A:' + JSON.stringify(fixtures.statusMessage(control)));
      }
    }, 1000);

    client.on('message', (raw) => {
      const message = raw.toString();
      const command = message[0];
      if (command === 'c') {
        client.send('C:' + JSON.stringify(fixtures.controlConstants()));
      } else if (command === 's') {
        if (!muteReads) client.send(controlReply());
      } else if (command === 'j') {
        if (!ignoreWrites) {
          const body = parsePiJson(message.slice(1));
          if (typeof body.mode === 'string') control.mode = body.mode;
          ['beerSet', 'fridgeSet'].forEach((key) => {
            if (!(key in body)) return;
            const target = key === 'beerSet' ? 'beerSetting' : 'fridgeSetting';
            control[target] = body[key] === null ? null : Number(body[key]);
          });
          if (typeof body.hystMode !== 'undefined') control.hystMode = Number(body.hystMode);
          if (typeof body.indKp !== 'undefined') control.indKp = Number(body.indKp);
          if (typeof body.indKi !== 'undefined') control.indKi = Number(body.indKi);
          if (typeof body.indPulse !== 'undefined') control.indPulse = Number(body.indPulse);
        }
        if (!muteReads) client.send(controlReply());
      } else if (command === 'n') {
        client.send('N:' + JSON.stringify(fixtures.setupMessage));
      } else if (command === 'd') {
        client.send('d:' + JSON.stringify([]));
      } else if (command === 'h') {
        client.send('h:' + JSON.stringify([]));
      }
    });

    client.on('close', () => clearInterval(timer));
    client.on('error', () => clearInterval(timer));
  });

  async function handle(req, res) {
    const url = new URL(req.url, 'http://127.0.0.1');
    let pathname = url.pathname;
    try {
      pathname = decodeURIComponent(pathname);
    } catch {
      // Keep the raw path; it will 404.
    }

    const sendJson = (status, value) => {
      const body = JSON.stringify(value);
      res.writeHead(status, {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body),
      });
      res.end(body);
    };

    // The control page's writes go through this first (BWF.authorize).
    if (pathname === '/authz') {
      sendJson(200, { ok: true });
      return;
    }

    if (pathname === '/__health') {
      sendJson(200, { ok: true });
      return;
    }

    if (pathname === '/__requests' && req.method === 'GET') {
      sendJson(200, { requests });
      return;
    }

    if (pathname === '/__requests/reset' && req.method === 'POST') {
      requests.length = 0;
      sendJson(200, { ok: true });
      return;
    }

    // Test hook: pretend the controller silently drops 'j' writes, so the page
    // has to report a mismatch instead of "Applied.".
    if (pathname === '/__control/ignore-writes') {
      ignoreWrites = url.searchParams.get('on') === '1'; console.log('[mock] ignoreWrites=', ignoreWrites);
      sendJson(200, { ignoreWrites });
      return;
    }

    // Test hook: accept writes but never answer, so the page has to time out.
    if (pathname === '/__control/mute-reads') {
      muteReads = url.searchParams.get('on') === '1';
      sendJson(200, { muteReads });
      return;
    }

    if (pathname === '/favicon.ico') {
      res.writeHead(204);
      res.end();
      return;
    }

    if (pathname === '/chart.php') {
      requests.push({ method: req.method, path: pathname + url.search, status: 204, at: Date.now() });
      res.writeHead(204, { LogOffset: '0' });
      res.end();
      return;
    }

    const forbidden = isForbidden(req.method, pathname);
    requests.push({
      method: req.method,
      path: pathname + url.search,
      status: forbidden ? 403 : undefined,
      forbidden,
      at: Date.now(),
    });

    if (forbidden) {
      sendJson(403, { error: 'hardware write blocked by the local UI test harness' });
      return;
    }

    const respond = (status, value) => {
      requests[requests.length - 1].status = status;
      sendJson(status, value);
    };

    const method = req.method;

    if (method === 'GET' && pathname === '/theme') {
      respond(200, { theme: fixtures.state.theme });
      return;
    }

    if (method === 'POST' && pathname === '/theme') {
      const body = await readBody(req);
      const raw = formField(body, 'data');
      try {
        const parsed = raw ? JSON.parse(raw) : null;
        if (!parsed || typeof parsed.theme !== 'string') {
          respond(406, { error: 'theme required' });
          return;
        }
        fixtures.state.theme = parsed.theme;
        fixtures.config.theme = parsed.theme;
        respond(200, {});
      } catch {
        respond(406, { error: 'invalid json' });
      }
      return;
    }

    if (method === 'GET' && pathname === '/notes') {
      respond(200, fixtures.state.notes);
      return;
    }

    if (method === 'POST' && pathname === '/notes') {
      const body = await readBody(req);
      const raw = formField(body, 'data');
      try {
        const parsed = raw ? JSON.parse(raw) : {};
        if (typeof parsed.dash === 'string') fixtures.state.notes.dash = parsed.dash;
        if (typeof parsed.room === 'string') fixtures.state.notes.room = parsed.room;
        if (parsed.keg && typeof parsed.keg === 'object') {
          fixtures.state.notes.keg = { ...fixtures.state.notes.keg, ...parsed.keg };
        }
        respond(200, {});
      } catch {
        respond(406, { error: 'invalid json' });
      }
      return;
    }

    if (method === 'GET' && pathname === '/scale') {
      if (url.searchParams.get('daily')) {
        // writeDailyJson(255) serves one file: the daily records followed by the
        // sample-session rows (FlagSample = 32) appended after them.
        respond(200, {
          retentionDays: 180,
          records: [...fixtures.scaleDaily, ...fixtures.scaleSamples],
        });
      } else {
        respond(200, fixtures.scale);
      }
      return;
    }

    if (method === 'POST' && pathname === '/scale') {
      const body = await readBody(req);
      const raw = formField(body, 'data');
      try {
        const parsed = raw ? JSON.parse(raw) : {};
        // Recorded for the scale-page tests, which read globalThis.__scalePosts
        // instead of installing a page.route. The page-load handler below starts
        // each test with an empty array, so bodies never leak across tests.
        if (Array.isArray(globalThis.__scalePosts)) globalThis.__scalePosts.push(parsed);
        else globalThis.__scalePosts = [parsed];
        respond(200, {});
      } catch {
        respond(406, { error: 'invalid json' });
      }
      return;
    }

    if (method === 'GET' && pathname === '/config') {
      if (url.searchParams.has('nb')) respond(200, {});
      else respond(200, fixtures.config);
      return;
    }

    if (method === 'GET' && pathname === '/tschedule') {
      respond(200, fixtures.profile);
      return;
    }

    if (method === 'GET' && pathname === '/psi') {
      if (url.searchParams.has('r')) {
        respond(200, { a0: fixtures.pressure.a0 });
      } else {
        respond(200, fixtures.pressure);
      }
      return;
    }

    if (method === 'GET' && pathname === '/rh') {
      respond(200, fixtures.rh);
      return;
    }

    // AUTO_CAP schedule: read for the settings backup, write to restore it.
    if (method === 'GET' && pathname === '/cap') {
      respond(200, { m: 3, at: 1790000000 });
      return;
    }

    if (method === 'POST' && pathname === '/cap') {
      await readBody(req);
      respond(200, {});
      return;
    }

    if (method === 'GET' && pathname === '/time') {
      respond(200, { t: '2026-11-02 09:05:00', e: 1790000000, o: -180 });
      return;
    }

    if (method === 'GET' && pathname === '/gdc') {
      respond(200, fixtures.gdc);
      return;
    }

    if (method === 'GET' && pathname === '/log') {
      respond(200, fixtures.state.logConfig);
      return;
    }

    if (method === 'GET' && pathname === '/mqtt') {
      respond(200, { open: 0, server: '', port: 1883, user: '', pass: '', topic: '' });
      return;
    }

    if (method === 'GET' && pathname === '/ptc') {
      respond(200, fixtures.ptc);
      return;
    }

    if (method === 'GET' && pathname === '/getstatus') {
      respond(200, fixtures.getstatus);
      return;
    }

    if (method === 'GET' && pathname === '/loglist.php') {
      respond(200, fixtures.loglist);
      return;
    }

    if (method === 'GET' && pathname === '/list') {
      respond(200, []);
      return;
    }

    if (method === 'GET' && pathname === '/device.cfg') {
      res.writeHead(200, { 'Content-Type': 'application/octet-stream', 'Content-Length': 0 });
      res.end();
      return;
    }

    if (method === 'POST' && pathname === '/time') {
      await readBody(req);
      respond(200, {});
      return;
    }

    if (method === 'GET' && pathname === '/scale.htm') {
      // A fresh page load begins a test: drop the previous test's POST bodies.
      // AJAX reloads inside the page (GET /scale) keep the array intact.
      globalThis.__scalePosts = [];
    }

    if (method === 'GET' || method === 'HEAD') {
      let assetPath = pathname;
      if (assetPath === '/' || assetPath.endsWith('/')) assetPath += 'index.htm';
      if (assetPath === '/index.htm' && assets.has('/')) assetPath = '/';

      const asset = assets.get(assetPath);
      if (asset) {
        requests[requests.length - 1].status = 200;
        res.writeHead(200, {
          'Content-Type': asset.mime,
          'Content-Encoding': 'gzip',
          'Content-Length': asset.bytes.length,
        });
        if (method === 'HEAD') res.end();
        else res.end(asset.bytes);
        return;
      }
    }

    requests[requests.length - 1].status = 404;
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('Not found');
  }

  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', resolve);
  });

  const actualPort = server.address().port;

  return {
    server,
    url: `http://127.0.0.1:${actualPort}`,
    close: () =>
      new Promise((resolve) => {
        wss.close();
        for (const client of wss.clients) client.terminate();
        server.close(resolve);
      }),
  };
}
