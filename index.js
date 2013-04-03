var bouncy = require('bouncy');
var cicada = require('cicada');

var path = require('path');
var fs = require('fs');

var clone = require('clone');
var parseQuote = require('shell-quote').parse;
var spawn = require('child_process').spawn;

module.exports = function (opts) {
    if (!opts) opts = {};
    if (typeof opts === 'string') {
        opts = {
            repodir: path.resolve(opts + '/repo'),
            workdir: path.resolve(opts + '/work')
        };
    }
    return new Ploy(opts);
};

function Ploy (opts) {
    var self = this;
    self.branches = {};
    self.delay = opts.delay == undefined ? 3000 : opts.delay;
    
    self.ci = cicada(opts);
    self.ci.on('commit', self.deploy.bind(self));
    
    self.bouncer = bouncy(opts, function (req, res, bounce) {
        var host = (req.headers.host || '').split(':')[0];
        var parts = host.split('.');
        var subdomain = parts.slice(0,-2).join('.')
            || parts.slice(0,-1).join('.')
        ;
        var branch = self.branches[subdomain] ? subdomain : 'master';
        
        if (RegExp('^/_ploy\\b').test(req.url)) {
            if (opts.auth) {
                var au = req.headers.authorization;
                var m = /^basic\s+(\S+)/i.exec(au);
                if (!m) return prohibit('ACCESS DENIED');
                var s = Buffer(m[1], 'base64').toString().split(':');
                var user = s[0], token = s[1];
                if (!opts.auth[user] || opts.auth[user] !== token) {
                    return prohibit('ACCESS DENIED');
                }
            }
            self.handle(req, res);
        }
        else if (self.branches[branch]) {
            bounce(self.branches[branch]);
        }
        else {
            res.statusCode = 404;
            res.end('host not found\n');
        }
        
        function prohibit (msg) {
            res.statusCode = 401;
            res.setHeader('www-authenticate', 'basic');
            res.end(msg + '\n');
        }
    });
    
    self.restore();
}

Ploy.prototype.restore = function () {
    var self = this;
    
    fs.readdir(self.ci.repodir, function (err, repos) {
        if (err) return;
        repos.forEach(function (repo) {
            var dir = path.join(self.ci.repodir, repo, 'refs', 'heads');
            fs.readdir(dir, function (err, refs) {
                if (err) return;
                refs.forEach(readCommit.bind(null, repo));
            });
        });
    });
    
    function readCommit (repo, ref) {
        var file = path.join(self.ci.repodir, repo, 'refs', 'heads', ref);
        fs.readFile(file, function (err, src) {
            if (err) return console.error(err);
            restore(repo, ref, String(src).trim());
        });
    }
    
    function restore (repo, ref, commit) {
        var dir = path.join(self.ci.repodir, repo);
        var target = {
            repo: repo,
            branch: ref,
            commit: commit
        };
        self.ci.checkout(target, function (err, commit) {
            if (err) console.error(err)
            else self.deploy(commit)
        });
    }
};

Ploy.prototype.deploy = function (commit) {
    var self = this;
    
    var env = clone(process.env);
    var port = Math.floor(Math.random() * (Math.pow(2,16)-1024) + 1024);
    env.PORT = port;
    
    spawnProcess(commit, env, function (err, ps) {
        if (err) return console.error(err)
        
        var to = setTimeout(function () {
            // didn't crash in 3 seconds, add to routing table
            if (self.branches[commit.branch]) {
                self.remove(commit.branch);
            }
            self.add(commit.branch, {
                port: port,
                hash: commit.hash,
                repo: commit.repo,
                process: ps
            });
        }, self.branches[commit.branch] ? self.delay : 0);
        
        ps.on('exit', function (code) {
            clearTimeout(to);
            
            var b = self.branches[commit.branch];
            if (b && b.hash === commit.hash) {
                self.remove(commit.branch);
                self.deploy(commit);
            }
        });
    });
};

Ploy.prototype.add = function (name, rec) {
    if (this.branches[name]) this.remove(name);
    this.branches[name] = rec;
};

Ploy.prototype.remove = function (name) {
    var b = this.branches[name];
    if (b) b.process.kill();
    delete this.branches[name];
    spawn('git', [ 'branch', '-D', name ], {
        cwd: path.join(this.ci.repodir, b.repo)
    });
};

Ploy.prototype.restart = function (name) {
    var b = this.branches[name];
    if (b) b.process.kill();
};

Ploy.prototype.move = function (src, dst) {
    if (!this.branches[src]) return;
    if (this.branches[dst]) this.remove(dst);
    this.branches[dst] = this.branches[src];
    delete this.branches[src];
};

Ploy.prototype.listen = function () {
    return this.bouncer.listen.apply(this.bouncer, arguments);
};

Ploy.prototype.address = function () {
    return this.bouncer.address.apply(this.bouncer, arguments);
};

Ploy.prototype.close = function () {
    this.bouncer.close();
};

Ploy.prototype.handle = function (req, res) {
    if (RegExp('^/_ploy/[^?]+\\.git\\b').test(req.url)) {
        req.url = req.url.replace(RegExp('^/_ploy/'), '/');
        this.ci.handle(req, res);
    }
    else if (RegExp('^/_ploy/move/').test(req.url)) {
        var xs = req.url.split('/').slice(3);
        var src = xs[0], dst = xs[1];
        this.move(src, dst);
        res.end();
    }
    else if (RegExp('^/_ploy/remove/').test(req.url)) {
        var name = req.url.split('/')[3];
        this.remove(name);
        res.end();
    }
    else if (RegExp('^/_ploy/list').test(req.url)) {
        res.end(Object.keys(this.branches)
            .map(function (s) { return s + '\n' })
            .join('')
        );
    }
    else if (RegExp('^/_ploy/restart/').test(req.url)) {
        var name = req.url.split('/')[3];
        this.restart(name);
        res.end();
    }
};

function spawnProcess (commit, env, cb) {
    // `npm start` ignores too many signals
    var queue = [];
    
    fs.readFile(path.join(commit.dir, 'package.json'), function (err, src) {
        if (err && err.code === 'ENOENT') {
            src = JSON.stringify({ scripts: { start: 'node server.js' } });
        }
        else if (err) return cb(err);
        
        try { var pkg = JSON.parse(src) }
        catch (e) { return cb(e) }
        
        /*
        if (scripts) {
            queue.push.apply(queue, [
                pkg.scripts.preinstall, pkg.scripts.install
            ].filter(Boolean));
        }
        */
        
        var start = pkg.scripts && pkg.scripts.start || 'node server.js';
        queue.push(start);
        
        runCommands();
    });
    
    function runCommands () {
        var cmd = queue.shift();
        if (!Array.isArray(cmd)) cmd = parseQuote(cmd);
        var ps = commit.spawn(cmd, { env: env });
        
        if (queue.length === 0) cb(null, ps)
        else ps.on('exit', function (code) {
            if (code !== 0) runCommands()
            else cb('non-zero exit code running ' + cmd.join(' '))
        });
    }
}
