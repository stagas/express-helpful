var db

var init = exports.init = function(dir) {
  db = require('chaos')(dir)
}

var get = exports.get = function(name, cb) {
  db.hgetall('discussion:comments:' + name, function(err, data) {
    if (err || !data || !Object.keys(data).length) return cb(null)

    var complete = function() {
      cb(data)
    }
    
    var counter = 0
    for (var k in data) {
      try {
        counter++      
        data[k] = JSON.parse(data[k])
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
  db.hget('discussion:comments:' + name, id, function(err, data) {
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
  db.hdel('discussion:comments:' + name, id, function() {
    db.hdel('discussion:voted:' + name + id, user, function() {
      db.del('discussion:votes:' + name + id, function() {
        cb && cb(null)
      })
    })
  })
}

var getVotes = exports.getVotes = function(name, id, cb) {
  db.get('discussion:votes:' + name + id, function(err, votes) {
    cb(err ? 0 : parseInt(votes, 10))
  })
}

var voteUp = exports.voteUp = function(user, name, id, cb) {
  db.hget('discussion:voted:' + name + id, user, function(err, data) {
    if (!err) return getVotes(name, id, cb)

    db.hset('discussion:voted:' + name + id, user, Date.now().toString(), function(err, data) {
      db.incr('discussion:votes:' + name + id, function(err, votes) {
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
  db.hset('discussion:comments:' + name, comment.id, JSON.stringify(comment), function(err) {
    cb(comment.id)
  })
}
