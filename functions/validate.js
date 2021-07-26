/**
 * @file proxy function designed to work with AWS and Netlify lambda functions
 * @author Fredrik Lidström
 * @copyright 2021 Fredrik Lidström
 * @license MIT (MIT)
*/

const teslaAuth = require("../teslaAuth");

/**
 * Validate with an MFA device passcode
 *
 * @param {Object} event - { body: { session, factor_id, passcode, transaction_id } }
 * @param {Object} context - ignored
 * @returns {Object} Response "validated"
*/
exports.handler = async function (event, context) {
  try {
    const input = event.body && JSON.parse(event.body);

    // Validate factor
    await teslaAuth.validateFactor(input.session, input.factor_id,
      input.passcode, input.transaction_id);

    // Return a mix of bearer and api access tokens
    return {
      statusCode: 200,
      body: JSON.stringify({
        reponse: "validated",
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