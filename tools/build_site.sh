#!/bin/sh
# Copy only the files the live site needs into dist/, which Cloudflare serves (see wrangler.jsonc).
# A whitelist on purpose: data/raw, tools, tests, docs and node_modules never reach the site.
set -eu
cd "$(dirname "$0")/.."
rm -rf dist
mkdir -p dist/data
cp index.html drr.html dist/
cp -R src dist/src
cp -R data/web dist/data/web
find dist -name .DS_Store -delete
echo "dist/: $(find dist -type f | wc -l | tr -d ' ') files, $(du -sh dist | cut -f1)"
