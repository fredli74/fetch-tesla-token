/**
 * @file proxy function designed to work with AWS and Netlify lambda functions
 * @author Fredrik Lidström
 * @copyright 2021 Fredrik Lidström
 * @license MIT (MIT)
*/

const teslaAuth = require("../teslaAuth");

/**
 * Authenticate and fetch tokens
 * 
 * @param {Object} event - { body: { session, form } }
 * @param {Object} context - ignored
 * @returns {Object} Response "token" or "mfa" list of factors
*/
exports.handler = async function (event, context) {
  try {
    const input = event.body && JSON.parse(event.body);

    try {
      // Sign in
      const authCode = await teslaAuth.authenticate(input.session, input.form);

      // Exchange authorization code for bearer token
      const bearerToken = await teslaAuth.bearerToken(authCode, input.session.codeVerifier);

      // Collect the token
      const ownerToken = await teslaAuth.ownerapiToken(bearerToken.access_token);

      // Return a mix of bearer and api access tokens
      return {
        statusCode: 200,
        body: JSON.stringify({
          reponse: "token",
          auth: bearerToken,
          owner_api: ownerToken
        })
      };

    } catch (e) {
      if (e instanceof teslaAuth.TeslaAuthMFARequired) {
        // MFA required, get a list for factors
        const mfaFactors = await teslaAuth.getFactors(input.session, input.form.transaction_id);
        return {
          statusCode: 200,
          body: JSON.stringify({
            response: "mfa",
            mfaFactors
          })
        };

      } else {
        throw (e);
      }
    }

  } catch (err) {
    console.error(err);
    return {
      statusCode: 500,
      headers: {
        "X-Error": err.message
      },
      body: err.message
    }
  }
}