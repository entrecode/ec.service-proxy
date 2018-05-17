FROM node:10.0-alpine

LABEL maintainer="Simon Scherzinger <scherzinger@entrecode.de>"

WORKDIR /usr/src/app

ENV HAPROXY_MAJOR 1.8
ENV HAPROXY_VERSION 1.8.8
ENV HAPROXY_MD5 8633b6e661169d2fc6a44d82a3aceae5

# see https://sources.debian.net/src/haproxy/jessie/debian/rules/ for some helpful navigation of the possible "make" arguments
RUN set -x \
  \
  # install dependencies for HAProxy
  && apk add --no-cache --virtual .build-deps \
  ca-certificates \
  gcc \
  libc-dev \
  linux-headers \
  lua5.3-dev \
  make \
  openssl \
  openssl-dev \
  pcre-dev \
  readline-dev \
  tar \
  zlib-dev \
  \
  # install HAProxy
  && wget -O haproxy.tar.gz "https://www.haproxy.org/download/${HAPROXY_MAJOR}/src/haproxy-${HAPROXY_VERSION}.tar.gz" \
  && echo "$HAPROXY_MD5 *haproxy.tar.gz" | md5sum -c \
  && mkdir -p /usr/src/haproxy \
  && tar -xzf haproxy.tar.gz -C /usr/src/haproxy --strip-components=1 \
  && rm haproxy.tar.gz \
  && makeOpts=' \
  TARGET=linux2628 \
  USE_LUA=1 LUA_INC=/usr/include/lua5.3 LUA_LIB=/usr/lib/lua5.3 \
  USE_OPENSSL=1 \
  USE_PCRE=1 PCREDIR= \
  USE_ZLIB=1 \
  ' \
  && make -C /usr/src/haproxy -j "$(getconf _NPROCESSORS_ONLN)" all $makeOpts \
  && make -C /usr/src/haproxy install-bin $makeOpts \
  && mkdir -p /usr/local/etc/haproxy \
  && cp -R /usr/src/haproxy/examples/errorfiles /usr/local/etc/haproxy/errors \
  && rm -rf /usr/src/haproxy \
  && runDeps="$( \
  scanelf --needed --nobanner --format '%n#p' --recursive /usr/local \
  | tr ',' '\n' \
  | sort -u \
  | awk 'system("[ -e /usr/local/lib/" $1 " ]") == 0 { next } { print "so:" $1 }' \
  )" \
  && apk add --virtual .haproxy-rundeps $runDeps \
  && apk del .build-deps \
  \
  # install rsyslogd, openrc, and tini
  && apk add --no-cache rsyslog tini openrc ruby git \
  && touch /var/log/haproxy.log \
  && ln -sf /dev/stdout /var/log/haproxy.log \
  && mkdir -p /usr/src/app \
  && mkdir -p /var/run/haproxy \
  && mkdir -p /etc/haproxy \
  && mkdir -p /var/lib/haproxy \
  && mkdir -p /etc/rsyslog.d/ \
  && git clone https://github.com/flores/haproxyctl.git \
  && ln -s /usr/src/app/haproxyctl/bin/haproxyctl /etc/init.d/haproxyctl

COPY rsyslog.conf /etc
COPY init.sh /etc/init.d/haproxy
ENTRYPOINT ["/sbin/tini", "--", "./entrypoint.sh" ]
CMD ["npm", "start"]

COPY package* ./
RUN apk add --no-cache --virtual .node-deps python make g++ \
  && npm i --only=prod && npm cache clean --force \
  && apk del .node-deps \
  && chmod +x /etc/init.d/haproxy
COPY . .
RUN chmod +x entrypoint.sh
