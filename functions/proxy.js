const https = require("https");

const TESLA_AUTH_HOST = `owner-api.teslamotors.com`;
const TESLA_AUTH_PATH = `/oauth/token?grant_type=password`;
const TESLA_CLIENT_ID = `81527cff06843c8634fdc09e8ac0abefb46ac849f38fe1e431c2ef2106796384`;
const TESLA_CLIENT_SECRET = `c7257eb71a564034f9419ee651c7d0e5f7aa6bfbd18bafb5c5c033b093bb2fa3`;

/*
  proxy provided as a function to work with AWS and Netlify lambda functions
*/
exports.handler = function(event, context, callback) {
  try {
    const inputData = event.body && JSON.parse(event.body);

    const postData = JSON.stringify({
      grant_type: "password",
      client_id: TESLA_CLIENT_ID,
      client_secret: TESLA_CLIENT_SECRET,
      email: inputData.email,
      password: inputData.password
    });

    const options = {
      method: "POST",
      protocol: "https:",
      host: TESLA_AUTH_HOST,
      path: TESLA_AUTH_PATH,
      headers: {
        Accept: "application/json",
        "User-Agent": "TeslaAPI-proxy/1.0 (Node.js)",
        "Content-Type": "application/json",
        "Content-Length": Buffer.byteLength(postData)
      }
    };

    let responseBody = "";
    const proxyRequest = https.request(options, proxyResponse => {
      proxyResponse.on("error", err => callback(err));
      proxyResponse.on("data", chunk => (responseBody += chunk));
      proxyResponse.on("end", () => {
        callback(null, {
          statusCode: proxyResponse.statusCode,
          headers: proxyResponse.headers,
          body: responseBody
        });
      });
    });
    proxyRequest.write(postData);
    proxyRequest.end();
  } catch (err) {
    callback(err);
  }
}