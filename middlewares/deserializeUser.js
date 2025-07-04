const AppError = require("../utils/appError");
// const redisClient = require('../utils/connectRedis');
const { verifyJwt } = require("../utils/jwt");

const User = require("../models/user");

const deserializeUser = async (req, res, next) => {
  try {
    // Get the token
    let access_token;
    if (
      req.headers.authorization &&
      req.headers.authorization.startsWith("Bearer")
    ) {
      access_token = req.headers.authorization.split(" ")[1];
    } else if (req.cookies.access_token) {
      access_token = req.cookies.access_token;
    }

    if (!access_token) {
      return next(new AppError("You are not logged in", 401));
    }

    // Validate Access Token
    const decoded = verifyJwt(
      access_token,
      process.env.ACCESS_TOKEN_PUBLIC_KEY,
    );
    console.log("Decoded Token:", decoded);

    if (!decoded) {
      return next(new AppError(`Invalid token or user doesn't exist`, 401));
    }

    // Check if user has a valid session
    // const session = await redisClient.get(decoded.sub);

    // if (!session) {
    //   return next(new AppError(`User session has expired`, 401));
    // }

    // Check if user still exists
    // const user = await findUserById(JSON.parse(session)._id);
    let userID = decoded.sub;

    const user = await User.findById(userID);

    if (!user) {
      return next(new AppError(`User with that token no longer exists`, 401));
    }

    // This is really important (Helps us know if the user is logged in from other controllers)
    req.user = user; // added by Abdullah

    res.locals.user = user;

    next();
  } catch (err) {
    console.log("Error:", err);
    next(err);
  }
};
module.exports = deserializeUser;
