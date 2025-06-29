const jwt = require("jsonwebtoken");

isAuth = (req, res, next) => {
  if (!req.session.passport) {
    return res.redirect("/auth/login");
  }
  const tooken = req.session.passport.user.token;
  const authHeader = `Bearer ${tooken}`;
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return res.redirect("/auth/login");
  }

  const token = authHeader.split(" ")[1];

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    const { userid, email } = decoded;
    req.user = { userid, email };
    req.session.isAuth = true;
    // next();
  } catch (error) {
    console.log(error);
    return res.redirect("/auth/login");
  }

  next();
};
module.exports = isAuth;

