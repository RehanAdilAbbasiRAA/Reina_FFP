const jwt = require('jsonwebtoken');
// const config = require('config');

const signJwt = (payload, key, options = {}) => {
  const privateKey = process.env.ACCESS_TOEKN_PRIVATE_KEY.toString('ascii');
  return jwt.sign(payload, privateKey, {
    ...(options && options),
    algorithm: 'RS256',
  });
};

const verifyJwt = (token, key) => {
  try {
    const publicKey = process.env.ACCESS_TOKEN_PRIVATE_KEY;
    return jwt.verify(token, publicKey);
  } catch (error) {
    return null;
  }
};

module.exports = {
  signJwt,
  verifyJwt,
};
