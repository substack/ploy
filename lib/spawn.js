var fs = require('fs');
var path = require('path');
var parseQuote = require('shell-quote').parse;
var clone = require('clone');
var spawn = require('child_process').spawn;

module.exports = function (commit, env, cb) {
    fs.readFile(path.join(commit.dir, 'package.json'), function (err, src) {
        if (err && err.code === 'ENOENT') {
            src = JSON.stringify({ scripts: { start: 'node server.js' } });
        }
        else if (err) return cb(err);
        
        try { var pkg = JSON.parse(src) }
        catch (e) { return cb(e) }
        
        var start = pkg.scripts && pkg.scripts.start || 'node server.js';
        if (typeof start === 'string') {
            start = { 'index': start };
        }
        
        var before = commit._skipInstall ? [] : [ 'npm install .' ];
        
        (function next () {
            if (before.length === 0) return runServers(start);
            
            var cmd = before.shift();
            if (!Array.isArray(cmd)) cmd = parseQuote(cmd);
            var ps = spawn(cmd[0], cmd.slice(1), { env: env, cwd: commit.dir });
            ps.stdout.pipe(process.stdout, { end: false });
            ps.stderr.pipe(process.stderr, { end: false });
            
            var to = setTimeout(function () {
                ps.removeListener('exit', onexit);
                cb('install took too long, aborting');
            }, 5 * 60 * 1000);
            
            ps.on('exit', onexit);
            function onexit (code) {
                clearTimeout(to);
                if (code !== 0) {
                    cb('non-zero exit code ' + code
                        + ' from command: ' + cmd.join(' ')
                    );
                }
                else next()
            }
        })();
    });
    
    function runServers (start) {
        var file = path.join(
            commit.dir,
            '..',
            commit.repo + '.' + commit.branch + '.json'
        );
        fs.writeFile(file, JSON.stringify(commit));
        
        Object.keys(start).forEach(function (key) {
            var pEnv = clone(env);
            pEnv.PORT = Math.floor(Math.random()*(Math.pow(2,16)-1024)+1024);
            runCommands(key, start[key], pEnv);
        });
    }
    
    function runCommands (key, cmd, env) {
        var host = (key === 'index' ? '' : key + '.') + commit.branch;
        if (!Array.isArray(cmd)) cmd = parseQuote(cmd);
        
        var ps = spawn(cmd[0], cmd.slice(1), { env: env, cwd: commit.dir });
        ps.port = env.PORT;
        ps.key = key;
        ps.host = host;
        
        ps.stdout.pipe(process.stdout, { end: false });
        ps.stderr.pipe(process.stderr, { end: false });
        ps.respawn = function () { runCommands(host, cmd, env) };
        cb(null, ps);
    }
};
