#!/bin/bash
git checkout -b staging
echo '// nop' >> server.js
git add server.js
git commit -m'nop'
