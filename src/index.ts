import { argv } from 'yargs';
import * as config from 'config';
import { writeFile, readFile, access, fstat, constants } from 'fs';
import * as nunjucks from 'nunjucks';
import { promisify } from 'util';
import { execFile } from 'child_process';
import * as http from 'http';

import { etcd } from './lib/etcd';

const writeFileAsync = promisify(writeFile);
const readFileAsync = promisify(readFile);
const accessAsync = promisify(access);
const execFileAsync = promisify(execFile);

process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

if (argv.once && argv.daemon) {
  throw new Error('can either run in daemon mode or in once mode');
}

if (!argv.once && !argv.daemon) {
  throw new Error('must select either daemon mode or once mode');
}

async function renderTemplate() {
  const key = `/${config.get('etcd.dir')}/labels/${config.get('label')}/`;
  const { node: { nodes } } = await etcd.getAsync(key);

  const hosts = {};
  const containerIDs = [];
  nodes.forEach((node) => {
    // get all container ids
    containerIDs.push(node.key.substr(key.length));

    // create host container id map 
    if (!Array.isArray(hosts[node.value])) {
      hosts[node.value] = [];
    }
    hosts[node.value].push(node.key.substr(key.length));
  });

  const render = {
    stats: {
      password: 'letmein',
      user: 'entrecode',
      port: 8888,
    },
    extPort: 7777,
    services: await Promise.all(Object.keys(hosts).map(async (host) => {
      let [name, ...ips] = await Promise.all([
        etcd.getAsync(`/${config.get('etcd.dir')}/labels/name/${hosts[host][0]}`),
        ...hosts[host].map(id => etcd.getAsync(`/${config.get('etcd.dir')}/labels/io.rancher.container.ip/${id}`)),
      ]);

      name = name.node.value;
      ips = ips.map(x => x.node.value.slice(0, -3));

      const service = {
        host,
        name,
        containers: hosts[host].map((id, index) => ({
          id: id.substr(0, 12),
          ip: ips[index],
          port: 7777,
        })),
      };

      return service;
    })),
  };

  return nunjucks.render('config.njk', render);
}

async function reRenderTemplate() {
  const cfg = await renderTemplate();
  const currentCfg = await readFileAsync(`${config.get('path')}/haproxy.cfg`, 'utf-8');

  if (cfg === currentCfg) {
    throw new Error(`Config is the same, skipping reload.`);
  }

  console.info('writing new config');
  await writeFileAsync(`${config.get('path')}/haproxy.cfg`, cfg, 'utf-8');

  try {
    // TODO with haproxyctl
    await accessAsync('/etc/init.d/haproxy', constants.X_OK);
    console.info('reloading haproxy');
    const { stdout, stderr } = await execFileAsync('/etc/init.d/haproxy', ['reload']);
  } catch (e) {
    if (e.code === 'ENOENT') {
      throw new Error('haproxy init script not available, skipping reload');
    }

    throw e;
  }
}

async function disableServer(name) {
  try {
    await accessAsync('/etc/init.d/haproxyctl', constants.X_OK);
    const { stdout, stderr } = await execFileAsync('/etc/init.d/haproxyctl', [`"disable server ${name}"`]);
    console.log('out:');
    console.log(stdout);
    console.log('err:');
    console.log(stderr);
  } catch (e) {
    if (e.code === 'ENOENT') {
      throw new Error('haproxy init script not available, skipping reload');
    }

    throw e;
  }
}

let watcher;
// let timer;
async function watch() {
  const server = http.createServer((req: any, res: any) => {
    switch (true) {
      default:
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.write(JSON.stringify({ message: 'not-found' }));
        return res.end();
      case req.url.toLowerCase().startsWith('/disableserver/'):
        const result = /\/disableserver\/(.*)\/([a-f0-9]{12})/.exec(req.url.toLowerCase());
        if (!result) {
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.write(JSON.stringify({ message: 'invalid format for backend server' }));
          return res.end();
        }

        disableServer(`${res[2]}/${res[1]}`)
          .then((() => {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.write(JSON.stringify({ message: 'ok' }));
            return res.end();
          }))
          .catch((e) => {
            res.writeHead(500, { 'Content-Type': 'application/json' });
            res.write(JSON.stringify(e));
            return res.end();
          });
        break;
    }
  }).listen(7778, (err) => {
    if (err) {
      throw err;
    }
    console.log('server listening on port 7778');
  });

  watcher = etcd.watcher(`/${config.get('etcd.dir')}/labels/${config.get('label')}/`, null, { recursive: true });
  watcher.on('change', (event) => {
    /*
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }

    timer = setTimeout(
      () => {
      */
    reRenderTemplate()
      .catch((e) => {
        switch (e.message) {
          case 'Config is the same, skipping reload.':
          case 'haproxy init script not available, skipping reload':
            console.info(e.message);
            break;
          default:
            console.error(e);
            break;
        }
      });
    /*
        timer = null;
      },
      2000);
      */
  });
}

let task;
if (argv.once) {
  task = renderTemplate()
    .then(cfg => writeFileAsync(`${config.get('path')}/haproxy.cfg`, cfg, 'utf-8'))
    .then(() => {
      console.log('config saved');
    });
} else {
  task = watch();
}

task.catch((err) => {
  console.error(err);
  if ('errors' in err) {
    err.errors.forEach((err) => {
      console.error(err);
    });
  }
  process.exit(1);
});
