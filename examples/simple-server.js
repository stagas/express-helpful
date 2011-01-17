//

var express = require('express')
  , login = require('helpful/login')
  , allow = require('helpful/allow')
  , boil = require('helpful/boil')
  , helpful = require('helpful')
  
  , log = helpful.log(1)
  , start = helpful.start
  , cache = helpful.cache
  , next = helpful.next
  , rewrite = helpful.rewrite
  , hash = helpful.hash  
  , render = helpful.render
  , compile = helpful.compile
  , expires = helpful.expires
  
  , port = process.env.PORT || 80
  , host = process.env.HOST || 'localhost'
  
var app = express.createServer()

var config = boil(app, {
  host: host
, 'public': __dirname + '/public'
, views: __dirname + '/views'

, context: {
    stripTags: helpful.stripTags
  , htmlspecialchars: helpful.htmlspecialchars
  , lorem: helpful.loremIpsumParagraph
  , rand: helpful.rand
  }
  
, rewrite: function(app) {
    app.get('*.html|*.htm', rewrite(helpful.stripExt))
    app.get('/index', rewrite('/'))
  }
  
, custom: [
    cache()
  , login({
      css: '/css/style.css'
    , after: function(req, res, next) {
        req.expireAll()
        next()
      }
    })
  ]
})

// Let's compile our views (only .jade, for now)

compile(config.views)

// Various routes with different configurations

app.get('/', expires(false), function(req, res) {
  res.render('index', { title: 'Home' })
})

app.get('/members', expires(10), allow(false, 'member'), function(req, res) {
  res.render('member', { title: 'Members area' })
})

app.get('/checkout', allow('member'), function(req, res) {
  res.render('checkout', { title: 'Checkout' })
})

app.get('/upgrade', allow('member'), function(req, res) {
  res.render('upgrade', { title: 'Upgrade your account' })
})

app.get('/premium', allow('premium', function(req, res) {
  res.redirect('/upgrade')
}), function(req, res) {
  res.render('premium', { title: 'Premium members area' })
})

// Admin area

app.get('/admin', allow('admin'), expires(true), function(req, res) {
  res.users.list(function(err, data) {
    if (err) return res.send('error')
    res.render('admin', {
      title: 'Admin area'
    , data: data
    })
  })
})

app.get('/role/add/:role', function(req, res) {
  req.user.addRole(req.params.role, function(err, data) {
    if (!err) {
      req.expireAll()
      res.send('added role ' + req.params.role)
    } else
      res.send('error: ' + err.message)
  })
})

app.get('/role/remove/:role', function(req, res) {
  req.user.removeRole(req.params.role, function(err, data) {
    if (!err) {
      req.expireAll()
      res.send('removed role ' + req.params.role)
    } else
      res.send('error: ' + err.message)
  })
})

start(app, port, host)
