/**
 * Bare bone Node.js Tesla Authentication API.
 * 
 * @file Functions to communicate with Tesla authentication servers
 * @author Fredrik Lidström
 * @copyright 2021 Fredrik Lidström
 * @license MIT (MIT)
 */

const https = require("https");
const crypto = require("crypto");
const querystring = require("querystring");

const TESLA_AUTH_HOST = "auth.tesla.com";
const TESLA_API_HOST = "owner-api.teslamotors.com";
const TESLA_API_CLIENT_ID = "81527cff06843c8634fdc09e8ac0abefb46ac849f38fe1e431c2ef2106796384";
const TESLA_API_CLIENT_SECRET = "c7257eb71a564034f9419ee651c7d0e5f7aa6bfbd18bafb5c5c033b093bb2fa3";

class TeslaAuthException extends Error { };
class TeslaAuthIncorrectRegion extends Error { };
class TeslaAuthIncorrectCaptcha extends Error { };
class TeslaAuthUnauthorized extends Error { };
class TeslaAuthMFARequired extends Error { };

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
 * Promisified https.request.
 * 
 * If cookieJar is provided it will be used for a super stupid cookie mirror
 * handling with no expiry or path logic.
 * 
 * If data is provided, Content-Length is added automatically, but the Content-Type
 * must be set manually in the provided headers.
 * 
 * @throws {TeslaAuthException} On statusCode >= 500
 * @throws {TeslaAuthUnauthorized} On statusCode >= 400
 * @throws {Error} On any other error
 * @param {Object} opt - Options to pass to https.request
 * @param {Object|undefined} cookieJar - Object to send and store cookies
 * @param {Object|undefined} data - Data
 * @returns {http.ClientRequest} 
 */
function request(opt, cookieJar, data) {
  opt.headers = opt.headers || {};
  opt.headers["User-Agent"] = "TeslaAPI-proxy/2.0 (Node.js)";
  opt.headers["Accept"] = "application/json, text/plain, */*";
  if (data !== undefined) {
    opt.headers["Content-Length"] = Buffer.byteLength(data);
  }
  if (typeof cookieJar === "object" && Object.keys(cookieJar).length) {
    opt.headers["Cookie"] = Object.entries(cookieJar).map(c => `${c[0]}=${c[1]}`).join("; ");
  }

  return new Promise((resolve, reject) => {
    const req = https.request(opt, (res) => {
      let body = "";
      res.setEncoding("binary");
      res.on("error", (e) => reject(e));
      res.on("data", chunk => body += chunk)
      res.on("end", () => {
        if (res.statusCode >= 500) {
          reject(new TeslaAuthException(`${res.statusCode} ${res.statusMessage}`));
        } else if (res.statusCode >= 400) {
          reject(new TeslaAuthUnauthorized(`${res.statusCode} ${res.statusMessage}`));
        } else {
          // Super simple stupid cookie handling, just mirroring what was sent to us
          if (typeof cookieJar === "object" && res.headers["set-cookie"]) {
            for ([k, v] of Object.entries(
              res.headers["set-cookie"].reduce((r, e) => {
                const pair = e.match(/(.+?)=([^;]*)/);
                r[pair[1]] = pair[2];
                return r;
              }, {})
            )) {
              cookieJar[k] = v;
            }
          }

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
 * Call Tesla autorize API
 * 
 * If data is provided, it will POST a request instead of using GET, using
 * Content-Type: "application/x-www-form-urlencoded"
 *
 * @throws {Error} On error
 * @param {Object} session - Session object from newSession()
 * @param {Object|undefined} data - Data
 * @returns {http.ClientRequest}
 */
async function autorizeRequest(session, data) {
  const opts = {
    host: TESLA_AUTH_HOST,
    path: `/oauth2/v3/authorize?${querystring.stringify({
      client_id: "ownerapi",
      code_challenge: session.codeChallenge,
      code_challenge_method: "S256",
      redirect_uri: `https://auth.tesla.com/void/callback`,
      response_type: "code",
      scope: "openid email offline_access",
      state: session.state
    })}`,
  };
  if (data) {
    opts.method = "POST";
    opts.headers = { "Content-Type": "application/x-www-form-urlencoded" }
    return request(opts, session.cookieJar, querystring.stringify(data));
  }
  return request(opts, session.cookieJar);
}

/**
 * Start a new authentication session and scrape the SSO signup form
 * 
 * @export
 * @throws {TeslaAuthException|Error} On error
 * @returns {Object} { session: Object, htmlForm: Object }
 */
async function newSession() {
  // Generate a verifier ID and its hash
  const state = bufferBase64url(crypto.randomBytes(16));
  const codeVerifier = bufferBase64url(crypto.randomBytes(64));
  const hash = crypto.createHash("sha256").update(codeVerifier).digest("hex");
  const codeChallenge = bufferBase64url(Buffer.from(hash));

  const session = {
    state,
    codeChallenge,
    codeVerifier,
    cookieJar: {},
  };

  // Obtain and scrape the sign in page
  const htmlForm = {};
  try {
    const res = await autorizeRequest(session);
    const form = res.body.match(/<form.+?id=\"form\".+?>(.+?)<\/form>/s);
    if (form.length < 2) {
      throw new TeslaAuthException("Unable to find sign in form");
    }
    for (input of form[1].matchAll(/<input.+?name=\"([^"]+)\".+?\>/g)) {
      const value = input[0].match(/value=\"([^"]+)\"/);
      htmlForm[input[1]] = value && value[1] || "";
    }
    if (htmlForm.identity === undefined || htmlForm.credential === undefined) {
      throw new TeslaAuthException("Unable to parse sign in form");
    }
  } catch (err) {
    err.message = "Error fetching Tesla sign in page - " + err.message;
    throw err;
  }

  return {
    session,
    htmlForm
  }

}

/**
 * Get a captcha image and encode it as a dataURI
 *
 * @export
 * @throws {Error} On error
 * @param {Object} session - Session object from newSession()
 * @returns
 */
async function getCaptcha(session) {
  const res = await request({
    host: TESLA_AUTH_HOST,
    path: "/captcha"
  }, session.cookieJar);

  const media = res.headers["content-type"].replace(/ /g, "");
  const data = Buffer.from(res.body).toString("base64");

  return `data:${media};base64,${data}`;
}

/**
 * Authenticate with Tesla OAuth 2.0 authentication server (v3)
 *
 * @export
 * @throws {TeslaAuthIncorrectCaptcha} When captcha is required and incorrect
 * @throws {TeslaAuthMFARequired} When account has MFA enabled
 * @throws {TeslaAuthIncorrectRegion} If account belongs to a different region
 * @throws {TeslaAuthUnauthorized} If authorization fails
 * @throws {TeslaAuthException|Error} On any other error
 * @param {string} identity - Tesla account email address
 * @param {string} credential - Tesla account password
 * @param {string|undefined} passcode - Multi-Factor Authentication passcode (optional)
 * @returns {string} Authorization code
 */
async function authenticate(session, formData) {
  try {
    let res = await autorizeRequest(session, formData);
    if (res.statusCode === 200 && res.body.match(/Captcha does not match/)) {
      throw new TeslaAuthIncorrectCaptcha("captcha does not match");
    } else if (res.statusCode === 200 && res.body.match(/authorize\/mfa\/verify/)) {
      throw new TeslaAuthMFARequired("Multi-Factor Authentication required");
    } else if (res.statusCode === 303) {
      // TODO: Add support for tesla.cn
      throw new TeslaAuthIncorrectRegion("incorrect server region");
    } else if (res.statusCode === 302) {
      // Verify redirect
      const redirectURL = res.headers.location;
      const redirectQuery = querystring.parse(redirectURL.split("?")[1]);
      if (redirectQuery.state !== session.state) {
        throw new TeslaAuthException("Invalid state returned by Tesla server");
      }
      return redirectQuery.code

    } else {
      throw new TeslaAuthUnauthorized("Unknown");
    }
  } catch (err) {
    err.message = "Tesla sign in page error - " + err.message;
    throw err;
  }
}

/**
 * Get a list of MFA devices registered to the account
 *
 * @export
 * @throws {TeslaAuthException} factors unavailable
 * @throws {Error} On any other error
 * @param {Object} session - Session object from newSession()
 * @param {string} transaction_id - Transaction ID obtained from the SSO form
 * @returns {Object} Array of all MFA devices registered 
 */
async function getFactors(session, transaction_id) {
  const mfaFactors = JSON.parse(
    (
      await request({
        host: TESLA_AUTH_HOST,
        path: `/oauth2/v3/authorize/mfa/factors?${querystring.stringify({
          transaction_id
        })}`
      }, session.cookieJar)
    ).body
  ).data;
  if (typeof mfaFactors !== "object" || mfaFactors.length < 1) {
    throw new TeslaAuthException("factors unavailable");
  }
  return mfaFactors;
}

/**
 * Validate a single factor using passcode
 *
 * @export
 * @throws {TeslaAuthUnauthorized} invalid passcode
 * @throws {Error} On any other error
 * @param {Object} session - Session object from newSession()
 * @param {string} factor_id - Factor ID
 * @param {string} passcode - MFA Passcode
 * @param {string} transaction_id - Transaction ID obtained from the SSO form
 * @returns {boolean} true
 */
async function validateFactor(session, factor_id, passcode, transaction_id) {
  const verify = JSON.parse(
    (
      await request({
        method: "POST",
        host: TESLA_AUTH_HOST,
        path: `/oauth2/v3/authorize/mfa/verify`,
        headers: { "Content-Type": "application/json" }
      }, session.cookieJar, JSON.stringify({
        factor_id,
        passcode,
        transaction_id
      }))
    ).body
  );
  if (!verify.data || !verify.data.valid) {
    throw new TeslaAuthUnauthorized("invalid passcode");
  }
  return true;
}

/**
 * Validate MFA passcode to all registered MFA devices
 * 
 * @export
 * @throws {TeslaAuthUnauthorized} invalid passcode
 * @throws {Error} On any other error
 * @param {Object} session - Session object from newSession()
 * @param {string} passcode - MFA Passcode
 * @param {string} transaction_id - Transaction ID obtained from the SSO form
 * @returns {boolean} true
 */
async function validateFactors(session, passcode, transaction_id) {
  // Get a list of MFA devices registered
  const mfaFactors = await getFactors(session, transaction_id);

  // Loop through them and test the passcode
  let error;
  for (let factor of mfaFactors) {
    if (factor.factorType === "token:software") {
      try {
        await validateFactor(session, factor.id, passcode, transaction_id);
        return true;
      } catch { } // Ignore
    }
  }
  throw new TeslaAuthUnauthorized("invalid passcode");
}

/**
 * Exchange authorization code for bearer token
 *
 * @export
 * @throws {Error} On error
 * @param {string} code - Authorization code from authenticate()
 * @param {string} code_verifier - Session.codeVerifier from newSession()
 * @returns {Object} bearer token object
 */
async function bearerToken(code, code_verifier) {
  try {
    const res = await request({
      method: "POST",
      host: TESLA_AUTH_HOST,
      path: "/oauth2/v3/token",
      headers: { "Content-Type": "application/json" }
    }, undefined, JSON.stringify({
      grant_type: "authorization_code",
      client_id: "ownerapi",
      code,
      code_verifier,
      redirect_uri: "https://auth.tesla.com/void/callback"
    }));
    return JSON.parse(res.body);
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
 * @returns {Object} Returns the Tesla server token response
 */
async function refreshToken(refresh_token) {
  const res = await request({
    method: "POST",
    host: TESLA_AUTH_HOST,
    path: `/oauth2/v3/token`,
    headers: { "Content-Type": "application/json" }
  }, undefined, JSON.stringify({
    grant_type: "refresh_token",
    scope: "openid email offline_access",
    client_id: "ownerapi",
    refresh_token: refresh_token
  }));
  return JSON.parse(res.body);
}

/**
 * Exchange an authentication access_token for a owner-api access_token
 *
 * @param {string} bearerToken - bearerToken.access_token collected from bearerToken()
 * @returns {Object} Returns the Tesla server token response
 */
async function ownerapiToken(bearerToken) {
  const res = await request({
    method: "POST",
    host: TESLA_API_HOST,
    path: `/oauth/token`,
    headers: {
      "Authorization": `Bearer ${bearerToken}`,
      "Content-Type": "application/json"
    }
  }, undefined, JSON.stringify({
    "grant_type": "urn:ietf:params:oauth:grant-type:jwt-bearer",
    "client_id": TESLA_API_CLIENT_ID,
    "client_secret": TESLA_API_CLIENT_SECRET
  }));
  return JSON.parse(res.body);
}

module.exports = {
  TeslaAuthException,
  TeslaAuthIncorrectRegion,
  TeslaAuthIncorrectCaptcha,
  TeslaAuthUnauthorized,
  TeslaAuthMFARequired,
  newSession,
  getCaptcha,
  authenticate,
  getFactors,
  validateFactor,
  validateFactors,
  bearerToken,
  refreshToken,
  ownerapiToken
};