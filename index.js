var bouncy = require('bouncy');
var cicada = require('cicada');
var quotemeta = require('quotemeta');
var mkdirp = require('mkdirp');

var path = require('path');
var fs = require('fs');
var EventEmitter = require('events').EventEmitter;
var inherits = require('inherits');

var qs = require('querystring');
var url = require('url');
var sliceFile = require('slice-file');

var clone = require('clone');
var spawn = require('child_process').spawn;
var spawnProcess = require('./lib/spawn');

module.exports = function (opts) {
    if (!opts) opts = {};
    if (typeof opts === 'string') {
        opts = {
            repodir: path.resolve(opts + '/repo'),
            workdir: path.resolve(opts + '/work'),
            logdir: path.resolve(opts + '/log')
        };
    }
    return new Ploy(opts);
};

inherits(Ploy, EventEmitter);

function Ploy (opts) {
    var self = this;
    self.branches = {};
    self.delay = opts.delay == undefined ? 3000 : opts.delay;
    self.regexp = null;
    self._keys = {};
    self.workdir = opts.workdir;
    self.logdir = opts.logdir;
    if (opts.logdir) mkdirp(opts.logdir);
    
    self.ci = cicada(opts);
    self.ci.on('commit', self.deploy.bind(self));
    
    self.bouncers = [];
    self.auth = opts.auth;
    self.restore();
}

Ploy.prototype.createBouncer = function (opts) {
    var self = this;
    return bouncy(opts, function (req, res, bounce) {
        var host = (req.headers.host || '').split(':')[0];
        var parts = host.split('.');
        var subdomain;
        if (self.regexp) {
            var m = host.match(self.regexp);
            if (m) subdomain = self._keys[m[1]] || m[1];
        }
        if (!subdomain) subdomain = parts.slice(0,-2).join('.')
            || parts.slice(0,-1).join('.')
        ;
        var branch = (self.branches[subdomain] && subdomain) || 'master';
        
        if (RegExp('^/_ploy\\b').test(req.url)) {
            if (self.auth) {
                var au = req.headers.authorization;
                var m = /^basic\s+(\S+)/i.exec(au);
                if (!m) return prohibit('ACCESS DENIED');
                var s = Buffer(m[1], 'base64').toString().split(':');
                var user = s[0], token = s[1];
                if (!self.auth[user] || self.auth[user] !== token) {
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
            res.setHeader('connection', 'close');
            res.end(msg + '\n');
        }
    });
};

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
            checkExisting(repo, ref, String(src).trim());
        });
    }
    
    function checkExisting (repo, ref, hash) {
        var file = path.join(self.workdir, repo + '.' + ref + '.json');
        fs.readFile(file, function (err, src) {
            if (err) return restore(repo, ref, hash);
            try { var commit = JSON.parse(String(src)) }
            catch (e) { return restore(repo, ref, hash) }
            
            commit._skipInstall = true;
            self.deploy(commit);
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
    var procs = spawnProcess(commit, env);
    procs.on('error', function (err) { console.error(err) });
    
    procs.on('spawn', function (ps, sp) {
        self.emit('spawn', ps, sp);
    });
    
    procs.on('output', function (name, stream) {
        if (self.logdir) {
            var file = path.join(self.logdir, name);
            var ws = fs.createWriteStream(file, { flags: 'a' });
            stream.pipe(ws);
        }
        self.emit('output', name, stream);
    });
    
    procs.on('run', function (name, ps) {
        self.emit('run', name, ps);
        
        var to = setTimeout(function () {
            // didn't crash in 3 seconds, add to routing table
            if (self.branches[name]) {
                self.remove(name);
            }
            self.add(name, {
                port: ps.port,
                hash: commit.hash,
                repo: commit.repo,
                branch: commit.branch,
                key: ps.key,
                process: ps
            });
        }, self.branches[name] ? self.delay : 0);
        
        ps.once('exit', function (code) {
            clearTimeout(to);
            
            var b = self.branches[name];
            if (b && b.hash === commit.hash) ps.respawn();
        });
    });
};

Ploy.prototype.add = function (name, rec) {
    if (this.branches[name]) this.remove(name);
    this.branches[name] = rec;
    this._rescanRegExp();
    this.emit('add', name, rec);
};

Ploy.prototype._rescanRegExp = function () {
    var self = this;
    self._keys = {};
    self.regexp = RegExp('^(' + Object.keys(self.branches)
        .sort(function (a, b) { return b.length - a.length })
        .map(function (key) {
            var b = self.branches[key];
            var s = quotemeta(key);
            if (b.key === 'index') {
                self._keys[b.key] = key;
                return s;
            }
            self._keys[b.branch + '.' + b.key] = key;
            s += '|' + quotemeta(b.branch + '.' + b.key);
            if (b.branch === 'master') {
                s += '|' + quotemeta(b.key);
                self._keys[b.key] = key;
            }
            return s;
        })
        .join('|')
        + ')(?:$|\\.)'
    );
};

Ploy.prototype.remove = function (name) {
    var b = this.branches[name];
    if (b) {
        b.process.kill('SIGKILL');
        this.emit('remove', name, b);
    }
    delete this.branches[name];
    this._rescanRegExp();
    
    spawn('git', [ 'branch', '-D', name ], {
        cwd: path.join(this.ci.repodir, b.repo)
    });
};

Ploy.prototype.restart = function (name) {
    var b = this.branches[name];
    if (b) b.process.kill('SIGKILL');
};

Ploy.prototype.move = function (src, dst) {
    if (!this.branches[src]) return;
    if (this.branches[dst]) this.remove(dst);
    this.branches[dst] = this.branches[src];
    delete this.branches[src];
    this._rescanRegExp();
};

Ploy.prototype.listen = function () {
    var args = [].slice.call(arguments).reduce(function (acc, arg) {
        if (arg && typeof arg === 'object') acc.opts = arg;
        else acc.list.push(arg);
        return acc;
    }, { list: [], opts: {} });
    if (args.opts.port) args.list.unshift(Number(args.opts.port));
    
    var b = this.createBouncer(args.opts);
    this.bouncers.push(b);
    b.listen.apply(b, args.list);
    return b;
};

Ploy.prototype.address = function () {
    return this.bouncers[0].address.apply(this.bouncers[0], arguments);
};

Ploy.prototype.close = function () {
    var self = this;
    self.bouncers.forEach(function (b) { b.close() });
    Object.keys(self.branches).forEach(function (name) {
        self.remove(name);
    });
};

Ploy.prototype.handle = function (req, res) {
    var self = this;
    var m;
    
    if (RegExp('^/_ploy/[^?]+\\.git\\b').test(req.url)) {
        req.url = req.url.replace(RegExp('^/_ploy/'), '/');
        self.ci.handle(req, res);
    }
    else if (RegExp('^/_ploy/move/').test(req.url)) {
        var xs = req.url.split('/').slice(3);
        var src = xs[0], dst = xs[1];
        self.move(src, dst);
        res.end();
    }
    else if (RegExp('^/_ploy/remove/').test(req.url)) {
        var name = req.url.split('/')[3];
        self.remove(name);
        res.end();
    }
    else if (RegExp('^/_ploy/list').test(req.url)) {
        res.end(Object.keys(self.branches)
            .map(function (s) { return s + '\n' })
            .join('')
        );
    }
    else if (RegExp('^/_ploy/restart/').test(req.url)) {
        var name = req.url.split('/')[3];
        self.restart(name);
        res.end();
    }
    else if (m = RegExp('^/_ploy/log/([^?/]+)').exec(req.url)) {
        var params = qs.parse((url.parse(req.url).search || '').slice(1));
        var b = Number(params.begin);
        var e = Number(params.end);
        if (isNaN(b)) b = undefined;
        if (isNaN(e)) e = undefined;
        
        var file = path.join(self.logdir, m[1]);
        var sf = sliceFile(file);
        sf.on('error', function (err) { res.end(err + '\n') });
        res.on('close', function () { sf.close() });
        if (falsy(params.follow)) {
            sf.slice(b, e).pipe(res);
        }
        else sf.follow(b, e).pipe(res);
    }
};

function falsy (x) {
    return !x || x === 'no' || x === 'false' || x === '0';
};
