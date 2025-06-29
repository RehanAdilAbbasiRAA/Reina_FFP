const jwt = require("jsonwebtoken");

// Access Token Cookie Options
const accessTokenCookieOptions = {
  expires: new Date(Date.now() + process.env.ACCESS_TOKEN_TIME * 60 * 1000),
  maxAge: process.env.ACCESS_TOKEN_TIME * 60 * 1000,
  httpOnly: true,
  sameSite: "lax",
};

// Refresh Token Cookie Options
const refreshTokenCookieOptions = {
  expires: new Date(Date.now() + process.env.REFRESH_TOKEN_TIME * 60 * 1000),
  maxAge: process.env.REFRESH_TOKEN_TIME * 60 * 1000,
  httpOnly: true,
  sameSite: "lax",
};

const signToken = async user => {
  // Sign the access token
  const accessToken = jwt.sign(
    { sub: user._id },
    process.env.ACCESS_TOKEN_PRIVATE_KEY, // Replace with your environment variable
    { expiresIn: `${process.env.ACCESS_TOKEN_TIME}m` },
  );

  // Sign the refresh token
  const refreshToken = jwt.sign(
    { sub: user._id },
    process.env.REFRESH_TOKEN_PRIVATE_KEY, // Replace with your environment variable
    { expiresIn: `${process.env.REFRESH_TOKEN_TIME}m` },
  );

  // Create a Session (Redis implementation is commented out here, you can uncomment and configure it)
  // redisClient.set(user._id, JSON.stringify(user), 'EX', 60 * 60);

  // Return access token
  return { accessToken, refreshToken };
};

module.exports = {
  signToken,
  accessTokenCookieOptions,
  refreshTokenCookieOptions,
};
