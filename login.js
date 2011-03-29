//

var express = require('express')
  , crypto = require('crypto')
  , db

var options = {}

var store = {
  
  get: function(user, cb) {
    db.hget('users', user, function(err, json) {
      var data
      try { data = JSON.parse(json) } catch(e) {}
      cb(err, data)
    })
  }
  
, set: function(data, cb) {
    db.hget('users', data.username, function(err) {
      if (!err) return cb && cb(new Error('user exists'))
      db.hset('users', data.username, JSON.stringify(data), function(err) {
        cb && cb(err, data)
      })
    })
  }

, update: function(data, cb) {
    db.hset('users', data.username, JSON.stringify(data), function(err) {
      cb && cb(err, data)
    })
  }

, remove: function(user, cb) {
    db.hdel('users', user, cb)
  }
  
, list: function(cb) {
    db.hgetall('users', function(err, users) {
      if (!err)
        for (var key in users) {
          users[key] = JSON.parse(users[key])
        }
      cb(err, users)
    })
  }
  
, length: function(cb) {
    store.list(function(err, users) {
      cb(users && Object.keys(users).length || 0)
    })
  }
}  
  
var user = function(req) {
  return {
    login: function(user, pass, cb, force) {
      store.get(user, function(err, data) {
        var secret = 'anyThingReally'
        
        if (err || !force && data.password != crypto.createHash('sha1').update(secret + pass + data.salt).digest('hex').toString()) return cb && cb(false)
       
        req.session.loggedIn = true
        req.session.user = data

        cb && cb(true)        
      })
    }
    
  , signup: function(data, cb) {
      store.length(function(len) {
        if (!len) data.roles.push('admin')
        store.set(data, cb)
      })
    }
    
  , logout: function(cb) {  
      delete req.session.loggedIn
      delete req.session.user
      cb && cb()
    }
    
  , addRole: function(role, cb) {
      if (!req.session.loggedIn) return cb && cb(new Error('not logged in'))  
      store.get(req.session.user.username, function(err, data) {
        if (err) return cb && cb(new Error('cannot get user'))
        
        if (!data.roles.has(role)) {
          data.roles.push(role)
          store.update(data, function(err, data) {
            req.session.user = data
            cb && cb(err, data)
          })
        } else cb && cb(new Error('already has role ' + role))
      })
    }
    
  , removeRole: function(role, cb) {
      if (!req.session.loggedIn) return cb && cb(new Error('not logged in'))
      store.get(req.session.user.username, function(err, data) {
        if (err) return cb && cb(new Error('cannot get user'))
        
        var i = data.roles.indexOf(role)
        if (i >= 0) {
          data.roles.splice(i, 1)
          store.update(data, function(err, data) {
            req.session.user = data
            cb && cb(err, data)
          })
        } else {
          cb && cb(new Error('does not have role ' + role))
        }
      })
    }
  }
}

var redirect = function(res) {
  res.redirect(res._locals.redirect_url)
}

var Login = {
  get: {
    'login': function(req, res, next) {
      next()
    }
  , 'signup': function(req, res, next) {
      next()
    }
  , 'logout': function(req, res, next) {
      req.user.logout(function() {
        options.after && options.after(req, res, function() {
          req.session.destroy()
          delete req.session
          delete req.sessionID
        })
        redirect(res)
      })
    }
  , 'activate': function(req, res, next) {
      next()
    }
  , 'reset': function(req, res, next) {
      next()
    }
  , 'delete': function(req, res, next) {
      next()
    }
  }
, post: {
    'login': function(req, res, next) {
      req.user.login(req.body && req.body.username || '', req.body && req.body.password || '', function(success) {
        if (success) {
          options.after && options.after(req, res, function() {})
          redirect(res)
        }
        else next()
      })
    }
  , 'signup': function(req, res, next) {
      var salt = guid()
        , secret = 'anyThingReally'

      var data = {
        username: req.body && req.body.username
      , password: crypto.createHash('sha1').update(secret + (req.body && req.body.password) + salt).digest('hex')
      , salt: salt
      , roles: [ 'member' ]
      }

      req.user.signup(data, function(err, data) {
        if (err) next()
        else {
          req.user.login(data.username, '', function(success) {
            options.after && options.after(req, res, function() {})
            redirect(res)
          }, true) // force login
        }
      })
    }
  , 'logout': function(req, res, next) {
      next()
    }
  , 'activate': function(req, res, next) {
      next()
    }
  , 'reset': function(req, res, next) {
      next()
    }
  , 'delete': function(req, res, next) {
      next()
    }
  }
}

var login = module.exports = function(opts) {
  if (!options || !Object.keys(options).length) {
    options = { path: '', dbName: 'users_db' }
  }
  
  for (var i in opts) {
    options[i] = opts[i]
  }

  db = require('chaos')(options.dbName)
  
  return function(req, res, next) {
    res.local('req', req)
    res.local('res', res)
    res.local('loginCss', options.css || '/css/style.css')
    res.local('redirect_url', req.url)
    res.local('loggedIn', req.session && req.session.loggedIn || false)
    res.local('user', req.session && req.session.loggedIn && req.session.user || {
      username: 'guest'
    , roles: [ 'guest' ]
    })
    res.local('admin', res._locals.user.roles.has('admin'))
    res.local('username', res._locals.user.username)
    res.local('roles', res._locals.user.roles)
    req.roles = res.roles = res._locals.roles
    req.users = res.users = store
    req.user = res.user = user(req)
    
    express.router(function(app) {
      ;['login', 'signup', 'logout'
      , 'activate', 'reset', 'delete'
      ].forEach(function(handler) {
        ;['get', 'post'].forEach(function(method) {
          app[method](options.path + '/' + handler, function(req, res, next) {
            res.local('title', handler.substr(0,1).toUpperCase() + handler.substr(1).toLowerCase())
            res.local('redirect_url', req.body && req.body.redirect_url || req.query && req.query.redirect_url || '/')
            req.user = res.user = user(req)
            Login[method][handler](req, res, function() {
              res.local('layout', 'login/layout.jade')
              res.render('login/' + handler + '.jade')
            })
          })
        })
      })
    })(req, res, next)
  }
}

function S4() {
   return (((1+Math.random())*0x10000)|0).toString(16).substring(1);
}

function guid() {
   return (S4()+S4()+"-"+S4()+"-"+S4()+"-"+S4()+"-"+S4()+S4()+S4());
}
