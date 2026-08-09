#!/bin/sh
# Render the SRS config template (substitute $CANDIDATE from env), then exec SRS.
#
# The stock ossrs/srs image does NOT envsubst a mounted config, so a literal
# `candidate $CANDIDATE;` would ship to SRS unexpanded and break WebRTC. This
# wrapper fills it in from $SRS_RTC_CANDIDATE (defaults to 127.0.0.1) before
# launching SRS at its standard binary path.
#
# Only WebRTC needs the candidate; HTTP-FLV playback (the primary path) works
# without it. http_hooks already point at the stable compose hostname `app`.
set -e

CONF_DIR=/usr/local/srs/conf
CANDIDATE="${SRS_RTC_CANDIDATE:-127.0.0.1}"

mkdir -p "$CONF_DIR"
sed "s#\$CANDIDATE#${CANDIDATE}#g" /srs.conf.template > "${CONF_DIR}/srs.conf"

echo "[srs-entrypoint] candidate=${CANDIDATE}"
exec /usr/local/srs/objs/srs -c "${CONF_DIR}/srs.conf"
