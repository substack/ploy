var fs = require('fs');
var path = require('path');
var parseQuote = require('shell-quote').parse;
var clone = require('clone');
var spawn = require('child_process').spawn;
var through = require('through2');

var win = /^win/.test(process.platform);
var beforeNpmInstall = win ? 'cmd /c npm install .' : 'npm install .';

var spawnShell = (function () {
    var sh;
    if (process.env.SHELL) sh = [ process.env.SHELL ];
    else if (win) sh = [ 'cmd', '/c' ]
    else sh = [ 'bash' ];

    if (sh[0] === 'cmd' && win) sh.push('/c');
    else sh.push('-c');

    return function spawnShell (cmd, opts) {
        return spawn(sh[0], sh.slice(1).concat(cmd), opts);
    };
})();

var EventEmitter = require('events').EventEmitter;

module.exports = function (commit, env) {
    var procs = new EventEmitter;
    var hosts = {};
    var streams = {};
    env.PATH = commit.dir + '/node_modules/.bin:' + env.PATH;
    env.BRANCH = commit.branch;
    env.COMMIT = commit.hash;
    env.REPO = commit.repo;
    
    var serviceFile = path.join(commit.dir, '..',
        commit.repo + '.' + commit.branch + '.json'
    );
    
    var pending = 2;
    fs.readFile(serviceFile, function (err, src) {
        if (err) return done();
        try { var prev = JSON.parse(src) }
        catch (e) { return done() }
        
        commit.prev = prev;
        env.PREV = prev.dir;
        env.PREV_COMMIT = prev.hash;
        env.PREV_BRANCH = prev.branch;
        
        done();
    });
    
    var pkg, pkgerr;
    fs.readFile(path.join(commit.dir, 'package.json'), function (err, src) {
        if (err && err.code === 'ENOENT') {
            src = JSON.stringify({ scripts: { start: 'node server.js' } });
            pkgerr = err;
        }
        else if (err) return procs.emit('error', err);
        
        try { pkg = JSON.parse(src) }
        catch (e) { return procs.emit('error', e) }
        
        done();
    });
    
    function done () {
        if (--pending !== 0) return;
        
        var start = pkg.scripts && pkg.scripts.start || 
                    pkg.main && 'node ' + pkg.main || 
                    'node server.js';
        if (typeof start === 'string') {
            start = { 'index': start };
        }
        Object.keys(start).forEach(function (key) {
            hosts[key] = (key === 'index' ? '' : key + '.') + commit.branch;
            if (!streams[key]) {
                streams[key] = through();
                procs.emit('output', hosts[key], streams[key]);
            }
            procs.on('error', function (err) {
                streams[key].write(String(err) + '\n');
            });
        });
        var stop = pkg.scripts && pkg.scripts.stop || {};
        if (typeof stop === 'string') {
            stop = { 'index': stop }
        }
        
        var before = commit._skipInstall || (pkgerr && pkgerr.code === 'ENOENT')
            ? [] : [ beforeNpmInstall ]
        ;
        if (before.length && pkg.scripts && (win || process.getuid() === 0)) {
            if (pkg.scripts.preinstall) before.unshift(pkg.scripts.preinstall);
            if (pkg.scripts.install) before.push(pkg.scripts.install);
            if (pkg.scripts.postinstall) before.push(pkg.scripts.postinstall);
        }
        if (pkg.scripts && pkg.scripts.test) before.push(pkg.scripts.test);
        
        (function next () {
            if (before.length === 0) return runServers(start, stop);
            
            var cmd = before.shift();
            var ps = spawnShell(cmd, { env: env, cwd: commit.dir });
            Object.keys(streams).forEach(function (key) {
                ps.stdout.pipe(streams[key], { end: false });
                ps.stderr.pipe(streams[key], { end: false });
            });
            procs.emit('spawn', ps, { command: cmd, commit: commit });
            
            var to = setTimeout(function () {
                ps.removeListener('exit', onexit);
                procs.emit('error', 'install took too long, aborting');
            }, 5 * 60 * 1000);
            
            ps.on('error', function onError (err) {
                return procs.emit('error', err);
            });

            ps.on('exit', onexit);
            function onexit (code) {
                clearTimeout(to);
                if (code !== 0) {
                    procs.emit('error', 'non-zero exit code ' + code
                        + ' from command: ' + cmd
                    );
                }
                else next()
            }
        })();
    }
    
    return procs;
    
    function runServers (start, stop) {
        fs.writeFile(serviceFile, JSON.stringify(commit));
        
        Object.keys(start).forEach(function (key) {
            var pEnv = clone(env);
            if (!/^_/.test(key)) {
                var p = Math.floor(Math.random()*(Math.pow(2,16)-1024)+1024);
                pEnv.PORT = p;
            }
            runCommands(key, { start: start[key], stop: stop[key] }, pEnv);
        });
    }
    
    function runCommands (key, cmd, env, evName) {
        var host = hosts[key];
        
        var ps = spawnShell(cmd.start, { env: env, cwd: commit.dir });
        if (!/^_/.test(key)) ps.port = env.PORT;
        ps.key = key;
        ps.host = host;
        ps.killer = function () {
            if (!cmd.stop) return ps.kill('SIGKILL');
            
            var env_ = clone(env);
            env_.PID = ps.pid;
            var stopper = spawnShell(cmd.stop, { env: env_, cwd: commit.dir });
            stopper.stdout.pipe(streams[key], { end: false });
            stopper.stderr.pipe(streams[key], { end: false });
            procs.emit('spawn', stopper, {
                command: cmd.stop,
                commit: commit,
                env: env_
            });
        };
        
        ps.on('exit', function (code) {
            procs.emit('exit', host, ps);
        });
        
        ps.stdout.pipe(streams[key], { end: false });
        ps.stderr.pipe(streams[key], { end: false });
        ps.respawn = function () {
            runCommands(key, cmd, env, 'restart');
        };
        var env_ = clone(env);
        env_.PID = ps.pid;
        procs.emit('spawn', ps, {
            command: cmd.start,
            commit: commit,
            env: env_,
            key: key,
            host: host
        });
        procs.emit(evName || 'start', host, ps);
    }
};
