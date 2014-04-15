var test = require('tap').test;
var ploy = require('../');
var path = require('path');
var spawn = require('child_process').spawn;
var concat = require('concat-stream');
var verify = require('./lib/verify');
var push = require('./lib/push');

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

var os = require('os');
var mkdirp = require('mkdirp');
var tmpDir = path.join(os.tmpdir(), 'ploy-test', ''+Math.random());
mkdirp.sync(tmpDir);

var server = ploy(tmpDir);
var port;

test(setup);
test({ timeout: 90 * 1000 }, function (t) {
    t.plan(8);
    server.listen(function () {
        port = server.address().port;
        setTimeout(push0, 2000);
    });
    
    server.on('spawn', function (ps, sp) {
        if (/kill\.sh/.test(sp.command)) {
            t.equal(sp.command, './kill.sh $PID');
            t.ok(/^\d+$/.test(sp.env.PID));
            ps.stdout.pipe(concat(function (err, data) {
                t.ok(/killer killing/.test(data), 'kill script');
            }));
        }
    });
    
    function push0 () {
        server.once('start', function () {
            setTimeout(function () {
                verify(port, t, 'beep boop\n', 'local', deploy);
            }, 3000);
        });
        push(port, 'master', function (code) {
            t.equal(code, 0);
        });
    }
    
    function push1 () {
        push(port, 'master', function (code) {
            t.equal(code, 0);
            verify(port, t, 'rawr\n', 'local');
        });
    }
    
    function deploy () {
        commit(function (code) {
            t.equal(code, 0);
            push1();
        });
    }
    
    t.on('end', function () {
        console.log('FINISHED!');
    });
});
test(teardown);
