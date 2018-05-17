#!/bin/sh

set -eo pipefail

rm -f /var/run/rsyslogd.pid
rsyslogd

if [ "$1" = 'npm' ] && [ "$2" = 'start' ]; then
	# Loop until templating has updated the nginx config
  echo "waiting for node template to refresh config"
  until node dist/index.js --once; do
    echo "waiting for node template to refresh config"
    sleep 5
  done

  /etc/init.d/haproxy start # todo with haproxyctl

  echo "start node template watcher..."
fi

exec "$@"
