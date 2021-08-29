import express from 'express';
import request from 'request';
import validUrl from 'valid-url';
import rateLimit from 'express-rate-limit';

//Handle configuration
const port = process.env.PROXY_PORT || 3000;
const apiRoute = process.env.PROXY_ROUTE || "/cors-proxy/";
const rateLimitWindowMs =  process.env.PROXY_RL_WINDOW_MS || (5 * 60 * 1000); //5 minutes
const rateLimitMax = process.env.PROXY_RL_WINDOW_MS || 20; //max #requests per windows (per IP)

//If not configured, then allow all. But if misconfigured, then bail out
const allowOrigins = process.env.PROXY_ALLOW_ORIGINS
  ? function parseOrigins() {
      try {
        const a = JSON.parse(process.env.PROXY_ALLOW_ORIGINS);
        if (!Array.isArray(a)) throw new Error("Wrong type.");
        return a;
      } catch(e) {
        console.error("PROXY_ALLOW_ORIGINS not defined as JSON array:\n", e.message);
        process.exit(1);
      }
    }()
  : [];

//Initialize the (Express) app
const app = express()
app.disable('x-powered-by');

//Make rate-limiter work behind a reverse proxy
app.set('trust proxy', 1);
const limiter = rateLimit({
  windowMs: rateLimitWindowMs,
  max: rateLimitMax
});
app.use(limiter);

app.all(`${apiRoute}*`, function (req, res, next) {
  // For logging
  const ip = req.ip;
  const ipFW = req.headers['x-forwarded-for'] || req.socket.remoteAddress 

  // Set CORS headers:
  const origin = req.header('origin');
  if (isAllowedOrigin(origin)) {
    res.header("Access-Control-Allow-Origin", origin);
    res.header("Access-Control-Allow-Methods", "GET");
    res.header("Access-Control-Allow-Headers", req.header('access-control-request-headers'));
  
    try {
      if (req.method === 'OPTIONS') {
        // CORS Preflight
        console.log("OPTIONS / Preflight");
        res.send();
      } else if (req.method === 'GET') {
        const target = encodeURI(req.params[0]);
        if (!target || !validUrl.isHttpsUri(target)) {
          const msg = "There is no valid Target-Endpoint in the request";
          console.log(msg, target);
          res.status(400).send(msg);
        } else {
          console.log(`Try proxy request from ${ip}/${ipFW} to ${target}`);

          request({ url: target, method: req.method, headers: {'accept': req.header('accept')}})
          .on('error', err => {
            const msg = "Can't connect to target.";
            console.error(msg, err);
            res.status(500).send(msg);
          })
          .on('response', resp => {
            console.log("Done:", resp.statusCode, resp.statusMessage, resp.headers);
          })
          .pipe(res);
        }
      } else {
          console.log("Not GET/OPTIONS", req.method, JSON.stringify(req.headers));
          res.set('Allow', 'GET', 'OPTIONS');
          res.send(405, 'Method Not Allowed');      
      }
    } catch (error) {
      const msg = "Can't connect to target.";
      console.error(msg, target, error.message);
      res.status(500).end();
    }
  } else {
    const msg = origin ? `Origin ${origin} not allowed` : "Origin not provided";
    console.log(`Discard proxy request from ${ip}/${ipFW}`);
    console.error(msg);
    res.status(406).end();
  }  
});

app.listen(port, () => {
  console.log(`CORS-proxy running with configuration:`);
  console.log(` port/route            : ${port}${apiRoute}`);
  console.log(` rate-limit window/max : ${rateLimitWindowMs}/${rateLimitMax}`);
  console.log(` allow origins         : [${allowOrigins}]`);
})

//Helper for deriving the applicable Allow-origin (or null if actually not allowed)
const isAllowedOrigin = (origin) => {
  //Incorrect request -> deny
  if (!origin) return false;

  //Valid request, when we haven't limited usage
  if (allowOrigins.length === 0) return true;

  //Otherwise, check if origin included in the list
  if (allowOrigins.findIndex(o => o === origin) !== -1) {
    return true;
  } else {
    return false;
  }
}