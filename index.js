var util = require("util"),
    events = require('events'),
    _ = require('lodash'),
    HttpContext = require('./lib/httpcontext.js'),
    pipeline = require('node-pipeline'),
    formidable = require('formidable');

var Router = function() {
  var that = this;

  this.plRouter = pipeline.create();
  this.params = [];
  this.parsed = false;
  this.httpContext = null;

  this.on('body', function() {
    that.parsed = true;
  });

  this.plRouter.on('error', function(err, results){ 
    if (err) {
      that.emit('error', err, results);
    }
  });
}; 

util.inherits(Router, events.EventEmitter);

Router.prototype.dispatch = function(request, response) {
  var that = this;
  var httpContext = this.httpContext = new HttpContext(request, response);

  // parse body on post
  if (httpContext.request.method == 'POST') {
    var form = new formidable.IncomingForm();

    form.on('field', function(field, value) {
      httpContext.body = httpContext.body || {};
      httpContext.body[field] = value;            
    });
    
    form.on('error', function(err) {
      httpContext.body = err;
      that.emit('body', err);
    });

    form.on('end', function() {
      that.emit('body', httpContext.body);
    });

    form.parse(httpContext.request);
  }

  this.plRouter.on('end', function(err, results) {
    var matched = results[0].matched,
        res = results[0].httpContext.response;

    if (!matched || err) {    
      res.statusCode = 404;
      res.write("No matching route or failed route");
      res.end(err ? err.stack : '');
    }
  });

  this.plRouter.execute({ httpContext: httpContext });
};



Router.prototype.use = function(method, urlformat, callback) {
  var options = {},
      that = this;

  options.callback = _.last(arguments);
  options.method = method.toUpperCase();

  // support plain old regex
  if (urlformat instanceof RegExp) {
    options.urlformat = urlformat;
  }
  else {
    _.extend(options, this.parseParams(urlformat));
  }

  this.plRouter.use(function(data, next) {
    var matched = data[0].matched,
        httpContext = data[0].httpContext,
        pathname = httpContext.url.pathname;

    if ( !matched && httpContext.request.method === options.method && options.urlformat.test(pathname) ) {
        
      // stop trying to match
      data[0].matched = true;
      next(null, options);

      // send to handler
      httpContext.params = that.parseUrl(pathname, options.paramMap);

      // TODO: validate query against params
      httpContext.query = httpContext.url.query;

      if (httpContext.request.method == 'POST' && !that.parsed) {
        that.on('body', function() {
          callback(httpContext);
        });
      }
      else {
        callback(httpContext);
      }
    }
    else {
      next();
    }
  });
};
Router.prototype.get = function(urlformat, callback) {
  Array.prototype.splice.call(arguments, 0, 0, 'get');
  return this.use.apply(this, arguments);
};
Router.prototype.post = function(urlformat, callback) {
  Array.prototype.splice.call(arguments, 0, 0, 'post');
  return this.use.apply(this, arguments);
};
Router.prototype.param = function(arg0, arg1) {
  var params = [];

  if (_.isArray(arg0)) {
    params = arg0;
  }
  else {  
    // insert the single param to the array for concat below.
    params.push({ name: arg0, regex: arg1 });
  }

  // convert nulls and strings to regex
  _.each(params, function(p) {
    // default null vals to catch all regex.
    if (p.regex == null) {
      p.regex = /(.*)/;
    }
    // convert string vals to regex.
    else if (_.isString(p.regex)) {
      p.regex = new RegExp(p.regex);
    }
  });

  // add to the array of params for this instance
  this.params = this.params.concat(params);
};



Router.prototype.parseUrl = function(url, paramMap) {
  var restParams = url.split('/'),
      ret = {},
      that = this;

  if (restParams[0] === "") {
    restParams.splice(0, 1);
  }

  _.each(paramMap, function(pmap, i) {
    var param = restParams[i];
    if (param && pmap) {
      var m = pmap.regex.exec(param);
      if (m) {
        ret[pmap.name] = _.last(m);
      }
    }
  });

  return ret;

};
/** ------- **/

var regexSplit = /(\?|\/)([^\?^\/]+)/g;
Router.prototype.parseParams = function(s) {
  s = s || '';
    
  var restParams = s.match(regexSplit),
      that = this,
      paramMap = [],
      urlformat = [];

  if (!restParams || restParams.length === 0) {
    restParams = [s];
  }

  // replace named params with corresponding regexs and build paramMap.
  _.each(restParams, function(str, i) {
    var param = _.find(that.params, function(p) { return str.substring(1) === ':' + p.name; });

    if (param) {
      paramMap.push(param);
      var rstr = param.regex.toString();
      urlformat.push('\\/' + (str[0] === '?' ? '?' : '')); // push separator (double backslash escapes the ? or /)
      urlformat.push(rstr.substring(1, rstr.length - 1));  // push regex
    }
    else {
      paramMap.push(null);
      urlformat.push(str);
    }
  });

  return {
    urlformat: new RegExp('^' + urlformat.join('') + '$'),
    paramMap: paramMap
  };
};

module.exports = Router;