#!/bin/bash
git checkout -b staging
sed -i 's/beep boop/rawr/g' server.js
git add server.js
git commit -m'rawr!'
