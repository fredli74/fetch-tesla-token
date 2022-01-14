/**
 * Bare bone Node.js Tesla Token Exchange API.
 * 
 * @file Functions to communicate with Tesla authentication servers to get bearer and access tokens. Does not authenticate SSO sessions.
 * @author Fredrik Lidström
 * @copyright 2022 Fredrik Lidström
 * @license MIT (MIT)
 */

const { TRACE } = process.env;

const https = require("https");
const crypto = require("crypto");

class TeslaAuthException extends Error { };
class TeslaAuthUnauthorized extends Error { };

/**
 * Simple base64 to base64url converter.
 *
 * @param {Buffer} buffer - Byte buffer to convert
 * @returns {string} Base64url representation
 */
function bufferBase64url(buffer) {
  return buffer.toString("base64").replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=/g, "");
}

/**
 * Makes sure the base url has a trailing slash and then joins the path
 *
 * @param {string} url - absolute or relative URL
 * @param {string} base - base URL
 * @returns {string} combined URL in string format
 */
function joinURL(url, base) {
  return (new URL(url, base.endsWith("/") ? base : base + "/")).toString();
}

/**
 * Promisified https.request.
 * 
 * If data is provided, Content-Length is added automatically, but the Content-Type
 * must be set manually in the provided headers.
 * 
 * @throws {TeslaAuthException} On statusCode >= 500
 * @throws {TeslaAuthUnauthorized} On statusCode >= 400
 * @throws {Error} On any other error
 * @param {Object} opt - Options to pass to https.request
 * @param {Object|undefined} data - Data
 * @returns {http.ClientRequest} 
 */
function request(url, opt, data) {
  opt.headers = opt.headers || {};
  opt.headers["User-Agent"] = "TeslaAPI-proxy/2.0 (Node.js)";
  opt.headers["Accept"] = "application/json, text/plain, */*";
  if (data !== undefined) {
    opt.headers["Content-Length"] = Buffer.byteLength(data);
  }

  if (TRACE) console.log(`TRACE -> request(${JSON.stringify(opt)}, ${JSON.stringify(cookieJar)}, ${JSON.stringify(data)})`);

  return new Promise((resolve, reject) => {
    const req = https.request(url, opt, (res) => {
      let body = "";
      res.setEncoding("binary");
      res.on("error", (e) => reject(e));
      res.on("data", chunk => body += chunk)
      res.on("end", () => {
        if (TRACE) console.log(`TRACE <- ${res.statusCode} ${res.statusMessage} ${JSON.stringify(body)}`);

        if (res.statusCode >= 500) {
          reject(new TeslaAuthException(`${res.statusCode} ${res.statusMessage}`));
        } else if (res.statusCode >= 400) {
          reject(new TeslaAuthUnauthorized(`${res.statusCode} ${res.statusMessage}`));
        } else {
          resolve({
            statusCode: res.statusCode,
            headers: res.headers,
            body: body
          });
        }
      });
    });
    req.on("error", (e) => reject(e));
    if (data) {
      req.write(data);
    }
    req.end();
  });
}


/**
 * Start a new authentication session and generate the authentication URL
 * 
 * @export
 * @throws {TeslaAuthException|Error} On error
 * @returns {Object} { url: string, state: string, codeVerifier: string, codeChallenge: string }
 */
function newSession() {
  // Generate a random state identifier string
  const state = bufferBase64url(crypto.randomBytes(16));
  // Generate a random code verifier string
  const codeVerifier = bufferBase64url(crypto.randomBytes(64));
  // SHA-256 hash the codeVerifier string
  const hash = crypto.createHash("sha256").update(codeVerifier).digest("hex");
  const codeChallenge = bufferBase64url(Buffer.from(hash));
  // Generate a Tesla SSO Sign In URL
  const url = `https://auth.tesla.com/oauth2/v3/authorize?${new URLSearchParams({
    client_id: "ownerapi",
    code_challenge: codeChallenge,
    code_challenge_method: "S256",
    redirect_uri: `https://auth.tesla.com/void/callback`,
    response_type: "code",
    scope: "openid email offline_access",
    state: state
  })}`;
  return { url, state, codeVerifier, codeChallenge };
}

/**
 * Decodes the callback URL redirected to by the Tesla SSO Authentication server
 *
 * @export
 * @throws {Error} When URL cannot be decoded
 * @param {string} url - URL to decode
 * @returns {Object} { code:string, state:string|undefined, issuer:string|undefined }
 */
function decodeCallbackURL(url) {
  const params = (new URL(url)).searchParams;
  const code = params.get("code");
  if (!code) {
    throw new TeslaAuthException("Incorrect URL, no code detected.");
  }
  const state = params.get("state") || undefined;
  const issuer = params.get("issuer") || undefined;
  return { code, state, issuer }
}

/**
 * Exchange authorization code for bearer token
 *
 * @export
 * @throws {Error} On error
 * @param {string} code - Authorization code from successful Tesla SSO Sign In
 * @param {string} code_verifier - codeVerifier from newSession()
 * @param {string} [issuer=https://auth.tesla.com/oauth2/v3] - Optional authentication base url
 * @returns {Object} bearer token object
 */
async function bearerToken(code, code_verifier, issuer) {
  try {
    const url = joinURL("token", issuer || "https://auth.tesla.com/oauth2/v3");
    const res = await request(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" }
    }, JSON.stringify({
      grant_type: "authorization_code",
      client_id: "ownerapi",
      code,
      code_verifier,
      redirect_uri: "https://auth.tesla.com/void/callback"
    }));
    const token = JSON.parse(res.body);
    token.issuer = issuer;
    return token;
  } catch (err) {
    err.message = "Error fetching Tesla auhtorization token - " + err.message;
    throw err;
  }
}

/**
 * Obtain a new authentication token from a refresh_token
 *
 * @export
 * @throws {Error} On error
 * @param {string} refresh_token - refresh_token previously collected from the Tesla authentication API
 * @param {string} [issuer=https://auth.tesla.com/oauth2/v3] - Optional authentication base url
 * @returns {Object} Returns the Tesla server token response
 */
async function refreshToken(refresh_token, issuer) {
  const url = joinURL("token", issuer || "https://auth.tesla.com/oauth2/v3");
  const res = await request(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" }
  }, JSON.stringify({
    grant_type: "refresh_token",
    scope: "openid email offline_access",
    client_id: "ownerapi",
    refresh_token: refresh_token
  }));
  return JSON.parse(res.body);
}

/**
 * Exchange an authentication access_token for an owner-api access_token
 *
 * @param {string} bearerToken - bearerToken.access_token collected from bearerToken()
 * @returns {Object} Returns the Tesla server token response
 */
async function ownerapiToken(bearerToken) {
  const res = await request("https://owner-api.teslamotors.com/oauth/token", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${bearerToken}`,
      "Content-Type": "application/json"
    }
  }, JSON.stringify({
    "grant_type": "urn:ietf:params:oauth:grant-type:jwt-bearer",
    "client_id": "81527cff06843c8634fdc09e8ac0abefb46ac849f38fe1e431c2ef2106796384",
    "client_secret": "c7257eb71a564034f9419ee651c7d0e5f7aa6bfbd18bafb5c5c033b093bb2fa3"
  }));
  return JSON.parse(res.body);
}

module.exports = {
  TeslaAuthException,
  TeslaAuthUnauthorized,
  newSession,
  decodeCallbackURL,
  bearerToken,
  refreshToken,
  ownerapiToken
};