#!/bin/bash
rm -rf repo
mkdir -p repo
cd repo
cp ../source/$1/*.* .
git init .
git add *.*
git commit -m'initial files'
