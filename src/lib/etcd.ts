import * as config from 'config';
import * as Etcd from 'node-etcd';
import * as fs from 'fs';
import { promisify } from 'util';

const etcdHosts: string = config.get('etcd.hosts');
const etcdOpts: any = {
  maxRetries: 3,
};

if (config.has('etcd.cert')) {
  etcdOpts.cert = fs.readFileSync(config.get('etcd.cert'));
  etcdOpts.key = fs.readFileSync(config.get('etcd.key'));

  if (config.has('etcd.ca')) {
    etcdOpts.ca = fs.readFileSync(config.get('etcd.ca'));
  }
}

export const etcd = new Etcd(etcdHosts.split(',').map(x => x.trim()), etcdOpts);
etcd.getAsync = promisify(etcd.get);
