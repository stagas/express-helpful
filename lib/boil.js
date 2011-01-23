var path = require('path')
  , express = require('express')
  , userAgent = require('useragent')
  , MemoryStore = require('connect/middleware/session/memory')
  , staticFile = require('creationix/static')

module.exports = function(app, options) {
  options = options || {}
  
  options.host = options.host || 'localhost'
  options['view engine'] = options['view engine'] || 'jade'
  options['views'] = path.normalize(options['views']) || __dirname + '/views'
  options['partials'] = path.normalize(options['partials']) || __dirname + '/views'
  options['public'] = path.normalize(options['public']) || __dirname + '/public'
  options['secret'] = options['secret'] || 'aSecretString'
  options['sessionStore'] = options['sessionStore'] || new MemoryStore()
  options['sessionStore'].secret = options['secret']
  options.rewrite = options.rewrite || function() {}
  app.set('view engine', options['view engine'])
  app.set('views', options['views'])
  app.set('partials', options['partials'])

  ;[
    express.router(options.rewrite)
  , function(req, res, next) {
      if (typeof req.headers.ip !== 'undefined')
        req.headers.remoteAddress = req.headers.ip

      if (typeof req.headers.remoteAddress === 'undefined')
        req.headers.remoteAddress = req.connection.remoteAddress
      
      req.headers.ip = req.headers.remoteAddress
      
      var ua = userAgent.parser(req.headers['user-agent'])
        , uapretty = ua.pretty()

      req.headers.ua = uapretty != 'Other' ? uapretty + ' ' + ua.prettyOs() : req.headers['user-agent']
      
      req.context = options.context

      next()
    }
  , express.logger({
      format:
        options.host.cyan
      + ' [:date] '.grey
      + ':req[remoteAddress] '.magenta
      + ':method '.yellow
      + ':status '.green
      + ('http://' + options.host + ':url ').white
      + ':req[ua] '.grey
      + ':referrer'.grey
    })
  , express.methodOverride()
  , express.cookieDecoder()
  , express.bodyDecoder()
  , express.session(options['sessionStore'])
  , function(req, res, next) {
      req.locals = res.locals = res.locals || req.locals || {}
      res.locals.req = req
      res.locals.res = res
      next()
    }
  ].forEach(function(middleware) {
    app.use(middleware)
  })

  options.custom.forEach(function(middleware) {
    app.use(middleware)
  })

  ;[
    app.router
  , staticFile('/', options['public'])
  , express.gzip()
  ].forEach(function(middleware) {
    app.use(middleware)
  })
  
  return options
}
