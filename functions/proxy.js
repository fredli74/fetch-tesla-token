const https = require("https");
const crypto = require("crypto");
const querystring = require("querystring");

const TESLA_AUTH_HOST = `auth.tesla.com`;
const TESLA_AUTH_PATH = `/oauth2/v3`;

const TESLA_API_HOST = `owner-api.teslamotors.com`;
const TESLA_API_CLIENT_ID = `81527cff06843c8634fdc09e8ac0abefb46ac849f38fe1e431c2ef2106796384`;
const TESLA_API_CLIENT_SECRET = `c7257eb71a564034f9419ee651c7d0e5f7aa6bfbd18bafb5c5c033b093bb2fa3`;

/*
  simple base64 to base64url converter
*/
function bufferBase64url(buffer) {
  return buffer.toString("base64").replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=/g, '');
}
/*
  Promisified https.request
*/
function request(opt, data) {
  opt.headers = opt.headers || {};
  opt.headers["User-Agent"] = "TeslaAPI-proxy/2.0 (Node.js)";
  opt.headers["Accept"] = "application/json, text/plain, */*";
  if (data !== undefined) {
    opt.headers["Content-Length"] = Buffer.byteLength(data);
  }

  return new Promise((resolve, reject) => {
    const req = https.request(opt, (res) => {
      let body = "";
      res.setEncoding("utf8");
      res.on("error", (e) => reject(e));
      res.on("data", chunk => (body += chunk));
      res.on("end", () => {
        resolve({
          statusCode: res.statusCode || 200,
          headers: res.headers,
          body: body
        });
      });
    });
    req.on("error", (e) => reject(e));
    if (data) {
      req.write(data);
    }
    req.end();
  });
}

/*
  proxy provided as a function to work with AWS and Netlify lambda functions
*/
exports.handler = async function (event, context) {
  try {
    const inputData = event.body && JSON.parse(event.body);

    // Generate a verifier ID and its hash
    const state = bufferBase64url(crypto.randomBytes(16));
    const codeVerifier = bufferBase64url(crypto.randomBytes(64));
    const hash = crypto.createHash("sha256").update(codeVerifier).digest("hex");
    const codeChallenge = bufferBase64url(Buffer.from(hash));

    // Set the authorize URL path
    const authPath = `${TESLA_AUTH_PATH}/authorize?${querystring.stringify({
      client_id: "ownerapi",
      code_challenge: codeChallenge,
      code_challenge_method: "S256",
      redirect_uri: "https://auth.tesla.com/void/callback",
      response_type: "code",
      scope: "openid email offline_access",
      state: state
    })}`;

    // Obtain the login page
    const loginForm = {};
    let cookies;
    {
      const res = await request({
        method: "GET",
        host: TESLA_AUTH_HOST,
        path: authPath
      });
      if (res.statusCode !== 200) {
        throw "Unable to fetch Tesla SSO login page";
      }

      // Super simple stupid cookie handling, just mirroring what was sent to us
      if (res.headers["set-cookie"]) {
        cookies = res.headers["set-cookie"].map(c => c.match(/[^;]+/)[0]).join("; ")
      }

      // Scrape the login page
      const form = res.body.match(/<form.+?id=\"form\".+?>(.+?)<\/form>/s);
      if (form.length < 2) {
        throw "Unable to find login form on Tesla SSO login page";
      }
      for (input of form[1].matchAll(/<input.+?name=\"([^"]+)\".+?\>/g)) {
        const value = input[0].match(/value=\"([^"]+)\"/);
        loginForm[input[1]] = value && value[1] || "";
      }
      if (loginForm.identity === undefined || loginForm.credential === undefined) {
        throw "Unable to parse login form on Tesla SSO login page";
      }
    }
    loginForm.identity = inputData.email;
    loginForm.credential = inputData.password;

    // Post login form
    let redirectURL = undefined;
    {
      const res = await request({
        method: "POST",
        host: TESLA_AUTH_HOST,
        path: authPath,
        headers: {
          "Cookie": cookies,
          "Content-Type": "application/x-www-form-urlencoded"
        }
      }, querystring.stringify(loginForm));
      if (res.statusCode === 200 && res.body.match(/authorize\/mfa\/verify/)) {
        if (inputData.mfa) {
          // IMPLEMENT 2FA          
        } else {
          throw "Your account has Multi-Factor Authentication enabled";
        }
      } else if (res.statusCode === 302) {
        redirectURL = res.headers.location;
      } else {
        console.debug("Login form failed");
        console.debug(res);
        return res;
      }
    }

    if (!redirectURL) {
      throw "should not happen!";
    }

    // Verify redirect
    const redirectQuery = querystring.parse(redirectURL.split("?")[1]);
    if (redirectQuery.state !== state) {
      throw "Invalid state returned by Tesla SSO login page";
    }

    // Exchange authorization code for bearer token
    let bearerToken;
    {
      const res = await request({
        method: "POST",
        host: TESLA_AUTH_HOST,
        path: `${TESLA_AUTH_PATH}/token`,
        headers: { "Content-Type": "application/json" }
      }, JSON.stringify({
        grant_type: 'authorization_code',
        client_id: 'ownerapi',
        code: redirectQuery.code,
        code_verifier: codeVerifier,
        redirect_uri: 'https://auth.tesla.com/void/callback'
      }));
      if (res.statusCode === 200) {
        bearerToken = JSON.parse(res.body);
      } else {
        console.debug("Error fetching login token");
        console.debug(res);
        return res;
      }
    }

    // Exchange bearer token for access token
    {
      const res = await request({
        method: "POST",
        host: TESLA_API_HOST,
        path: `/oauth/token`,
        headers: {
          "Authorization": `Bearer ${bearerToken.access_token}`,
          "Content-Type": "application/json"
        }
      }, JSON.stringify({
        "grant_type": "urn:ietf:params:oauth:grant-type:jwt-bearer",
        "client_id": TESLA_API_CLIENT_ID,
        "client_secret": TESLA_API_CLIENT_SECRET
      }));
      if (res.statusCode === 200) {
        // Return a mix of bearer and api access tokens
        return {
          statusCode: res.statusCode,
          headers: res.headers,
          body: JSON.stringify({
            auth: bearerToken,
            owner_api: JSON.parse(res.body)
          })
        };
      } else {
        console.debug("Error fetching API token");
        console.debug(res);
        return res;
      }
    }
  } catch (err) {
    console.error(err);
    return {
      statusCode: 500,
      headers: {
        "X-Error": err
      },
      body: err
    }
  }
}