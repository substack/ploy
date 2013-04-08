#!/bin/bash
git checkout -b staging
sed -i 's/BEEP/dino/g' beep.js
sed -i 's/BOOP/saur/g' boop.js
git add beep.js boop.js
git commit -m'rawr!'
