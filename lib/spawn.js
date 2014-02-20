var fs = require('fs');
var path = require('path');
var parseQuote = require('shell-quote').parse;
var clone = require('clone');
var spawn = require('child_process').spawn;
var through = require('through');

var EventEmitter = require('events').EventEmitter;

module.exports = function (commit, env) {
    var procs = new EventEmitter;
    var hosts = {};
    var streams = {};
    env.PATH = commit.dir + '/node_modules/.bin:' + env.PATH;
    env.BRANCH = commit.branch;
    env.COMMIT = commit.hash;
    env.REPO = commit.repo;
    
    fs.readFile(path.join(commit.dir, 'package.json'), function (err, src) {
        if (err && err.code === 'ENOENT') {
            src = JSON.stringify({ scripts: { start: 'node server.js' } });
        }
        else if (err) return procs.emit('error', err);
        
        try { var pkg = JSON.parse(src) }
        catch (e) { return procs.emit('error', e) }
        
        var win = /^win/.test(process.platform);
        var start = 'node server.js';
        if (pkg.scripts && pkg.scripts.start) {
            start = win ? 'cmd /c npm start' : 'npm start';
        }
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
        
        
        var beforeNpmInstall = win ? 'cmd /c npm install .' : 'npm install .';

        var before = commit._skipInstall || (err && err.code === 'ENOENT')
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
            if (!Array.isArray(cmd)) cmd = parseQuote(cmd);
            var ps = spawn(cmd[0], cmd.slice(1), { env: env, cwd: commit.dir });
            Object.keys(streams).forEach(function (key) {
                ps.stdout.pipe(streams[key], { end: false });
                ps.stderr.pipe(streams[key], { end: false });
            });
            procs.emit('spawn', ps, { command: cmd, commit: commit });
            
            var to = setTimeout(function () {
                ps.removeListener('exit', onexit);
                procs.emit('error', 'install took too long, aborting');
            }, 5 * 60 * 1000);
            
            ps.on('exit', onexit);
            function onexit (code) {
                clearTimeout(to);
                if (code !== 0) {
                    procs.emit('error', 'non-zero exit code ' + code
                        + ' from command: ' + cmd.join(' ')
                    );
                }
                else next()
            }
        })();
    });
    
    return procs;
    
    function runServers (start, stop) {
        var file = path.join(
            commit.dir,
            '..',
            commit.repo + '.' + commit.branch + '.json'
        );
        fs.writeFile(file, JSON.stringify(commit));
        
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
        if (!Array.isArray(cmd.start)) cmd.start = parseQuote(cmd.start);
        
        var ps = spawn(cmd.start[0], cmd.start.slice(1), {
            env: env,
            cwd: commit.dir
        });
        if (!/^_/.test(key)) ps.port = env.PORT;
        ps.key = key;
        ps.host = host;
        ps.killer = function () {
            var stop = cmd.stop;
            if (!stop) return ps.kill('SIGKILL');
            
            var env_ = clone(env);
            env_.PID = ps.pid;
            if (!Array.isArray(stop)) {
                stop = parseQuote(stop, env_);
            }
            var stopper = spawn(stop[0], stop.slice(1), {
                env: env_,
                cwd: commit.dir
            });
            stopper.stdout.pipe(streams[key], { end: false });
            stopper.stderr.pipe(streams[key], { end: false });
            procs.emit('spawn', stopper, { command: stop, commit: commit });
        };
        
        ps.on('exit', function (code) {
            procs.emit('exit', host, ps);
        });
        
        ps.stdout.pipe(streams[key], { end: false });
        ps.stderr.pipe(streams[key], { end: false });
        ps.respawn = function () {
            runCommands(key, cmd, env, 'restart');
        };
        procs.emit('spawn', ps, {
            command: cmd.start,
            commit: commit,
            key: key,
            host: host
        });
        procs.emit(evName || 'start', host, ps);
    }
};
