#!/bin/sh
# Render the SRS config, start SRS, wait for it, then exec the media-node binary.
# The media-node binary supervises SRS (watchdog: exits if SRS is down >30s).
set -e

CONF_DIR=/usr/local/srs/conf
CANDIDATE="${SRS_RTC_CANDIDATE:-127.0.0.1}"

mkdir -p "$CONF_DIR" /records/_tmp

# Render the SRS config template (substitute $CANDIDATE and $HTTP_HOOK_PORT)
sed -e "s#\$CANDIDATE#${CANDIDATE}#g" \
    /srs-node.conf.template > "${CONF_DIR}/srs.conf"

echo "[node-entrypoint] candidate=${CANDIDATE}"
echo "[node-entrypoint] starting SRS..."

# Start SRS as a background child
/usr/local/srs/objs/srs -c "${CONF_DIR}/srs.conf" &
SRS_PID=$!

# Wait for SRS API to be reachable (max 10s)
i=0
while [ $i -lt 20 ]; do
  if wget -q -O /dev/null "http://127.0.0.1:1985/api/v1/versions" 2>/dev/null; then
    echo "[node-entrypoint] SRS is up (pid=${SRS_PID})"
    break
  fi
  i=$((i + 1))
  sleep 0.5
done

if [ $i -ge 20 ]; then
  echo "[node-entrypoint] WARNING: SRS API did not respond within 10s"
fi

# Forward SIGTERM to SRS when the container stops
trap 'kill ${SRS_PID} 2>/dev/null || true' TERM INT

echo "[node-entrypoint] starting media-node..."
exec /usr/local/bin/media-node
