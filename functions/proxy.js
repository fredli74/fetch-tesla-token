/**
 * @file proxy provided as a function to work with AWS and Netlify lambda functions
 * @author Fredrik Lidström
 * @copyright 2021 Fredrik Lidström
 * @license MIT (MIT)
*/

const teslaAuth = require("../teslaAuth");

/*
  
*/
exports.handler = async function (event, context) {
  try {
    const inputData = event.body && JSON.parse(event.body);

    // Sign in
    const bearerToken = await teslaAuth.authenticate(inputData.email, inputData.password, inputData.mfa);

    // Collect the token
    const ownerToken = await teslaAuth.ownerapiToken(bearerToken.access_token);

    // Return a mix of bearer and api access tokens
    return {
      statusCode: 200,
      body: JSON.stringify({
        auth: bearerToken,
        owner_api: ownerToken
      })
    };

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