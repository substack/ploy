# ploy

git push at this http router and it will host your branches on subdomains

[![build status](https://secure.travis-ci.org/substack/ploy.png)](http://travis-ci.org/substack/ploy)

think [bouncy](https://github.com/substack/bouncy) +
[cicada](https://github.com/substack/cicada)

# example

create an auth file and start the ploy server:

```
$ echo '{ "beep": "boop" }' > auth.json
$ sudo ploy ./data -p 80 -a auth.json
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

  ploy DIRECTORY PORT
  ploy { -d DIRECTORY | -p PORT | -a AUTHFILE }

    Create a ploy http server, hosting repositories in DIRECTORY and listening
    on PORT for incoming connections.
 
    If AUTHFILE is given, it should be a json file that maps usernames to
    token strings to use for basic auth protection for ploy actions.
 
  ploy ls { -r REMOTE }
 
    List the running process branch names at REMOTE.
 
  ploy mv SRC DST { -r REMOTE }
 
    Move the branch name SRC to the DST branch name at REMOTE.
 
  ploy rm NAME { -r REMOTE }
 
    Remove the branch name at NAME, killing any running processes.
 
  ploy help
 
    Show this message. 

OPTIONS

  For `ploy ls`, `ploy mv`, `ploy rm` commands that take a REMOTE parameter:
  
  REMOTE can be a git remote name or a remote URL to a ploy server. If there
  is exactly one ploy remote in set up as a git remote, it will be used by
  default.

```

# scripts

ploy will look at your `package.json`'s `scripts.start` field for how to start
processes.

Before any services are started, `npm install .` will be run on the deployed
repo. npm will handle the `preinstall`, `install`, and `postinstall` hooks.

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

Use the special key `"index"` to set a host to resolve for the root subdomain.

Each service start command will be immediately restarted when it crashes.

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
* opts.auth - optional object mapping usernames to password token strings for
basic auth

If `opts` is a string, it will be used as the basedir for `opts.repodir` and
`opts.workdir`.

The rest of the options will be looked over by bouncy to do things like set up
an https server or whatever.

## server.listen(port, ...)

Call `.listen()` on the underlying http or https server.

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
