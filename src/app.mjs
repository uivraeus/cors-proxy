import { createServer } from 'http'
import { get } from 'https'
import validUrl from 'valid-url';

//Don't hang for more than 3s if target can't be reached

//Handle configuration
const PORT = Number(process.env.PROXY_PORT || 33000)
const API_ROUTE = process.env.PROXY_ROUTE || "/cors-proxy/"
const FWD_TIMEOUT_MS =  Number(process.env.PROXY_TIMEOUT_MS || 3000)

//Assertive parsing of environment variable which must be a (json) array
const allowOrigins = parseEnvArray("PROXY_ALLOW_ORIGINS")
const allowedTargetPatterns = parseEnvArray("PROXY_ALLOW_TARGET_PATTERNS")

//Limit which headers that will be forwarded (back and forth)
const includedReqHeaders = [
  "accept",
  "user-agent"
]
const includedResHeaders = [
  "content-type",
  "cache-control",
  "last-modified",
  "content-length"
]

//Initialize and start the proxy server
const options = {}
const server = createServer(options)
server.on("request", serveClientReq)

server.listen(PORT)
console.log(`${utc()}: Server listening on port: ${PORT}`)

/* Common request listener 
 */
function serveClientReq(clientReq, clientRes) {
  const clientIp = clientReq.headers['x-forwarded-for'] || clientReq.socket.remoteAddress 
  const origin = clientReq.headers['origin']
  
  // Early exit if origin is not allowed
  if (origin && !isAllowedOrigin(origin)) {
    console.log(`${utc()}: Discard proxy request from ${clientIp}, origin ${origin} not allowed`);
    resEnd(clientRes, 406)
    return
  }

  // Is this a valid API request? 
  const fullUrl = clientReq.url
  if (fullUrl.startsWith(API_ROUTE)) {
    const target = fullUrl.slice(API_ROUTE.length)

    // Early exit if the target isn't within specs
    if (!target || !validUrl.isHttpsUri(target) || !isAllowedTarget(target)) {
      console.log(`${utc()}: There is no valid target endpoint in the request:`, target || "<none>");
      resEnd(clientRes, 400)
      return
    }

    const method = clientReq.method
    if (method === "OPTIONS" || method === "GET") {
      if (origin) {
        setCoorsHeaders(clientReq, clientRes, origin)
      }
      if (method === "OPTIONS") {
        // CORS Preflight
        resEnd(200)
      } else if (method === "GET") {
        const reqType = origin ? "COORS" : "back-end API";
        console.log(`${utc()}: Try proxy ${reqType} request from ${clientIp} to ${target}`);
        fwdGetRequest(clientReq, target, clientRes);
      }
    } else {
      console.log(`${utc()}: Unsupported method in request from ${clientIp}: ${clientReq.method}`);
      resEnd(clientRes, 405)
    }
  } else {
    console.log(`${utc()}: Unsupported URL in request from ${clientIp}: ${fullUrl}`);
    resEnd(clientRes, 404)
  }
}

function fwdGetRequest(clientReq, target, clientRes) {
  const targetOpt = {
    headers: copyHeaders(includedReqHeaders, clientReq.headers),
    timeout: FWD_TIMEOUT_MS
  };
  const targetReq = get(target, targetOpt, targetRes => {
    console.log(`${utc()}: -> status code: ${targetRes.statusCode}`);

    if (targetRes.statusCode !== 200) {
      targetRes.resume(); // Consume response data to free up memory
      resEnd(clientRes, targetRes.statusCode)
      return; //no need to configure event handlers
    }    
  
    // Forward a few selected headers (if present)
    includedResHeaders.forEach(name => fwdHeader(clientRes, name, targetRes.headers));
    
    // Configure handlers for managing the actual data forwarding
    targetRes.on("data", chunk => clientRes.write(chunk));
    targetRes.on("end", () => clientRes.end());
    targetRes.on("error", e => {
      console.error(`${utc()}: ERROR: failed to GET from target, error:`, e.message || e);
      // Is is feasible to set the status code here? What if error occurs half way through the chunks?
      resEnd(clientRes)
    });
  });
  
  //Specific error instance to distinguish special timeout case
  const timeoutError = new Error("target GET timeout")

  targetReq.on("error", e => {
    console.error(`${utc()}: ERROR: failed to GET from target, error:`, e.message || e);
    resEnd(clientRes, e === timeoutError ? 504 : 500)
  });
  targetReq.on("timeout", () => {
    targetReq.destroy(timeoutError);
  });
}

function fwdHeader(res, name, srcHeaders) {
  const value = srcHeaders[name]
  if (value !== undefined) {
    res.setHeader(name, value)
  }
}

function copyHeaders(headerNames, srcHeaders) {
  let dstHeaders = {}
  headerNames.forEach(name => {
    const value = srcHeaders[name]
    if (value !== undefined) {
      dstHeaders[name] = srcHeaders[name]
    }
  });
  return dstHeaders
}

function setCoorsHeaders(req, res, origin) {
  res.setHeader("Access-Control-Allow-Origin", origin);
  res.setHeader("Access-Control-Allow-Methods", "GET");
  const acrh = req.headers['access-control-request-headers']
  if (acrh) {
    res.setHeader("Access-Control-Allow-Headers", acrh);
  }
}
function resEnd(res, code) {
  if (Number.isInteger(code)) {
    res.writeHead(code)
  }
  res.end()
}
//Helper for deriving the applicable Allow-origin (or null if actually not allowed)
function isAllowedOrigin (origin) {
  //Incorrect request -> deny
  if (!origin) return false

  //Valid request, when we haven't limited usage
  if (allowOrigins.length === 0) return true

  //Otherwise, check if origin included in the list
  if (allowOrigins.findIndex(o => o === origin) !== -1) {
    return true
  } else {
    return false
  }
}

function isAllowedTarget(target) {
  //Incorrect request -> deny
  if (!target) return false
  
  //Valid request, when we haven't limited usage
  if (allowedTargetPatterns.length === 0) return true

  if (allowedTargetPatterns.findIndex(t => RegExp(t).test(target)) !== -1) {
    return true
  } else {
    return false
  }
}

//If not configured, then allow all. But if misconfigured, then bail out
function parseEnvArray(varName) {
  if (!process.env[varName]) {
    return []
  }
  let raw = ""
  try {
    raw = process.env[varName]
    const a = JSON.parse(raw)
    if (!Array.isArray(a)) throw new Error("Wrong type.")
    return a
  } catch(e) {
    console.error(varName, "not defined as JSON array:\n", e.message)
    console.log("Raw value:", raw)
    process.exit(1)
  }
}

function utc() {
  return new Date().toISOString()
}