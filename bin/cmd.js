#!/usr/bin/env node

var ploy = require('../');
var argv = require('optimist').argv;
var exec = require('child_process').exec;
var hyperquest = require('hyperquest');

var fs = require('fs');
var path = require('path');

var cmd = argv._[0];
if (cmd === 'help' || argv.h || argv.help || process.argv.length <= 2) {
    var h = argv.h || argv.help || argv._[1];
    var helpFile = typeof h === 'string' ? h : 'usage';
    
    var rs = fs.createReadStream(__dirname + '/' + helpFile + '.txt')
    rs.on('error', function () {
        console.log('No help found for ' + h);
    });
    rs.pipe(process.stdout);
}
else if (cmd === 'list' || cmd === 'ls') {
    getRemote(function (err, remote) {
        if (err) return error(err);
        
        var hq = hyperquest(remote + '/list');
        hq.pipe(process.stdout);
        hq.on('error', function (err) {
            var msg = 'Error connecting to ' + remote + ': ' + err.message;
            console.error(msg);
        });
    });
}
else if (cmd === 'move' || cmd === 'mv') {
    argv._.shift();
    var src = argv.src || argv._.shift();
    var dst = argv.dst || argv._.shift();
    getRemote(function (err, remote) {
        if (err) return error(err);
        
        var hq = hyperquest(remote + '/move/' + src + '/' + dst);
        hq.pipe(process.stdout);
        hq.on('error', function (err) {
            var msg = 'Error connecting to ' + remote + ': ' + err.message;
            console.error(msg);
        });
    });
}
else if (cmd === 'remove' || cmd === 'rm') {
    argv._.shift();
    var name = argv.name || argv._.shift();
    getRemote(function (err, remote) {
        if (err) return error(err);
        
        var hq = hyperquest(remote + '/remove/' + name);
        hq.pipe(process.stdout);
        hq.on('error', function (err) {
            var msg = 'Error connecting to ' + remote + ': ' + err.message;
            console.error(msg);
        });
    });
}
else {
    var dir = path.resolve(argv.dir || argv.d || argv._.shift() || '.');
    var authFile = argv.auth || argv.a;
    var opts = {
        repodir: path.join(dir, 'repo'),
        workdir: path.join(dir, 'work'),
        auth: authFile && JSON.parse(fs.readFileSync(authFile))
    };
    
    var server = ploy(opts);
    server.listen(argv.port || argv.p || 80);
    
    if (argv.ca || argv.pfx) {
        var sopts = {};
        if (argv.ca) sopts.ca = fs.readFileSync(argv.ca);
        if (argv.key) sopts.key = fs.readFileSync(argv.key);
        if (argv.cert) sopts.cert = fs.readFileSync(argv.cert);
        if (argv.pfx) sopts.pfx = fs.readFileSync(argv.pfx);
        sopts.port = argv.sslPort || argv.s || 443;
        server.listen(sopts);
    }
}

function error (err) {
    console.error(err);
    process.exit(1);
}

function getRemote (cb) {
    getRemotes(function (err, remotes) {
        if (err) cb(err)
        else if (remotes.length === 0) {
            cb('No matching ploy remotes found. Add a remote or use -r.');
        }
        else if (remotes.length >= 2) {
            cb('More than one matching ploy remote. Disambiguate with -r.');
        }
        else cb(null, remotes[0]);
    });
}

function getRemotes (cb) {
    var r = argv.r || argv.remote;
    if (/^https?:/.test(r)) {
        if (!/\/_ploy\b/.test(r)) r = r.replace(/\/*$/, '/_ploy');
        return cb(null, [ r.replace(/\/_ploy\b.*/, '/_ploy') ]);
    }
    
    exec('git remote -v', function (err, stdout, stderr) {
        if (err) return cb(err);
        
        var remotes = stdout.split('\n').reduce(function (acc, line) {
            var xs = line.split(/\s+/);
            var name = xs[0], href = xs[1];
            var re = RegExp('^https?://[^?#]+/_ploy/[^?#]+\\.git$');
            if (re.test(href)) {
                acc[name] = href.replace(RegExp('/_ploy/.+'), '/_ploy');
            }
            return acc;
        }, {});
        
        if (r) cb(null, [ remotes[r] ].filter(Boolean));
        else cb(null, Object.keys(remotes).map(function (name) {
            return remotes[name];
        }));
    });
}
