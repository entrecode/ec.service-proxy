#!/bin/sh

set -eo pipefail

rm -f /var/run/rsyslogd.pid
rsyslogd

if [ "$1" = 'haproxy' ]; then
	# Loop until templating has updated the nginx config
  echo "waiting for node template to refresh config"
  until node dist/index.js --once; do
    echo "waiting for node template to refresh config"
    sleep 5
  done

  # Run templating in the background to watch the upstream servers
  echo "start node template watcher..."
  node dist/index.js --daemon

  # Start haproxy
  shift # "haproxy"
	# if the user wants "haproxy", let's add a couple useful flags
	#   -W  -- "master-worker mode" (similar to the old "haproxy-systemd-wrapper"; allows for reload via "SIGUSR2")
	#   -db -- disables background mode
	set -- haproxy -W -db "$@"

  echo "starting haproxy service..."
fi

exec "$@"
