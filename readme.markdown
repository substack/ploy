# ploy

git push at this http router and it will host your branches on subdomains

[![build status](https://secure.travis-ci.org/substack/ploy.png)](http://travis-ci.org/substack/ploy)

think [bouncy](https://github.com/substack/bouncy) +
[cicada](https://github.com/substack/cicada)

*note* ploy only works on node 0.8 right now

# example

create an auth file and start the ploy server:

```
$ echo '{ "beep": "boop" }' > auth.json
$ sudo ploy server ./data -p 80 -a auth.json
```

then from a git repo with a `server.js` and/or a `scripts.start` in its
package.json:

`server.js` should host its http server on `process.env.PORT`.

```
$ git remote add ploy http://beep:boop@localhost/_ploy/server.git
$ git push ploy master
```

Now your server.js will be running on `http://localhost/`.
If you push again to master, in a few seconds the new master code will be
running on `http://localhost/`.

To launch a staging instance on a subdomain, just push to a non-master branch:

```
$ git push ploy master:staging
```

Now go to `http://staging.localhost/` to see your staging instance.
(Edit /etc/hosts or set up dns wildcards with
[dnsmasq](http://www.thekelleys.org.uk/dnsmasq/doc.html) to test locally.)

Use `ploy ls` to list the running branches:

```
$ ploy ls
master
```

# details

ploy does not detach your server processes. When the ploy server goes down, it
takes the processes it started with it.

However, when the ploy server is started back up, it will attempt to restart all
of the processes it was previously running.

When you `git push` code at a ploy server, your server will be started and any
previous server running under the same branch name will be killed.

# usage

```
usage:

  ploy server DIRECTORY PORT
  ploy server { -d DIRECTORY | -p PORT | -a AUTHFILE }

    Create a ploy http server, hosting repositories in DIRECTORY and listening
    on PORT for incoming connections.
 
    If AUTHFILE is given, it should be a json file that maps usernames to
    token strings to use for basic auth protection for ploy actions.
    
    Type `ploy help ssl` to show ssl options.
 
  ploy ls { -r REMOTE | --verbose, -v | --format=FORMAT }
 
    List the running process branch names at REMOTE.
    
    Verbose formatting will use `branch,hash,repo,port`.
 
  ploy log NAME { -n ROWS | -f | -b BEGIN | -e END }

    Show ROWS of log output for the branch NAME like `tail`.
    Default -n value: screen height.
 
    Stream live updates when `-f` is set like `tail -f`.
    Slice log records for NAME directly with `-b` and `-e`.
 
  ploy log { -n ROWS | -f | -b BEGIN | -e END | --color=true }

    Show ROWS of log output for all branches.
    Lines will be prefaced with a colored branch name when stdout is a tty.

  ploy mv SRC DST { -r REMOTE }
 
    Move the branch name SRC to the DST branch name at REMOTE.
 
  ploy rm NAME { -r REMOTE }
 
    Remove the branch name at NAME, killing any running processes.
 
  ploy restart NAME { -r REMOTE }
 
    Restart the process at NAME.
 
  ploy help [TOPIC]
 
    Show this message or optionally a TOPIC.
    
    Topics: ssl

OPTIONS

  For `ploy ls`, `ploy mv`, `ploy rm` commands that take a REMOTE parameter:
  
  REMOTE can be a git remote name or a remote URL to a ploy server. If there
  is exactly one ploy remote in set up as a git remote, it will be used by
  default.

```

# scripts

## start

ploy will look at your `package.json`'s `scripts.start` field for how to start
processes.

Before any services are started, `npm install .` will be run on the deployed
repo. npm will handle the `preinstall`, `install`, and `postinstall` hooks.
`postinstall` is a good place to put bundle steps like
[browserify](http://browserify.org).

If `scripts.start` is a string, ploy will set `$PORT` for a single process and
host it accordinly.

If `scripts.start` is an object, the keys should map subdomains to commands to
launch servers with. For instance:

``` json
{
  "scripts": {
    "start": {
      "beep": "node beep.js",
      "boop": "node boop.js",
      "index": "node server.js"
    }
  }
}
```

Will host `beep.js` at `beep.domain`, `boop.js` at `boop.domain` and `server.js`
at just `domain`. When you push to non-master branches, `domain` will be
prefaced accordingly to mount hosts at `beep.staging.domain` etc.

Each key can be a full url such as `"beepboop.com"` or just a subdomain.

Use the special key `"index"` to set a host to resolve for the root subdomain.

Each service start command will be immediately restarted when it crashes.

## stop

You can also have a `scripts.stop` that will have a `$PID` environment variable
defined for the start script that was defined:

``` json
{
  "scripts": {
    "start": "sudo node server.js",
    "stop": "sudo kill $PID",
  }
}
```

The `scripts.stop` keys work the same as the `scripts.start` keys:

``` json
{
  "scripts": {
    "start": {
      "x": "node x.js",
      "y": "node y.js"
    },
    "stop": {
      "x": "node kill.js x",
      "y": "node kill.js y"
    }
  }
}
```

## test

If you specify a `scripts.test`, it will be run.

If the test fails, code that you push will not be deployed and any old branches
will continue to be run rather than be replaced.

## services

You might want to manage non-http services with ploy.
Just preface the services you don't want to show up in the http routing tables
with an `'_'` like this:

``` json
{
  "scripts": {
    "start": {
      "web": "node web.js",
      "_notweb": "node notweb.js"
    }
  }
}
```

Underscored non-http services will not be given a `$PORT` to listen on so you'll
need to figure out how you want multiple services running on the same box to
work on your own. Consider registering your non-http services with
[seaport](https://github.com/substack/seaport).

# environment

Each script has these environment variables defined:

* `$cOMMIT` - git hash of the current deploy
* `$BRANCH` - commit branch name, for example `"master"`
* `$REPO` - repo name, for example `"repo.git"`

Additionally, `$PATH` is prepended with `node_modules/.bin` so that bin scripts
installed with npm will be available for install scripts.

# methods

``` js
var ploy = require('ploy')
```

## var server = ploy(opts)

Create a new ploy instance, splitting `opts` between
the underlying
[bouncy](https://github.com/substack/bouncy)
and [cicada](https://github.com/substack/cicada)
instances.

* opts.repodir - directory to put git repo data
* opts.workdir - directory to check out git repos into
* opts.logdir - directory to store process stderr and stdout branch files
* opts.auth - optional object mapping usernames to password token strings for
basic auth

If `opts` is a string, it will be used as the basedir for `opts.repodir` and
`opts.workdir`.

The rest of the options will be looked over by bouncy to do things like set up
an https server or whatever.

## server.listen(opts, port, host...)

Call `.listen()` on the underlying http or https server, passing any `opts`
object directly through to [bouncy](https://github.com/substack/bouncy).

To host ploy over ssl, set the (`opts.key`, `opts.ca`, and `opts.cert`),
or set `opts.pfx`.

## server.add(name, rec)

Add a a service under a branch `name`. `rec` should have:
* rec.port - port where the http server lives
* rec.hash - commit hash string
* rec.process - process object to call .kill() on

## server.remove(name)

Remove the process at the branch `name`, killing as necessary.

## server.restart(name)

Restart the process at the branch `name`.

## server.move(src, dst)

Move the process at branch name `src` to `dst`, killing the branch process at
`src` if it was running.

# events

## server.on('spawn', function (ps, info) {})

When a process is created from `npm install` or one of the package.json start
scripts, this event fires with the `info.commit` and `info.command` executed.

## server.on('output', function (name, stream) {})

When there is a new output stream for a branch, this event fires with the
readable `stream`.

Output streams merge the output from all the processes used to start a branch.

# running as non-root

On Linux you can easily setup port forwarding with iptables to avoid running ploy on port 80, which requires root privileges.

You'll need at least 2 new iptables rules to set it up. The first rule will redirect all incoming traffic from port 80 to port 8080:

```
iptables -A PREROUTING -t nat -p tcp --dport 80 -j REDIRECT --to-port 8080
```

The second rule will redirect all localhost traffic from port 80 to port 8080:

```
iptables -t nat -I OUTPUT -p tcp -d 127.0.0.1 --dport 80 -j REDIRECT --to-ports 8080
```

You might also need a third rule if you'll push to ploy from localhost, but will use a hostname instead of `localhost` as ploy's remote url:

```
iptables -t nat -I OUTPUT -p tcp -d testling.com --dport 80 -j REDIRECT --to-ports 8080
```

# install

With [npm](https://npmjs.org) do:

```
npm install -g ploy
```

to get the `ploy` command or just

```
npm install ploy
```

to get the library.

# license

MIT
