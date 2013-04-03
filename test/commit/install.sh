#!/bin/bash
git checkout -b staging
echo >> server.js
git add server.js
git commit -m'nop'
