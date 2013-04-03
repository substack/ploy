#!/bin/bash
mkdir -p repo
cd repo
cp ../source/$1/package.json ../source/$1/server.js .
git init .
git add package.json server.js
git commit -m'initial files'
