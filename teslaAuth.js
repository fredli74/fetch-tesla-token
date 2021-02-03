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
 * @throws {*}
 * @param {Object} opt - Options to pass to https.request
 * @param {Object|unedfined} cookieJar - Object to send and store cookies
 * @param {(string|NodeJS.ArrayBufferView|ArrayBuffer|SharedArrayBuffer|undefined)} data - Data
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
      res.setEncoding("utf8");
      res.on("error", (e) => reject(e));
      res.on("data", chunk => (body += chunk));
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
 * Authenticate with Tesla OAuth 2.0 authentication server (v3)
 *
 * @export
 * @throws On any encountered error
 * @param {string} identity - Tesla account email address
 * @param {string} credential - Tesla account password
 * @param {string|undefined} passcode - Multi-Factor Authentication passcode (optional)
 * @returns {Object} Returns the Tesla server token response
 */
async function authenticate(identity, credential, passcode) {

  // Generate a verifier ID and its hash
  const state = bufferBase64url(crypto.randomBytes(16));
  const codeVerifier = bufferBase64url(crypto.randomBytes(64));
  const hash = crypto.createHash("sha256").update(codeVerifier).digest("hex");
  const codeChallenge = bufferBase64url(Buffer.from(hash));


  // Set the authorize URL path
  const authPath = `/oauth2/v3/authorize?${querystring.stringify({
    client_id: "ownerapi",
    code_challenge: codeChallenge,
    code_challenge_method: "S256",
    redirect_uri: "https://auth.tesla.com/void/callback",
    response_type: "code",
    scope: "openid email offline_access",
    state: state
  })}`;

  // CookieJar for the session
  const cookieJar = {};

  // Obtain and scrape the sign in page
  const htmlForm = {};
  try {
    const res = await request({ method: "GET", host: TESLA_AUTH_HOST, path: authPath }, cookieJar);
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


  // Add credentials to sign in form
  htmlForm.identity = identity;
  htmlForm.credential = credential;


  // Post sign in form
  let redirectURL = undefined;
  try {
    let res = await request({
      method: "POST",
      host: TESLA_AUTH_HOST,
      path: authPath,
      headers: { "Content-Type": "application/x-www-form-urlencoded" }
    }, cookieJar, querystring.stringify(htmlForm));
    if (res.statusCode === 200 && res.body.match(/authorize\/mfa\/verify/)) {

      // Account has MFA enabled
      if (!passcode) {
        throw new TeslaAuthMFARequired("Multi-Factor Authentication required");
      } else {
        let valid = false;
        try {

          // Get a list of MFA devices registered
          const mfaFactors = JSON.parse((await request({
            method: "GET",
            host: TESLA_AUTH_HOST,
            path: `/oauth2/v3/authorize/mfa/factors?${querystring.stringify({
              transaction_id: htmlForm.transaction_id
            })}`,
          }, cookieJar)).body).data;
          if (typeof mfaFactors !== "object" || mfaFactors.length < 1) {
            throw new TeslaAuthException("factors unavailable");
          }

          // Test all devices
          for (let factor of mfaFactors) {
            if (!valid && factor.factorType === "token:software") {
              try {
                const verify = JSON.parse(
                  (
                    await request({
                      method: "POST",
                      host: TESLA_AUTH_HOST,
                      path: "/oauth2/v3/authorize/mfa/verify",
                      headers: { "Content-Type": "application/json" }
                    }, cookieJar, JSON.stringify({
                      factor_id: factor.id,
                      passcode: passcode,
                      transaction_id: htmlForm.transaction_id
                    }))
                  ).body
                );
                if (verify.data && verify.data.valid) {
                  valid = true;
                }
              } catch { } // Ignore
            }
          }
        } catch (e) {
          throw new TeslaAuthException(`Unexpected MFA error (${e})`);
        }

        if (!valid) {
          throw new TeslaAuthUnauthorized("Invalid passcode");
        }

        // MFA was validated, repost the login page with only the transaction_id
        res = await request({
          method: "POST",
          host: TESLA_AUTH_HOST,
          path: authPath,
          headers: { "Content-Type": "application/x-www-form-urlencoded" }
        }, cookieJar, querystring.stringify({ transaction_id: htmlForm.transaction_id }));
      }
    }

    if (res.statusCode === 302) {
      // When sign in is successful we recieve a redirect to the redirect_uri
      redirectURL = res.headers.location;
    } else {
      throw new TeslaAuthUnauthorized("Unknown");
    }
  } catch (err) {
    err.message = "Tesla sign in page error - " + err.message;
    throw err;
  }


  // Verify redirect
  const redirectQuery = querystring.parse(redirectURL.split("?")[1]);
  if (redirectQuery.state !== state) {
    throw new TeslaAuthException("Invalid state returned by Tesla server");
  }


  // Exchange authorization code for bearer token
  try {
    const res = await request({
      method: "POST",
      host: TESLA_AUTH_HOST,
      path: "/oauth2/v3/token",
      headers: { "Content-Type": "application/json" }
    }, undefined, JSON.stringify({
      grant_type: "authorization_code",
      client_id: "ownerapi",
      code: redirectQuery.code,
      code_verifier: codeVerifier,
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
 * @param {string} bearerToken - access_token part of the authentication token (v3)
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
  TeslaAuthUnauthorized,
  TeslaAuthMFARequired,
  authenticate,
  refreshToken,
  ownerapiToken
};