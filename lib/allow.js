var allow = module.exports = function(allowed, cb) {
  var haveToLogin = true
  
  if (!Array.isArray(allowed))
    allowed = Array.prototype.slice.call(arguments)

  if (typeof allowed[0] === 'boolean') {
    haveToLogin = allowed.shift()
  }
  
  if (typeof allowed[allowed.length - 1] === 'function') {
    cb = allowed.pop()
    haveToLogin = haveToLogin || false
  }

  if (typeof cb !== 'function') cb = false
  
  return function(req, res, next) {
    if (!req.session.loggedIn) {
      if (haveToLogin)
        return res.redirect('/login?redirect_url=' + encodeURIComponent(req.url))
      else return cb && cb(req, res, next) || next()
    } else {
      for (var i = allowed.length; i--;) {
        if (req.roles.has(allowed[i])) return next()
      }
      cb && cb(req, res, next) || res.redirect(res.headers.referer || '/')
    }
  }
}
