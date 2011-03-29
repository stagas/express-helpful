var db

var init = exports.init = function(dir) {
  db = require('chaos')(dir)
}

var get = exports.get = function(id, cb) {
  db.get('articles:' + id, function(err, data) {
    if (err) return cb(err)

    var data
    try {
      data = JSON.parse(data)
    } catch(e) {
      cb(err)
    }

    cb && cb(data)
  })
}

var set = exports.set = function(article, cb) {
  var now = Date.now()

  if (!article.id) article.id = article.title.replace(/[ \t\r\n]+/gm, '-')
  if (article.timestamp) article.edited_on = now
  else article.timestamp = now
  
  db.set('articles:' + article.id, JSON.stringify(article), function(err) {
    if (err) return cb(err)

    cb(article.id)
  })
}
