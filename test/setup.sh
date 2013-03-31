#!/bin/bash
mkdir -p repo
cd repo
cp ../source/package.json ../source/server.js .
git init .
git add package.json server.js
git commit -m'initial files'
