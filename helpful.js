// helpful functions

var util, sys = util = require('util')
  , fs = require('fs')
  , path = require('path')
  , crypto = require('crypto')
  , colors = require('colors')
  , jade = require('jade')

var html = {}

var _cache = {}
  , cacheList = {}
  , cacheTimeout = {}
  , cacheView = {}
    
Array.prototype.has = function(i) {
  return !!~this.indexOf(i)
}

// Log function

var log = exports.log = function(debug) {
  return function(debug) {
    if (debug) {
      var msgarr = Array.prototype.slice.call(arguments).join(' ')
      if (debug>1) {
        try {
          throw new Error()
        } catch(e) {
          var line = e.stack.split('\n')[3].split(':')[1]
          util.print('    '.slice(line.length) + line.cyan + ' ')
        }
      }
      util.print(
        ('[' + (new Date()).toUTCString() + '] ').grey
      )
      console.log(msgarr)
    }
  }
}

var next = exports.next = function() {
  return function(req, res, next) {
    return next()
  }
}

var rewrite = exports.rewrite = function(s) {
  return function(req, res, next) {
    if (typeof s === 'string')
      req.url = s
    else if (typeof s === 'function') {
      req.url = s(req.url)
    }
    return next()
  }
}

var to_array = exports.to_array = function(args) {
  var len = args.length,
      arr = new Array(len), i;

  for (i = 0; i < len; i += 1) {
    arr[i] = args[i];
  }

  return arr;
}

var clone = exports.clone = function(obj) {
  if(obj == null || typeof(obj) != 'object')
    return obj

  var temp = obj.constructor() // changed

  for(var key in obj)
    temp[key] = clone(obj[key])
  return temp
}

var start = exports.start = function(server, port, host, cb, interval, max) {
  var retries = 0
    , displayed = false  
    , started = function(cb) {
        return function(e) {
          if (!displayed) {
            log(1)( 'Server started: '.green
               + ('http://' + host + ':' + port).white
               )
            displayed = true
          }
          cb && cb()
        }
      }

  max = max || 20
  interval = interval || 1000

  server.on('error', function (e) {
    if (e.errno == require('constants').EADDRINUSE) {
      retries++

      if (retries >= max) {
        log(1)('Giving up, exiting.')
        return process.exit()
      }

      log(1)('Address in use, retrying...')

      setTimeout(function () {
        try { server.close() } catch(e) {}
        server.listen(port, host, started(cb))
      }, interval)
    }
  })
  
  server.listen(port, host, started(cb))
}

var hash = exports.hash = function(s) {
  return crypto.createHash('sha1').update(s).digest('hex').toString()
}

var stripExt = exports.stripExt = function(s) {
  return s.substr(0, s.length - path.extname(s).length)
}

var render = exports.render = function(view, context, locals) {
  view = view.replace('.jade', '')

  var req = context._locals.req
    , res = context._locals.res
    , viewHash = hash(req.method + req.url + req.headers.ip + req.sessionID + locals.layout + view)

  return cacheView[viewHash] || html[view].call(context, locals)
}

var compile = exports.compile = function(dirName, originalDir) {
  var views = fs.readdirSync(dirName)
    , dirNameRel = originalDir ? dirName.substr(originalDir.length + 1) : ''
  
  if (!originalDir) originalDir = dirName
  
  views.forEach(function(view) {
    var viewName = dirNameRel.length ? dirNameRel + '/' + view.replace('.jade', '') : view.replace('.jade', '')
    fs.stat(dirName + '/' + view, function(err, stat) {
      if (!err && stat.isDirectory()) return compile(dirName + '/' + view, originalDir)
      html[viewName] = jade.compile(fs.readFileSync(dirName + '/' + view, 'utf8'))
      fs.watchFile(dirName + '/' + view, function() {
        setTimeout(function() {
          html[viewName] = jade.compile(fs.readFileSync(dirName + '/' + view, 'utf8'))
          for (var i in cacheList) {
            for (var n in cacheList[i]) {
              delete _cache[n]
              delete cacheView[n]
              clearTimeout(cacheTimeout[n])
              delete cacheTimeout[n]
            }
            delete cacheList[i]
          }
        }, 2000)
      })
    })
  })
}

var expires = exports.expires = function(cacheExpire) {
  if (typeof cacheExpire === 'boolean') cacheExpire = !cacheExpire
  else if (typeof cacheExpire === 'number') cacheExpire *= 1000
  return function(req, res, next) {
    req.cacheExpire = cacheExpire
    next()
  }
}

var isCached = function(req, res) {
  req.viewHash = hash(req.method + req.url + req.headers.ip + req.sessionID + res._locals.layout + res._locals.view)
  req.urlHash = hash(req.url + req.headers.ip + req.sessionID)

  res._headers["Date"] = new Date().toUTCString()
  res._headers["Last-Modified"] = _cache[req.viewHash] || res._headers["Date"]

  if (res._headers["Last-Modified"] === req.headers["if-modified-since"]) {
    res.send(304)
    return true
  }

  switch (typeof req.cacheExpire) {
    case 'undefined':
      if (req.cacheExpire) {
        req.cacheExpire = 60 * 1000
      } else break
    case 'boolean':
      if (req.cacheExpire) break
      else req.cacheExpire = 3 * 60 * 60 * 1000
    case 'number':
      if (!cacheTimeout[req.viewHash]) {
        cacheTimeout[req.viewHash] = setTimeout(function() {
          delete _cache[req.viewHash]
          delete cacheView[req.viewHash]
          delete cacheTimeout[req.viewHash]
        }, req.cacheExpire)
      }
      break
    default:
      break
  }
  
  return false
}

var saveCache = function(req, res, out) {
  if (req.cacheExpire) {
    _cache[req.viewHash] = res._headers["Last-Modified"]
    cacheView[req.viewHash] = out
    if (typeof cacheList[req.urlHash] !== 'object') cacheList[req.urlHash] = { u: hash(req.headers.ip + req.sessionID) }
    cacheList[req.urlHash][req.viewHash] = true
  }
}

var cache = exports.cache = function() {
  return function(req, res, next) {
    var u = hash(req.headers.ip + req.sessionID)
  
    req.expire = function(urlToExpire) {
      if (!urlToExpire) urlToExpire = req.url
      var urlHash = hash(urlToExpire + req.headers.ip + req.sessionID)
      if (cacheList[urlHash] && cacheList[urlHash].u != u) return
      for (var i in cacheList[urlHash]) {
        delete _cache[i]
        delete cacheView[i]
        clearTimeout(cacheTimeout[i])
        delete cacheTimeout[i]
      }
      delete cacheList[urlHash]
    }
    
    req.expireAll = function() {
      for (var i in cacheList) {
        if (cacheList[i].u == u) {
          for (var n in cacheList[i]) {
            delete _cache[n]
            delete cacheView[n]
            clearTimeout(cacheTimeout[n])
            delete cacheTimeout[n]
          }
          delete cacheList[i]
        }
      }
    }
    
    res.render = function(view, locals, renderOnly) {
      locals = locals || {}
      res.local('layout', locals.layout || 'layout')
      res.local('view', view)
      locals.view = view
      
      if (isCached(req, res)) return

      for (var i in locals) {
        // shadowing
        res.local(i, locals[i])
      }
      
      for (var i in res._locals) {
        if (!(i in locals)) locals[i] = res._locals[i]
      }
 
      res.local('partial', function(view, locals) {
        locals = locals || {}
        
        for (var i in locals) {
          // shadowing
          res.local(i, locals[i])
        }
        
        for (var i in res._locals) {
          if (!(i in locals)) locals[i] = res._locals[i]
        }
        
        locals.layout = ''
        req.context._locals = locals
        return render(view, req.context, locals)
      })
      
      locals.partial = res._locals.partial

      res.local('render', function(layout, view, locals) {
        locals = locals || {}
        
        for (var i in locals) {
          // shadowing
          res.local(i, locals[i])
        }
        
        for (var i in res._locals) {
          if (!(i in locals)) locals[i] = res._locals[i]
        }
        
        locals.view = view
        req.context._locals = locals        
        return render(layout, req.context, locals)
      })
      
      locals.render = res._locals.render
      
      req.context._locals = locals
      var out = render(locals.layout, req.context, locals)
      
      saveCache(req, res, out)
     
      res.send(out)
    }
    
    next()
  }
}

exports.stripTags = function (input, allowed) {
  // http://kevin.vanzonneveld.net
  // +   original by: Kevin van Zonneveld (http://kevin.vanzonneveld.net)
  // +   improved by: Luke Godfrey
  // +      input by: Pul
  // +   bugfixed by: Kevin van Zonneveld (http://kevin.vanzonneveld.net)
  // +   bugfixed by: Onno Marsman
  // +      input by: Alex
  // +   bugfixed by: Kevin van Zonneveld (http://kevin.vanzonneveld.net)
  // +      input by: Marc Palau
  // +   improved by: Kevin van Zonneveld (http://kevin.vanzonneveld.net)
  // +      input by: Brett Zamir (http://brett-zamir.me)
  // +   bugfixed by: Kevin van Zonneveld (http://kevin.vanzonneveld.net)
  // +   bugfixed by: Eric Nagel
  // +      input by: Bobby Drake
  // +   bugfixed by: Kevin van Zonneveld (http://kevin.vanzonneveld.net)
  // +   bugfixed by: Tomasz Wesolowski
  // +      input by: Evertjan Garretsen
  // +    revised by: Rafał Kukawski (http://blog.kukawski.pl/)
  // *     example 1: strip_tags('<p>Kevin</p> <br /><b>van</b> <i>Zonneveld</i>', '<i><b>');
  // *     returns 1: 'Kevin <b>van</b> <i>Zonneveld</i>'
  // *     example 2: strip_tags('<p>Kevin <img src="someimage.png" onmouseover="someFunction()">van <i>Zonneveld</i></p>', '<p>');
  // *     returns 2: '<p>Kevin van Zonneveld</p>'
  // *     example 3: strip_tags("<a href='http://kevin.vanzonneveld.net'>Kevin van Zonneveld</a>", "<a>");
  // *     returns 3: '<a href='http://kevin.vanzonneveld.net'>Kevin van Zonneveld</a>'
  // *     example 4: strip_tags('1 < 5 5 > 1');
  // *     returns 4: '1 < 5 5 > 1'
  // *     example 5: strip_tags('1 <br/> 1');
  // *     returns 5: '1  1'
  // *     example 6: strip_tags('1 <br/> 1', '<br>');
  // *     returns 6: '1  1'
  // *     example 7: strip_tags('1 <br/> 1', '<br><br/>');
  // *     returns 7: '1 <br/> 1'

   allowed = (((allowed || "") + "")
      .toLowerCase()
      .match(/<[a-z][a-z0-9]*>/g) || [])
      .join(''); // making sure the allowed arg is a string containing only tags in lowercase (<a><b><c>)
   var tags = /<\/?([a-z][a-z0-9]*)\b[^>]*>/gi,
       commentsAndPhpTags = /<!--[\s\S]*?-->|<\?(?:php)?[\s\S]*?\?>/gi;
   return input.replace(commentsAndPhpTags, '').replace(tags, function($0, $1){
      return allowed.indexOf('<' + $1.toLowerCase() + '>') > -1 ? $0 : '';
   });
}

exports.htmlspecialchars = function (string, quote_style, charset, double_encode) {
  // http://kevin.vanzonneveld.net
  // +   original by: Mirek Slugen
  // +   improved by: Kevin van Zonneveld (http://kevin.vanzonneveld.net)
  // +   bugfixed by: Nathan
  // +   bugfixed by: Arno
  // +    revised by: Kevin van Zonneveld (http://kevin.vanzonneveld.net)
  // +    bugfixed by: Brett Zamir (http://brett-zamir.me)
  // +      input by: Ratheous
  // +      input by: Mailfaker (http://www.weedem.fr/)
  // +      reimplemented by: Brett Zamir (http://brett-zamir.me)
  // +      input by: felix
  // +    bugfixed by: Brett Zamir (http://brett-zamir.me)
  // %        note 1: charset argument not supported
  // *     example 1: htmlspecialchars("<a href='test'>Test</a>", 'ENT_QUOTES');
  // *     returns 1: '&lt;a href=&#039;test&#039;&gt;Test&lt;/a&gt;'
  // *     example 2: htmlspecialchars("ab\"c'd", ['ENT_NOQUOTES', 'ENT_QUOTES']);
  // *     returns 2: 'ab"c&#039;d'
  // *     example 3: htmlspecialchars("my "&entity;" is still here", null, null, false);
  // *     returns 3: 'my &quot;&entity;&quot; is still here'

  var optTemp = 0, i = 0, noquotes= false;
  if (typeof quote_style === 'undefined' || quote_style === null) {
      quote_style = 2;
  }
  string = string.toString();
  if (double_encode !== false) { // Put this first to avoid double-encoding
      string = string.replace(/&/g, '&amp;');
  }
  string = string.replace(/</g, '&lt;').replace(/>/g, '&gt;');

  var OPTS = {
      'ENT_NOQUOTES': 0,
      'ENT_HTML_QUOTE_SINGLE' : 1,
      'ENT_HTML_QUOTE_DOUBLE' : 2,
      'ENT_COMPAT': 2,
      'ENT_QUOTES': 3,
      'ENT_IGNORE' : 4
  };
  if (quote_style === 0) {
      noquotes = true;
  }
  if (typeof quote_style !== 'number') { // Allow for a single string or an array of string flags
      quote_style = [].concat(quote_style);
      for (i=0; i < quote_style.length; i++) {
          // Resolve string input to bitwise e.g. 'PATHINFO_EXTENSION' becomes 4
          if (OPTS[quote_style[i]] === 0) {
              noquotes = true;
          }
          else if (OPTS[quote_style[i]]) {
              optTemp = optTemp | OPTS[quote_style[i]];
          }
      }
      quote_style = optTemp;
  }
  if (quote_style & OPTS.ENT_HTML_QUOTE_SINGLE) {
      string = string.replace(/'/g, '&#039;');
  }
  if (!noquotes) {
      string = string.replace(/"/g, '&quot;');
  }

  return string;
}  

/* Lorem Ipsum Generator
 * (CC-BY) Fredrik Bridell <fredrik@bridell.com> 2009
 * Version 0.21 - multilingual
 * Released under a Creative Commons Attribution License
 *
 * You are welcome to use, share, modify, print, frame, or do whatever you like with this 
 * software, including commercial use. My only request is that you tell the world where you found it.
 * 
 * One way is to include the phrase: 
 * "Using the The Lorem Ipsum Generator by Fredrik Bridell (http://bridell.com/loremipsum/)"
 *
 * To use this on your web page: download the .js file and place it on your web server (please
 * do not include it from my server). In your html file, include the markup
 * <script type="text/javascript" src="loremipsum.js" />
 * (In the head or in the body).
 *
 * Where you want the Lorem Ipsum, include this markup:
 * <script type="text/javascript">loremIpsumParagraph(100)</script>
 * The number is the number of words in the paragraph. 
 */ 

/* Latin words, These are all the words in the first 100 lines of Ovid's Metamorphoses, Liber I. */
var latin =["ab", "aberant", "abscidit", "acervo", "ad", "addidit", "adhuc", "adsiduis", "adspirate", "aequalis", "aer", "aera", "aere", "aeris", "aestu", "aetas", "aethera", "aethere", "agitabilis", "aliis", "aliud", "alta", "altae", "alto", "ambitae", "amphitrite", "animal", "animalia", "animalibus", "animus", "ante", "aquae", "arce", "ardentior", "astra", "aurea", "auroram", "austro", "bene", "boreas", "bracchia", "caeca", "caecoque", "caeleste", "caeli", "caelo", "caelum", "caelumque", "caesa", "calidis", "caligine", "campoque", "campos", "capacius", "carentem", "carmen", "cepit", "certis", "cesserunt", "cetera", "chaos:", "cingebant", "cinxit", "circumdare", "circumfluus", "circumfuso", "coegit", "coeperunt", "coeptis", "coercuit", "cognati", "colebat", "concordi", "congeriem", "congestaque", "consistere", "contraria", "conversa", "convexi", "cornua", "corpora", "corpore", "crescendo", "cum", "cuncta", "cura", "declivia", "dedit", "deducite", "deerat", "dei", "densior", "deorum", "derecti", "descenderat", "deus", "dextra", "di", "dicere", "diffundi", "diremit", "discordia", "dispositam", "dissaepserat", "dissociata", "distinxit", "diu", "diversa", "diverso", "divino", "dixere", "dominari", "duae", "duas", "duris", "effervescere", "effigiem", "egens", "elementaque", "emicuit", "ensis", "eodem", "erant", "erat", "erat:", "erectos", "est", "et", "eurus", "evolvit", "exemit", "extendi", "fabricator", "facientes", "faecis", "fecit", "feras", "fert", "fidem", "figuras", "finxit", "fixo", "flamina", "flamma", "flexi", "fluminaque", "fontes", "foret", "forma", "formaeque", "formas", "fossae", "fratrum", "freta", "frigida", "frigore", "fronde", "fuerant", "fuerat", "fuit", "fulgura", "fulminibus", "galeae", "gentes", "glomeravit", "grandia", "gravitate", "habendum", "habentem", "habentia", "habitabilis", "habitandae", "haec", "hanc", "his", "homini", "hominum", "homo", "horrifer", "humanas", "hunc", "iapeto", "ignea", "igni", "ignotas", "illas", "ille", "illi", "illic", "illis", "imagine", "in", "inclusum", "indigestaque", "induit", "iners", "inmensa", "inminet", "innabilis", "inposuit", "instabilis", "inter", "invasit", "ipsa", "ita", "iudicis", "iuga", "iunctarum", "iussit", "lacusque", "lanient", "lapidosos", "lege", "legebantur", "levitate", "levius", "liberioris", "librata", "ligavit:", "limitibus", "liquidas", "liquidum", "litem", "litora", "locavit", "locis", "locoque", "locum", "longo", "lucis", "lumina", "madescit", "magni", "manebat", "mare", "margine", "matutinis", "mea", "media", "meis", "melior", "melioris", "membra", "mentes", "mentisque", "metusque", "militis", "minantia", "mixta", "mixtam", "moderantum", "modo", "moles", "mollia", "montes", "montibus", "mortales", "motura", "mundi", "mundo", "mundum", "mutastis", "mutatas", "nabataeaque", "nam", "natura", "naturae", "natus", "ne", "nebulas", "nec", "neu", "nisi", "nitidis", "nix", "non", "nondum", "norant", "nova", "nubes", "nubibus", "nullaque", "nulli", "nullo", "nullus", "numero", "nunc", "nuper", "obliquis", "obsistitur", "obstabatque", "occiduo", "omni", "omnia", "onerosior", "onus", "opifex", "oppida", "ora", "orba", "orbe", "orbem", "orbis", "origine", "origo", "os", "otia", "pace", "parte", "partim", "passim", "pendebat", "peragebant", "peregrinum", "permisit", "perpetuum", "persidaque", "perveniunt", "phoebe", "pinus", "piscibus", "plagae", "pluvialibus", "pluviaque", "poena", "pondere", "ponderibus", "pondus", "pontus", "porrexerat", "possedit", "posset:", "postquam", "praebebat", "praecipites", "praeter", "premuntur", "pressa", "prima", "primaque", "principio", "pro", "pronaque", "proxima", "proximus", "pugnabant", "pulsant", "quae", "quam", "quanto", "quarum", "quem", "qui", "quia", "quicquam", "quin", "quinta", "quisque", "quisquis", "quod", "quoque", "radiis", "rapidisque", "recens", "recepta", "recessit", "rectumque", "regat", "regio", "regna", "reparabat", "rerum", "retinebat", "ripis", "rudis", "sanctius", "sata", "satus", "scythiam", "secant", "secrevit", "sectamque", "secuit", "securae", "sed", "seductaque", "semina", "semine", "septemque", "sibi", "sic", "siccis", "sidera", "silvas", "sine", "sinistra", "sive", "sole", "solidumque", "solum", "sorbentur", "speciem", "spectent", "spisso", "sponte", "stagna", "sua", "subdita", "sublime", "subsidere", "sui", "suis", "summaque", "sunt", "super", "supplex", "surgere", "tanta", "tanto", "tegi", "tegit", "tellure", "tellus", "temperiemque", "tempora", "tenent", "tepescunt", "terra", "terrae", "terram", "terrarum", "terras", "terrenae", "terris", "timebat", "titan", "tollere", "tonitrua", "totidem", "totidemque", "toto", "tractu", "traxit", "triones", "tuba", "tum", "tumescere", "turba", "tuti", "ubi", "ulla", "ultima", "umentia", "umor", "unda", "undae", "undas", "undis", "uno", "unus", "usu", "ut", "utque", "utramque", "valles", "ventis", "ventos", "verba", "vesper", "videre", "vindice", "vis", "viseret", "vix", "volucres", "vos", "vultus", "zephyro", "zonae"];

/* Swedish words. These are all the words in the two first paragraphs of August Strindberg's Röda Rummet. */
var swedish = ["afton", "allm&auml;nheten", "allting", "arbetat", "att", "av", "bakom", "barège-lappar", "berberisb&auml;r", "Bergsund", "bers&aring;er", "bestr&ouml;dd", "bj&ouml;do", "blev", "blivit", "blom", "blommor", "bofinkarne", "bon", "bort", "bos&auml;ttningsbekymmer", "branta", "bygga", "b&auml;nkfot", "b&aring;de", "b&ouml;rjade", "b&ouml;rjan", "b&ouml;rjat", "Danviken", "de", "del", "deltogo", "den", "det", "detsamma", "djur", "draga", "drog", "drogos", "d&auml;r", "d&auml;rf&ouml;r", "d&auml;rifr&aring;n", "d&auml;rinne", "d&aring;", "efter", "ej", "ekl&auml;rerade", "emot", "en", "ett", "fjol&aring;rets", "fjor", "fj&auml;rran", "for", "fortsatte", "fram", "friska", "fr&aring;n", "f&auml;rd", "f&auml;stningen", "f&aring;", "f&ouml;nstervadden", "f&ouml;nstren", "f&ouml;r", "f&ouml;rbi", "f&ouml;rdes", "f&ouml;rf&auml;rligt", "f&ouml;rut", "genom", "gick", "gingo", "gjorde", "granris", "gren", "gripa", "gr&aring;sparvarne", "g&aring;", "g&aring;ngarne", "g&aring;tt", "g&ouml;mde", "hade", "halmen", "havet", "hela", "hittade", "hon", "hundar", "hus", "H&auml;stholmen", "h&aring;rtappar", "h&ouml;llo", "h&ouml;stfyrverkeriet", "i", "icke", "igen", "ilade", "illuminerade", "in", "ingen", "innanf&ouml;nstren", "Josefinadagen", "just", "kastade", "kiv", "klistringen", "kl&auml;ttrade", "knoppar", "kol", "kom", "korset", "korta", "kunde", "kvastar", "k&auml;nde", "k&auml;rleksfilter", "k&ouml;ksan", "lavkl&auml;dda", "lekte", "levdes", "Liding&ouml;skogarne", "ligger", "Liljeholmen", "lilla", "lindarne", "liv", "luften", "lukten", "l&auml;mna", "l&aring;ngt", "l&ouml;vsamlingar", "maj", "med", "medan", "mellan", "men", "moln", "Mosebacke", "mot", "m&auml;nskofot", "navigationsskolans", "nu", "n&auml;san", "obesv&auml;rat", "obrustna", "och", "ofruktsamt", "om", "os", "paljetter", "passade", "piga", "plats", "plockade", "p&auml;rontr&auml;d", "p&aring;", "rabatterna", "rakethylsor", "Riddarfj&auml;rden", "Riddarholmskyrkan", "ringdans", "rivit", "Rosendal", "rosenf&auml;rgat", "rusade", "r&ouml;karne", "saffransblommorna", "samla", "samma", "sandg&aring;ngarne", "sedan", "sig", "Sikla&ouml;n", "sin", "sina", "sista", "Sj&ouml;tullen", "Sj&ouml;tulln", "Skeppsbrob&aring;tarne", "skolan", "skr&auml;md", "skr&auml;p", "skydd", "sk&ouml;t", "slagits", "slog", "sluppit", "sluta", "snart", "sn&ouml;", "sn&ouml;dropparne", "solen", "som", "sommarn&ouml;jena", "spillror", "Stadsg&aring;rden", "stam", "stekflott", "stickorna", "stod", "stor", "stora", "stranden", "str&aring;lar", "st&ouml;rtade", "sydlig", "syrenerna", "s&aring;go", "s&aring;gsp&aring;n", "s&aring;lunda", "s&ouml;dra", "tagit", "tak", "takpannorna", "till", "tillbaka", "tittade", "tj&auml;ra", "tonade", "trampat", "tran", "tr&auml;d", "tr&auml;dg&aring;rden", "Tyskans", "t&ouml;rnade", "t&ouml;rnrosblad", "undanr&ouml;jda", "under", "unga", "upp", "uppf&ouml;r", "uppgr&auml;vda", "ur", "ut", "utefter", "utmed", "var", "Vaxholm", "verksamhet", "vilka", "vilken", "vimplarne", "vind", "vinden", "vinterns", "voro", "v&auml;gg", "v&auml;ggen", "v&auml;ntade", "&auml;nnu", "&aring;ret", "&aring;t", "&ouml;lskv&auml;ttar", "&ouml;mt&aring;ligare", "&ouml;ppnad", "&ouml;ppnades", "&ouml;ster", "&ouml;ver"];

// just switch language like this! You can also do this in a script block on the page. 
var loremLang = latin;

/* Characters to end a sentence with. Repeat for frequencies (i.e. most sentences end in a period) */
var endings = "................................??!";

/* randomly returns true with a certain chance (a percentage) */
function chance(percentage){
	return (Math.floor(Math.random() * 100) < percentage);
}

/* capitalizes a word */
function capitalize(aString){
	return aString.substring(0,1).toUpperCase() + aString.substring(1, aString.length);
}

/* returns a random lorem word */
function getLoremWord(){
	return loremLang[Math.floor(Math.random()*loremLang.length)];
}

function getLoremEnding(){
	var i = Math.floor(Math.random()*endings.length);
	return endings.substring(i, i+1);
}

/* inserts a number of lorem words. Does not append a space at the end. */
var loremIpsum = exports.loremIpsum = function(numWords){
  var words = []
	for(var i=0; i<numWords-1; i++){
		words.push(getLoremWord());
	}
	words.push(getLoremWord());
  return words.join(' ')
}

/* inserts a sentence of random words. Appends a space at the end. */
var loremIpsumSentence = exports.loremIpsumSentence = function(numWords){
  var words = []
  words.push(capitalize(getLoremWord()) + " ");
	words.push(loremIpsum(numWords-1) + getLoremEnding());
	return words.join(' ')
}

/* inserts a sentence of random words, sometimes with extra punctuation. Appends a space at the end. */
var loremIpsumSentence2 = exports.loremIpsumSentence2 = function(numWords){
  var words = []
  words.push(capitalize(getLoremWord()));
	var part1 = 0;
	if(chance(50)){
		// insert a comma or other punctuation within the sentence
		part1 = Math.floor(Math.random() * numWords-2);
		words.push(loremIpsum(part1) + ',');
	}
	words.push(loremIpsum(numWords - part1 - 1) + getLoremEnding());
	return words.join(' ');
}

/* inserts a paragraph of sentences of random words. */
var loremIpsumParagraph = exports.loremIpsumParagraph = function(numWords){
	var words = []
  
	while(numWords > 0){
		if(numWords > 10){
			w = Math.floor(Math.random() * 8) + 2;
			words.push(loremIpsumSentence2(w));
			numWords = numWords - w;
		} else {
			words.push(loremIpsumSentence2(numWords));
			numWords = 0;
		}
	}

  return words.join(' ')
}

var rand = exports.rand = function(n) {
  return Math.floor(Math.random() * n)
}
