var db

var init = exports.init = function(dir) {
  db = require('chaos')(dir)
}

var get = exports.get = function(name, cb) {
  db.hgetall(name, function(err, data) {
    if (err || !data || !Object.keys(data).length) return cb(null)

    var complete = function() {
      cb(data)
    }
    
    var counter = 0
    for (var k in data) {
      try {
        data[k] = JSON.parse(data[k])
        counter++
      } catch(e) {
        counter--
        delete data[k]
      }
    }

    for (var k in data) {
      ;(function(k) {
        getVotes(name, k, function(votes) {
          data[k].votes = votes
          counter--
          if (!counter) complete()
        })
      }(k))
    }
  })
}

var getId = exports.getId = function(name, id, cb) {
  db.hget(name, id, function(err, data) {
    if (err) return cb && cb(null)

    try {
      data = JSON.parse(data)
    } catch(e) {
      return cb && cb(null)
    }
  
    cb(data)
  })
}

var deleteId = exports.deleteId = function(name, user, id, cb) {
  db.hdel(name, id, function() {
    db.hdel('voted:' + name + id, user, function() {
      db.del('votes:' + name + id, function() {
        cb && cb(null)
      })
    })
  })
}

var getVotes = exports.getVotes = function(name, id, cb) {
  db.get('votes:' + name + id, function(err, votes) {
    cb(err ? 0 : parseInt(votes, 10))
  })
}

var voteUp = exports.voteUp = function(user, name, id, cb) {
  db.hget('voted:' + name + id, user, function(err, data) {
    if (!err) return getVotes(name, id, cb)

    db.hset('voted:' + name + id, user, Date.now().toString(), function(err, data) {
      db.incr('votes:' + name + id, function(err, votes) {
        getId(name, id, function(comment) {
          comment.votes = votes
          set(name, comment, function() {
            cb(votes)
          })
        })
      })
    })
  })
}

var set = exports.set = function(name, comment, cb) {
  comment.id = comment.date && parseInt(comment.date.timestamp, 10).toString(32) || Date.now().toString(32)
  db.hset(name, comment.id, JSON.stringify(comment), function(err) {
    cb(comment.id)
  })
}
