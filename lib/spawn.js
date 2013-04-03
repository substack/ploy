var fs = require('fs');
var path = require('path');
var parseQuote = require('shell-quote').parse;
var clone = require('clone');

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
        
        runServers(start);
    });
    
    function runServers (start) {
        Object.keys(start).forEach(function (key) {
            var pEnv = clone(env);
            pEnv.PORT = Math.floor(Math.random()*(Math.pow(2,16)-1024)+1024);
            var host = (key === 'index' ? '' : key + '.') + commit.branch;
            runCommands(host, start[key], pEnv);
        });
    }
    
    function runCommands (host, cmd, env) {
        if (!Array.isArray(cmd)) cmd = parseQuote(cmd);
        var ps = commit.spawn(cmd, { env: env });
        ps.port = env.PORT;
        ps.host = host;
        ps.stdout.pipe(process.stdout, { end: false });
        ps.stderr.pipe(process.stderr, { end: false });
        ps.respawn = function () { runCommands(host, cmd, env) };
        cb(null, ps);
    }
};
