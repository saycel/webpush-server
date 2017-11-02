// Kamailio sends json with ' instead of ", this midelware tries to convert this into a valid json format

module.exports = (req, res, next) => {
    req.rawBody = ''
    req.on('data', function(chunk) {
        req.rawBody += chunk;
    });

    req.on('end', function() {
      try {
        req.body = JSON.parse(req.rawBody.replace(/'/g, "\""));
      } catch (err) {
        req.body = req.rawBody;
      }
      next();
    });  
}