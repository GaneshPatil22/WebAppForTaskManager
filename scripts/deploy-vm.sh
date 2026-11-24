#!/usr/bin/env bash
# Deploys dist/ to the Oracle VM, where the shared Caddy serves it at
# https://brain.corelearnly.com (from ~/n8n/site/brain, seen as /srv/brain).
#
#   SSH_KEY=/path/to/key make deploy
#
# The new build is unpacked beside the live one and swapped in with two
# renames, so a visitor never gets a half-uploaded site.
set -euo pipefail

HOST="${DEPLOY_HOST:-ubuntu@80.225.212.198}"
: "${SSH_KEY:?set SSH_KEY to the private key of the VM}"
[ -f dist/index.html ] || { echo "no dist/: run make build-prod first"; exit 1; }

# COPYFILE_DISABLE and --no-xattrs: macOS tar would otherwise ship ._* files.
COPYFILE_DISABLE=1 tar --no-xattrs -C dist -cz . |
  ssh -i "$SSH_KEY" -o BatchMode=yes "$HOST" 'set -e
    S=/home/ubuntu/n8n/site
    sudo rm -rf "$S/brain.new" && sudo mkdir -p "$S/brain.new"
    sudo tar --no-same-owner -xz -C "$S/brain.new"
    sudo chown -R root:root "$S/brain.new" && sudo chmod -R a+rX "$S/brain.new"
    [ -d "$S/brain" ] && sudo mv "$S/brain" "$S/brain.old"
    sudo mv "$S/brain.new" "$S/brain"
    sudo rm -rf "$S/brain.old"
    echo "deployed:"; ls -la "$S/brain"'
