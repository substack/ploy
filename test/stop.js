var test = require('tap').test;
var ploy = require('../');
var path = require('path');
var spawn = require('child_process').spawn;
var hyperquest = require('hyperquest');
var concat = require('concat-stream');

function setup (t) {
    var ps = spawn(__dirname + '/setup.sh', [ 'stop' ], {
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
    var ps = spawn(__dirname + '/commit/stop.sh', [], {
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
    t.plan(7);
    server.listen(function () {
        port = server.address().port;
        setTimeout(push0, 2000);
    });
    
    server.on('spawn', function (ps, sp) {
        if (sp.command[0] === './kill.sh') {
            t.ok(/^\d+$/.test(sp.command[1]));
            ps.stdout.pipe(concat(function (err, data) {
                t.ok(/killer killing/.test(data), 'kill script');
            }));
        }
    });
    
    function push0 () {
        push('master', function (code) {
            t.equal(code, 0);
            setTimeout(function () {
                verify('beep boop\n', 'local', deploy);
            }, 3000);
        });
    }
    
    function push1 () {
        push('master', function (code) {
            t.equal(code, 0);
            setTimeout(function () {
                verify('rawr\n', 'local');
            }, 5000);
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
