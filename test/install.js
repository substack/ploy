var test = require('tap').test;
var ploy = require('../');
var path = require('path');
var spawn = require('child_process').spawn;
var hyperquest = require('hyperquest');
var concat = require('concat-stream');

function setup (t) {
    var ps = spawn(__dirname + '/setup.sh', [ 'install' ], {
        cwd: __dirname
    });
    ps.on('exit', t.end.bind(t));
}

function teardown (t) {
    var ps = spawn(__dirname + '/teardown.sh', [], {
        cwd: __dirname
    });
    ps.stderr.pipe(process.stderr);
    ps.on('exit', t.end.bind(t));
    t.on('end', function () {
        server.close();
        setTimeout(process.exit, 500);
    });
}

function commit (cb) {
    var ps = spawn(__dirname + '/commit/deploy.sh', [], {
        cwd: __dirname + '/repo'
    });
    ps.on('exit', cb);
}

function push (branch, cb) {
    var args = [
        'push',
        'http://localhost:' + port + '/_ploy/repo.git',
        branch
    ];
    var ps = spawn('git', args, {
        cwd: __dirname + '/repo'
    });
    ps.on('exit', cb);
}

var tmpDir = '/tmp/ploy-test/' + Math.random();
var server = ploy(tmpDir);
var port;

test(setup);
test(function (t) {
    t.plan(5);
    server.listen(function () {
        port = server.address().port;
        setTimeout(push0, 2000);
    });
    
    function push0 () {
        push('master', function (code) {
            t.equal(code, 0);
            setTimeout(function () {
                verify('one\ntwo\n', 'local', deploy);
            }, 3000);
        });
    }
    
    function push1 () {
        push('staging', function (code) {
            t.equal(code, 0);
            setTimeout(function () {
                verify('one\ntwo\n', 'staging.local');
            }, 3000);
        });
    }
    
    function deploy () {
        commit(function (code) {
            t.equal(code, 0);
            push1();
        });
    }
    
    function verify (msg, host, cb) {
        var hq = hyperquest('http://localhost:' + port);
        hq.setHeader('host', host);
        hq.pipe(concat(function (err, body) {
            t.equal(String(body), msg);
            if (cb) cb();
        }));
    }
});
test(teardown);
