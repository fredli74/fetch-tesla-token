/**
 * @file proxy function designed to work with AWS and Netlify lambda functions
 * @author Fredrik Lidström
 * @copyright 2019-2022 Fredrik Lidström
 * @license MIT (MIT)
*/

const { TRACE } = process.env;
const teslaAuth = require("../teslaAuth");

/**
 * Eschange authentication redirect URL with bearer and Owner API tokens
 * 
 * @param {Object} event - { body: { url:string, codeVerifier:string, state:string } }
 * @param {Object} context - ignored
 * @returns {Object} Response { bearer:Object, owner_api:Object|undefined }
*/
exports.handler = async function (event, context) {
  if (TRACE) console.log(`TRACE token(${JSON.stringify(event)}, ${JSON.stringify(context)}) called`);
  try {
    const input = event.body && JSON.parse(event.body);

    // Decode the SSO redirect url
    const decoded = teslaAuth.decodeCallbackURL(input.url);
    if (decoded.state && decoded.state !== input.state) {
      throw new Error("Incorrect authentication response. State in requestion and authorization response do not match. Please retry.");
    }
    const response = {
      bearer: await teslaAuth.bearerToken(decoded.code, input.codeVerifier, decoded.issuer)
    };

    try {
      response.owner_api = await teslaAuth.ownerapiToken(response.bearer.access_token);
    } catch (e) {
      ; // Accept accounts without owner-api access
    }

    // Return a mix of bearer and api access tokens
    return {
      statusCode: 200,
      body: JSON.stringify(response)
    };

  } catch (err) {
    console.log(`ERROR ${err.message}`);
    console.log(`TRACE ${JSON.stringify(err)}`);

    return {
      statusCode: 500,
      headers: {
        "X-Error": err.message
      },
      body: err.message
    }
  }
}