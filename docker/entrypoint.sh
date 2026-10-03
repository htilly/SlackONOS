#!/bin/sh
# Start SlackONOS as an unprivileged user (security review O-007).
#
# The container still starts as root so it can fix ownership of the mounted
# config volume first: installs that ran the old root-only image have
# root-owned files there (config.json, userActions.json, blacklists, WebAuthn
# credentials, SSL cert), which the unprivileged user could not write.
#
# PUID / PGID pick the user to run as (default 1000 = the image's "node"
# user), e.g. to match the owner of the config folder on a NAS host.
# Starting the container with --user skips this and runs as that user as-is.
set -e

CONFIG_DIR=/app/config

if [ "$(id -u)" = "0" ]; then
  PUID="${PUID:-1000}"
  PGID="${PGID:-1000}"

  mkdir -p "$CONFIG_DIR"
  # Only touch what is not already owned correctly, so restarts stay fast.
  find "$CONFIG_DIR" \( ! -user "$PUID" -o ! -group "$PGID" \) -exec chown "$PUID:$PGID" {} +

  export HOME=/home/node
  exec setpriv --reuid="$PUID" --regid="$PGID" --clear-groups -- "$@"
fi

exec "$@"
