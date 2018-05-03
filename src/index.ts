import { argv } from 'yargs';
import * as config from 'config';
import { writeFile } from 'fs';
import * as nunjucks from 'nunjucks';
import { promisify } from 'util';

import etcd from './lib/etcd';

const writeFileAsync = promisify(writeFile);

process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

if (argv.once && argv.daemon) {
  throw new Error('can either run in daemon mode or in once mode');
}

if (!argv.once && !argv.daemon) {
  throw new Error('must select either daemon mode or once mode');
}

async function renderTemplate() {
  const key = `/${config.get('etcd.dir')}/labels/${config.get('label')}/`;
  const { node: { nodes } } = await etcd.etcd.getAsync(key);

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
        etcd.etcd.getAsync(`/${config.get('etcd.dir')}/labels/name/${hosts[host][0]}`),
        ...hosts[host].map(id => etcd.etcd.getAsync(`/${config.get('etcd.dir')}/labels/io.rancher.container.ip/${id}`)),
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

async function watch() {
  // TODO attach watcher
  // TODO create config
  // TODO compare config
  // TODO reload haproxy if config changed
}

let task;
if (argv.once) {
  task = renderTemplate()
    .then(cfg => writeFileAsync(`${config.get('path')}/haproxy.cfg`, cfg, 'utf-8'));
} else {
  task = watch();
}

task
  .then(() => {
    console.log('... done.');
    process.exit(0);
  })
  .catch((err) => {
    console.error(err);
    if ('errors' in err) {
      err.errors.forEach((err) => {
        console.error(err);
      });
    }
    process.exit(1);
  });
