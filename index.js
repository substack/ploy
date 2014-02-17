var bouncy = require('bouncy');
var cicada = require('cicada');
var quotemeta = require('quotemeta');
var mkdirp = require('mkdirp');
var through = require('through');
var split = require('split');
var logdir = require('logdir');
var subdir = require('subdir');
var rmrf = require('rimraf');
var table = require('text-table');

var path = require('path');
var fs = require('fs');
var EventEmitter = require('events').EventEmitter;
var inherits = require('inherits');

var qs = require('querystring');
var url = require('url');

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
    if (opts.logdir) {
        mkdirp(opts.logdir);
        self.logdir = logdir(opts.logdir);
    }
    
    self.ci = cicada(opts);
    self.ci.on('commit', self.deploy.bind(self));
    
    self.bouncers = [];
    self.auth = opts.auth;
    self.restore();
}

Ploy.prototype.createBouncer = function (opts) {
    var self = this;
    if (opts.bouncer) {
        return bouncy(opts, function (req, res, bounce) {
            opts.bouncer.call(self, req, res, function (x) {
                if (x === undefined) onbounce(req, res, bounce);
                else bounce.apply(this, arguments);
            });
        });
    }
    else return bouncy(opts, onbounce);
    
    function onbounce (req, res, bounce) {
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
        else if (!/^_/.test(branch) && self.branches[branch]) {
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
    }
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
    if (!commit.seq) commit.seq = 0;
    
    procs.on('spawn', function (ps, sp) {
        self.emit('spawn', ps, sp);
    });
    
    procs.on('output', function (name, stream) {
        if (self.logdir) {
            stream.pipe(self.logdir.createWriteStream(name));
        }
        self.emit('output', name, stream);
        
        [ 'start', 'restart', 'exit' ].forEach(function (ev) {
            procs.on(ev, function (name, ps) {
                var logMessage = {
                    event: ev,
                    date : new Date,
                    host: name,
                    pid: ps.pid,
                    hash  : commit.hash,
                    dir : commit.dir,
                    repo : commit.repo,
                    branch : commit.branch
                };
                stream.write(JSON.stringify(logMessage) + '\n');
            });
        });
    });
    
    procs.on('start', function (name, ps) {
        self.emit('start', name, ps);
        
        var to = setTimeout(function () {
            // didn't crash in 3 seconds, add to routing table
            addServer(name, ps);
        }, self.branches[name] ? self.delay : 0);
        
        ps.once('exit', function (code) {
            clearTimeout(to);
        });
    });
    
    procs.on('restart', function (name, ps) {
        self.emit('restart', name, ps);
        addServer(name, ps);
    });
    
    var seq = commit.seq;
    return procs;
    
    function addServer (name, ps) {
        if (self.branches[name]) {
            self.remove(name, { keepBranch: true });
        }
        self.add(name, {
            port: ps.port,
            hash: commit.hash,
            repo: commit.repo,
            branch: commit.branch,
            commit: commit,
            dir: commit.dir,
            key: ps.key,
            process: ps,
            kill: ps.killer,
            procs: procs
        });
        
        ps.once('exit', function (code) {
            var b = self.branches[name];
            if (b && b.hash === commit.hash && b.commit.seq === seq) {
                ps.respawn();
            }
        });
    }
};

Ploy.prototype.redeploy = function (branch, cb) {
    var b = this.branches[branch];
    b.commit.seq ++;
    b.process.kill();
    this.deploy(b.commit).on('start', function () {
        cb();
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
        .filter(function (key) {
            return !/^_/.test(key);
        })
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

Ploy.prototype.remove = function (name, opts) {
    if (!opts) opts = {};
    var self = this;

    var forGit = {
        repo : this.branches[name].repo,
        branch : this.branches[name].branch
    };

    var allBranches =
        Object.keys(this.branches).reduce(function (acc, branchName) {
            if (self.branches[name].repo === self.branches[branchName].repo &&
                self.branches[name].dir === self.branches[branchName].dir &&
                self.branches[name].branch === self.branches[branchName].branch)
            {  
                acc.push(branchName);
            }
            return acc;
        }, []);

    allBranches.forEach(function (branchName) {
        var b = self.branches[branchName];
        if (b) {
            b.kill();
            self.emit('remove', branchName, b);
        }
        delete self.branches[branchName];
        self._rescanRegExp();
    });

    if (opts.keepBranch !== true) {
        spawn('git', [ 'branch', '-D', forGit.branch ], {
            cwd: path.join(this.ci.repodir, forGit.repo)
        });
    }
};

Ploy.prototype.restart = function (name) {
    var b = this.branches[name];
    if (b) b.kill();
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

Ploy.prototype.clean = function (cb) {
    var self = this;
    self.getWorking(function (err, results) {
        if (err) return cb(err);
        var pending = results.length;
        results.forEach(function (r) {
            if (!r.active && r.dir && subdir(self.workdir, r.dir)) {
                rmrf(r.dir, function (err) {
                    if (err) cb(new Error(
                        'error removing ' + r.dir + ': ' + err + '\n'
                    ));
                    else if (--pending === 0) done();
                });
            }
            else if (--pending === 0) done()
        });
        
        function done () { cb() }
    });
};

Ploy.prototype.getWorking = function (cb) {
    var self = this;
    var results = [];
    
    fs.readdir(self.workdir, function (err, files) {
        if (err) return cb(err);
        var pending = files.length;
        files.forEach(function (file) {
            fs.stat(path.join(self.workdir, file), function (err, s) {
                if (s && s.isDirectory()) {
                    self.getCommit(file, function (err, commit) {
                        if (commit) results.push(commit);
                        if (--pending === 0) done();
                    });
                }
                else if (--pending === 0) done();
            });
        });
    });
    
    function done () {
        var dirs = {};
        Object.keys(self.branches).forEach(function (key) {
            var d = self.branches[key];
            dirs[d.dir] = d;
        });
        cb(null, results
            .map(function (r) {
                var d = dirs[r.dir];
                r.active = Boolean(d);
                r.pid = d && d.pid;
                return r;
            })
            .sort(function (a, b) {
                return a.time < b.time ? -1 : 1;
            })
        );
    }
};

Ploy.prototype.getCommit = function (file, cb) {
    var self = this;
    var head = path.join(self.workdir, file, '.git/FETCH_HEAD');
    var r = path.basename(file);
    var commit = {
        commit: r.split('.')[0],
        time: Number(r.split('.')[1]),
        dir: path.join(self.workdir, r)
    };
    
    fs.readFile(head, 'utf8', function (err, src) {
        if (err) return cb(err);
        var m = /\s{2,}branch '([^']+)' of ([^\r\n]+)/.exec(src);
        if (m) {
            commit.branch = m[1];
            commit.repo = path.basename(m[2]);
            if (!/\.git$/.test(commit.repo)) commit.repo += '.git';
        }
        cb(null, commit);
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
    else if (RegExp('^/_ploy/list(\\?|$)').test(req.url)) {
        var params = qs.parse((url.parse(req.url).search || '').slice(1));
        if (params.type === 'work') {
            self.getWorking(function (err, results) {
                if (err) {
                    res.statusCode = 500;
                    res.end(err + '\n');
                    return;
                }
                res.write(results
                    .map(function (r) { return JSON.stringify(r) })
                    .join('\n')
                );
                if (results.length) res.end('\n')
                else res.end();
            });
        }
        else {
            var format = String(params.format || 'branch').split(',');
            res.end(table(Object.keys(self.branches).map(function (s) {
                return format.map(function (key) {
                    if (key === 'branch') return s;
                    return self.branches[s][key] || 'undefined';
                });
            })) + '\n');
        }
    }
    else if (RegExp('^/_ploy/clean(\\?|$)').test(req.url)) {
        self.clean(function (err) {
            if (err) {
                res.statusCode = 500;
                res.end(err + '\n');
                return;
            }
            else res.end();
        });
    }
    else if (RegExp('^/_ploy/restart/').test(req.url)) {
        var name = req.url.split('/')[3];
        self.restart(name);
        res.end();
    }
    else if (RegExp('^/_ploy/redeploy/').test(req.url)) {
        var name = req.url.split('/')[3];
        self.redeploy(name, function (err) {
            if (err) {
                res.statusCode = 500;
                res.end(err + '\n');
            }
            res.end();
        });
    }
    else if (m = RegExp('^/_ploy/log(?:$|\\?)').exec(req.url)) {
        var params = qs.parse((url.parse(req.url).search || '').slice(1));
        var b = Number(params.begin);
        var e = Number(params.end);
        if (isNaN(b)) b = undefined;
        if (isNaN(e)) e = undefined;
        req.connection.setTimeout(0);
        
        var ld = self.logdir.open(params.name);
        res.on('close', function () { ld.close() });
        
        if (falsey(params.follow)) {
            var s = ld.slice(b, e);
            s.on('error', function (err) { res.end(err + '\n') });
            s.pipe(res);
        }
        else {
            var fw = ld.follow(b, e);
            fw.on('error', function (err) { res.end(err + '\n') });
            fw.pipe(res);
        }
    }
};

function falsey (x) {
    return !x || x === 'no' || x === 'false' || x === '0';
}
