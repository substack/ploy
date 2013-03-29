#!/bin/bash
if test $(basename $PWD)="repo" -a -d .git; then
    git reset --hard $(git log | grep ^commit | tail -n1 | sed 's/^commit //')
    rm -rf .git
fi
