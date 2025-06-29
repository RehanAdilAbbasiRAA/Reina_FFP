const jwt = require("jsonwebtoken");
const bcrypt = require("bcryptjs");
const User = require("../models/user");
const Discount = require("../models/Discount");
const {
  registerOtherUsersSchema,
} = require("../joiValidationSchemas/validationSchemas");
const otpGenerator = require("otp-generator");
const {
  signToken,
  accessTokenCookieOptions,
  refreshTokenCookieOptions,
} = require("../utils/tokenHandler");
const sendEmail = require("../utils/sendEmail");
const { authenticator } = require("otplib");
const qrcode = require("qrcode");
const { fetchAuthToken } = require("./mt5Credentials");
const {
  trackUserLocation,
  getClientIp,
} = require("../models/UserLoginLocation");
const discount = require("./discount");
async function generateUniqueOtp() {
  let otp;
  let isAlready;

  do {
    // Generate a new OTP
    otp = otpGenerator.generate(6, {
      upperCaseAlphabets: false,
      specialChars: false,
    });

    isAlready = await User.findOne({ resetPasswordOtp: otp });
  } while (isAlready);

  return otp; // Return the unique OTP
}

const registerUser = async (req, res, next) => {
  try {
    // Validate the request body
    const { error } = registerOtherUsersSchema.validate(req.body, {
      abortEarly: false,
    });

    if (error) {
      return res.status(400).json({
        success: false,
        message: "Validation error",
        details: error.details.map(err => err.message),
      });
    }

    const {
      email,
      firstName,
      lastName,
      userName,
      password,
      fullAddress,
      phoneNum,
      referralId, // Add this to your request schema
    } = req.body;

    // Check if a user already exists with the given email
    const user = await User.findOne({
      $or: [{ email }, { userName }],
    });

    if (user) {
      return res.status(409).json({
        success: false,
        message: "User already exists with this email or username.",
      });
    }

    // Handle referral logic
    let referringUser = null;
    if (referralId) {
      referringUser = await User.findById(referralId);
      if (!referringUser) {
        return res.status(400).json({
          success: false,
          message: "Invalid referral link",
        });
      }
    }

    const otp = await generateUniqueOtp();

    // Create a new user with referral information
    const newUser = new User({
      email,
      firstName,
      lastName,
      userName,
      password,
      fullAddress,
      phoneNum,
      registrationOtp: otp,
      isVerified: false,
      twofaEnabled: false,
      isReferredUser: !!referralId,
      affiliateDetails: referralId
        ? {
          affiliateUserId: referralId,
          isAffiliate: false,
        }
        : undefined,
    });

    // Update referring user's affiliate status if they're not already an affiliate
    if (referringUser) {
      if (!referringUser.affiliateDetails.isAffiliate) {
        await User.findByIdAndUpdate(referringUser._id, {
          "affiliateDetails.isAffiliate": true,
          referralCode: {
            name: `${referringUser.firstName}'s Referral`,
            percentageOff: process.env.DEFAULT_REFERRAL_DISCOUNT || 10,
            explanation: "Referral discount",
            expiration_date: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000), // 1 year from now
            couponCode: referringUser.userName,
          },
        });
      }
      let referralCount = await User.countDocuments({
        'affiliateDetails.affiliateUserId': referralId,
      });
      referralCount++;
      const referringUserUpt = await User.findById(referralId);
      if (referralCount >= 500) {
        referringUserUpt.commissionTiers = {
          tier1: 0.25,
          tier2: referringUserUpt.commissionTiers?.tier2 ?? 0.05,
          tier3: referringUserUpt.commissionTiers?.tier3 ?? 0.03,
          tier4: referringUserUpt.commissionTiers?.tier4 ?? 0.02,
        }
      } else if (referralCount >= 200) {
        referringUserUpt.commissionTiers = {
          tier1: 0.20,
          tier2: referringUserUpt.commissionTiers?.tier2 ?? 0.05,
          tier3: referringUserUpt.commissionTiers?.tier3 ?? 0.03,
          tier4: referringUserUpt.commissionTiers?.tier4 ?? 0.02,
        }
      } else if (referralCount >= 50) {
        referringUserUpt.commissionTiers = {
          tier1: 0.15,
          tier2: referringUserUpt.commissionTiers?.tier2 ?? 0.05,
          tier3: referringUserUpt.commissionTiers?.tier3 ?? 0.03,
          tier4: referringUserUpt.commissionTiers?.tier4 ?? 0.02,
        }
      } else {
        referringUserUpt.commissionTiers = {
          tier1: 0.10,
          tier2: referringUserUpt.commissionTiers?.tier2 ?? 0.05,
          tier3: referringUserUpt.commissionTiers?.tier3 ?? 0.03,
          tier4: referringUserUpt.commissionTiers?.tier4 ?? 0.02,
        }
      }
      await referringUserUpt.save();
    }
    newUser.affiliationLink = `${process.env.FRONTEND_BASE_URL
      }/auth/sign-up?ref=${encodeURIComponent(newUser._id)}`;
    const returnUser = {
      id: newUser._id,
      name: `${newUser.firstName} ${newUser.lastName}`,
      email: newUser.email,
      affiliationLink: newUser.affiliationLink,
    };

    // Generate the affiliationLink using the saved user's _id
    newUser.affiliationLink = `${process.env.FRONTEND_BASE_URL
      }/auth/sign-up?ref=${encodeURIComponent(newUser._id)}`;
    try {
      let otpEmailData = {
        to: req.body.email,
        subject: "OTP for Registration",
        htmlFile: "Registration-OTP.html",
        dynamicData: {
          otp: otp,
          firstname: newUser.firstName,
        },
      };
      await sendEmail(otpEmailData);
    } catch (error) {
      console.error("Error in sending email: ", error);
    }
    const discount = new Discount({
      name: `${newUser.firstName}'s Referral Coupon`,
      percentageOff: 10,
      description: `This is ${newUser.firstName}'s referral coupon code which provides 10% off on any purchase.`,
      expiration_date: new Date(
        new Date().setFullYear(new Date().getFullYear() + 10),
      ), // 10 years from now
      couponCode: newUser.userName,
      userId: newUser._id,
    });
    await discount.save();
    // Save the user again to persist the affiliationLink
    await newUser.save();
    return res.status(200).json({
      success: true,
      message: "Registration successful.",
      user: returnUser,
    });
  } catch (error) {
    console.error("Registration error:", error);
    return res.status(500).json({
      success: false,
      message: "Internal server error",
      error: error.message,
    });
  }
};

const checkAndMarkSameIpLogins = async (userId, ipAddress) => {
  try {
    // Fetch user by ID
    const user = await User.findById(userId);
    if (!user) {
      console.log("User not found");
      return;
    }

    user.lastLoginIp = ipAddress;
    await user.save();

    // Find all users using this IP
    const usersWithSameIp = await User.find({ lastLoginIp: ipAddress });

    // If more than 1 user shares this IP, mark them
    const isSameIp = usersWithSameIp.length > 1;

    await User.updateMany(
      { lastLoginIp: ipAddress },
      { $set: { isSameIpLogin: isSameIp } },
    );
  } catch (error) {
    console.error("Error in checkAndMarkSameIpLogins:", error);
  }
};

const loginHandler = async (req, res, next) => {
  try {
    const user = await User.findOne({ email: req.body.email });

    if (!user || user.isDeleted) {
      return res.status(404).json({
        message:
          "User not found or has been deleted. Contact support if you believe your account exists.",
      });
    }

    // Restricting on the basis of role: if it meant to login manager user's only
    console.log(user);

    if (!user.manager && req.body?.manager)
      return res.status(403).json({
        success: false,
        message: "Only managers are allowed to login",
        user: null,
      });

    // Check if user exists and password is correct
    if (!user || !(await user.comparePasswords(req.body.password))) {
      return res.status(401).json({
        success: false,
        message: "Invalid email or password",
        user: null,
      });
    }

    const clientIp = getClientIp(req);
    console.log("clientIp: ", clientIp);
    await checkAndMarkSameIpLogins(user._id, clientIp);

    // if (!user.isVerified) {
    //   if (!user.registrationOtp) {
    //     const otp = otpGenerator.generate(6, {
    //       upperCaseAlphabets: false,
    //       specialChars: false,
    //     });

    //     (user.registrationOtp = otp),
    //       (user.regOtpCreatedAt = new Date()),
    //       await user.save();

    //     let emailData = {
    //       to: req.body.email,
    //       subject: "Future Funded REGISTRATION OTP",
    //       isTemp: true,
    //       template: "resend_otp",
    //       dynamic_template_data: {
    //         otp: otp,
    //         firstName: user.firstName,
    //       },
    //     };

    //     const emailSent = await sendEmail(emailData);
    //   }
    //   return res.status(200).json({
    //     success: true,
    //     message: "Check your Email for Verification Otp",
    //     isVerified: false,
    //   });
    // }

    if (user.manager) {
      if (user.twofaEnabled)
        return res.status(200).json({
          success: true,
          message: "Plese Verify 2fa Authentication",
          userId: user._id,
          email: user.email,
          twofaVerified: user.twofaVerified,
          twofaEnabled: user.twofaEnabled,
        });

      const { accessToken, refreshToken } = await signToken(user);

      // Send Access Token in Cookie
      res.cookie("access_token", accessToken, accessTokenCookieOptions);
      res.cookie("refresh_token", refreshToken, refreshTokenCookieOptions);
      res.cookie("logged_in", true, {
        ...accessTokenCookieOptions,
        httpOnly: false,
      });
      user.loginCount += 1;
      const returnUser = {
        id: user._id,
        firstName: user.firstName,
        lastName: user.lastName,
        profilePic: user.profilePic,
        email: user.email,
        username: user.userName,
        address: user.address,
        phoneNum: user.phoneNum,
        country: user.country,
        state: user.state,
        city: user.city,
        zipCode: user.zipCode,
        twofaVerified: user.twofaVerified,
        referredUsersCount: user.referredUsersCount,
        ...(user.referralLink && { referralLink: user.referralLink }),
        access_token: accessToken,
        tradeLockerUserId: user.tradeLockerUserId || null,
        matchTraderUserId: user.matchTraderAccountDetails?.uuid || null,
        mt5Token: "",
        twofaEnabled: user.twofaEnabled,
        userLevel: user.userLevel,
      };

      return res.status(200).json({
        success: true,
        message: "Logged In Successfully",
        userId: returnUser.id,
        user: returnUser,
        twofaVerified: user.twofaVerified,
      });
      if (user.twofaEnabled && !user.twofaVerified)
        return res.status(200).json({
          success: true,
          message: "Please Enter OTP from your Google Authenticator App",
          userId: returnUser.id,
          twofaVerified: user.twofaVerified,
        });
      else {
        return res.status(200).json({
          success: true,
          message: "Logged In Successfully",
          user: returnUser,
        });
      }
    } else if (user.twofaVerified) {
      return res.json({
        success: true,
        message: "Please Enter OTP from your Google Authenticator App",
        twofaVerified: true,
      });
    } else {
      const { accessToken, refreshToken } = await signToken(user);

      // Send Access Token in Cookie
      res.cookie("access_token", accessToken, accessTokenCookieOptions);
      res.cookie("refresh_token", refreshToken, refreshTokenCookieOptions);
      res.cookie("logged_in", true, {
        ...accessTokenCookieOptions,
        httpOnly: false,
      });
      user.loginCount += 1;
      await user.save();
      let coupon;

      if (!user.couponId) {
        coupon = await discount.createCouponForUser(user._id);
      }
      await trackUserLocation(user._id, req);

      const returnUser = {
        id: user._id,
        firstName: user.firstName,
        lastName: user.lastName,
        userName: user.userName,
        email: user.email,
        isVeriffVerified: user.isVeriffVerified,
        couponId: user.couponId || coupon.coupon,
        referralCode: user.referralCode.couponCode,
        manager: user.manager,
        hasSubmittedForm: user.hasSubmittedForm,
        loginCount: user.loginCount,
        isSignatureApproved: user.isSignatureApproved,
        affiliationLink: `${process.env.FRONTEND_BASE_URL
          }/auth/sign-up?ref=${encodeURIComponent(user._id)}`,
        // ...(user.referralLink && { referralLink: user.referralLink }),
        ...(user.profilePic && { profilePic: user.profilePic }),
        // referredUsersCount: user.referredUsersCount,
        access_token: accessToken,
      };
      return res.status(200).json({
        message: "Logged in Successfully!",
        twofaVerified: user.twofaVerified,
        user: returnUser,
        isVeriffVerified: user.isVeriffVerified,
        access_token: accessToken,
      });
    }
  } catch (err) {
    next(err);
  }
};
const verifyRegOTP = async (req, res) => {
  try {
    const registrationOtp = req.body.registrationOtp;
    if (!registrationOtp) {
      res.status(404).json({
        success: false,
        message: "No Otp Found",
        message: err.details[0].message,
      });
    }
    //Finding user with the reset OTP
    User.findOne({ registrationOtp: registrationOtp }).then(async user => {
      //If User don't exist with the given registrationOtp, give error
      if (!user) {
        return res.status(404).json({
          success: false,
          message: "Invalid OTP",
        });
      } else {
        //If User exists with the given registrationOtp then send success
        user.isVerified = true;

        try {
          let emailData = {
            to: user.email,
            subject: "Welcome to Our Team |  The Pride Funding",
            htmlFile: "welcome___signup.html",
            dynamicData: {
              firstname: user.firstName,
              login: user.email,
              password: user.originalPassword,
            },
          };
          user.originalPassword = null;
          await user.save();
          await sendEmail(emailData);
        } catch (error) {
          console.error("Error in sending email: ", error);
        }
        user.save();
        return res.status(200).json({
          success: true,
          message: "OTP Verified.",
        });
      }
    });
  } catch (err) {
    console.log(err);
    if (err.isJoi) {
      res.status(422).json({
        success: false,
        message: err.details[0].message,
      });
    } else {
      res.status(500).json({
        success: false,
        message: "Internal Server Error",
      });
    }
  }
};

const resendOTP = async (req, res) => {
  try {
    const { email, otpType } = req.body;
    const user = await User.findOne({ email: email });
    if (!user) {
      return res.status(401).json({
        message: "User with this email not found!",
        success: false,
      });
    }
    if (otpType === "registration") {
      const otp = await generateUniqueOtp();
      user.registrationOtp = otp;

      try {
        let otpEmailData = {
          to: req.body.email,
          subject: "OTP for Registration",
          htmlFile: "Registration-OTP.html",
          dynamicData: {
            otp: otp,
            firstname: user.firstName,
          },
        };
        await sendEmail(otpEmailData);
      } catch (error) {
        console.error("Error in sending email: ", error);
      }
      user.save();
      return res.status(200).json({
        success: true,
        message: "Reg otp send successfully.",
      });
    } else {
      const otp = await generateUniqueOtp();
      user.resetPasswordOtp = otp;

      try {
        let otpEmailData = {
          to: req.body.email,
          subject: "Reset Password OTP",
          htmlFile: "Reset-Password-OTP.html",
          dynamicData: {
            otp: otp,
            firstname: user.firstName,
          },
        };
        await sendEmail(otpEmailData);
      } catch (error) {
        console.error("Error in sending email: ", error);
      }
      user.save();
      return res.status(200).json({
        success: true,
        message: "forgot password otp send successfully.",
      });
    }
  } catch (error) {
    console.log(err);
    if (err.isJoi) {
      res.status(422).json({
        success: false,
        message: err.details[0].message,
      });
    } else {
      res.status(500).json({
        success: false,
        message: "Internal Server Error",
      });
    }
  }
};

const forgetPasswordHandler = async (req, res, next) => {
  try {
    const { email } = req.body;

    if (email) {
      const user = await User.findOne({ email: email });
      if (!user) {
        return res.status(404).json({
          success: false,
          message: "User not found with this Email!",
        });
      }

      const otp = await generateUniqueOtp();
      try {
        let emailData = {
          to: req.body.email,
          subject: "RESET PASSWORD",
          htmlFile: "Reset-Password-OTP.html",
          dynamicData: {
            otp: otp,
            firstname: user.firstName,
          },
        };
        await sendEmail(emailData);
      } catch (error) {
        console.error("Error in sending email: ", error);
      }

      user.resetPasswordOtp = otp;
      await user.save();

      return res.status(200).json({
        success: true,
        message: "Forget Password email sent",
      });
    } else {
      return res.status(400).json({
        success: false,
        message: "Email is required!",
      });
    }
  } catch (err) {
    console.log("ERROR", err);
    return res.status(500).json({
      success: false,
      message: "Internal Server Error",
    });
  }
};

const payoutOtpSendHandler = async (req, res, next) => {
  try {
    const userId = req.user._id;
    const user = await User.findOne({ _id: userId });
    if (!user) {
      return res.status(404).json({
        success: false,
        message: "User not found with this Email!",
      });
    }
    const otp = await generateUniqueOtp();
    try {
      let emailData = {
        to: user.email,
        subject: "Payout OTP VERIFICATION",
        htmlFile: "Payout-OTP.html",
        dynamicData: {
          otp: otp,
          firstname: user.firstName,
        },
      };
      await sendEmail(emailData);
    } catch (error) {
      console.error("Error in sending email: ", error);
      return res.status(500).json({
        success: false,
        message: "Internal Server Error While Sending Email",
      });
    }

    user.payoutOtp = otp;
    await user.save();

    return res.status(200).json({
      success: true,
      message: "payout otp email sent.",
    });
  } catch (err) {
    console.log("ERROR", err);
    return res.status(500).json({
      success: false,
      message: "Internal Server Error",
    });
  }
};


const verifyPayoutOTP = async (req, res) => {
  try {
    const { otp } = req.body;
    if (!otp) {
      return res.status(400).json({ message: "OTP is required" });
    }
    // Fetch user from DB
    const user = await User.findById(req.user._id);
    if (!user) {
      return res.status(400).json({ message: "User not found" });
    }

    // Ensure payoutOtp has been generated
    if (!user.payoutOtp) {
      return res.status(400).json({
        message: "Payout Otp has not been generated for this user.",
      });
    }

    if (user.payoutOtp !== otp) {
      return res.status(400).json({
        message: "OTP verification failed: Invalid OTP",
      });
    }else {
      // Clear the payoutOtp after successful verification
      user.payoutOtp = null;
      await user.save();
    }
    return res.json({
      success: true,
      message: "Payout OTP verification successful",
    });
  } catch (error) {
    console.error(" Error in verifying payout OTP:", error);
    res
      .status(500)
      .json({ message: "Internal server error", error: error.message });
  }
};

const verifyOTP = async (req, res) => {
  try {
    // Fetch user from DB
    const user = await User.findOne({ _id: req.body.userId });
    if (!user) {
      return res.status(400).json({ message: "User not found" });
    }

    // Ensure 2FA is enabled
    if (!user.twofaSecret) {
      return res.status(400).json({
        message: "Two-factor authentication is not set up for this user.",
      });
    }

    // Trim and verify OTP
    const token = req.body.token.replaceAll(" ", "");
    if (!authenticator.check(token, user.twofaSecret)) {
      return res.status(400).json({
        message: "OTP verification failed: Invalid token",
      });
    }

    // Update user verification status
    user.twofaVerified = true;
    user.isVerified = true;
    await user.save();

    // Generate tokens
    const { accessToken, refreshToken } = await signToken(user);
    // const mt5Token = await fetchAuthToken();

    // Set cookies
    res.cookie("access_token", accessToken, accessTokenCookieOptions);
    res.cookie("refresh_token", refreshToken, refreshTokenCookieOptions);
    res.cookie("logged_in", true, {
      ...accessTokenCookieOptions,
      httpOnly: false,
    });

    // Format user response
    const returnUser = {
      id: user._id,
      firstName: user.firstName,
      lastName: user.lastName,
      profilePic: user.profilePic,
      email: user.email,
      username: user.userName,
      address: user.address,
      phoneNum: user.phoneNum,
      country: user.country,
      state: user.state,
      city: user.city,
      zipCode: user.zipCode,
      twofaVerified: user.twofaVerified,
      referredUsersCount: user.referredUsersCount,
      ...(user.referralLink && { referralLink: user.referralLink }),
      access_token: accessToken,
      // mt5Token,
      twofaEnabled: user.twofaEnabled,
      role: user.userLevel,
      userLevel: user.userLevel,
    };

    return res.json({
      message: "OTP verification successful",
      twofaVerified: user.twofaVerified,
      user: returnUser,
    });
  } catch (error) {
    console.error(" Error in verifyOTP:", error);
    res
      .status(500)
      .json({ message: "Internal server error", error: error.message });
  }
};

const verifyForgotPasswordOTP = async (req, res) => {
  if (!req.body.otp) {
    return res.status(400).json({ success: false, message: "otp not found" });
  }
  const user = await User.findOne({ resetPasswordOtp: req.body.otp });
  if (!user) {
    return res
      .status(400)
      .json({ success: false, message: "User not found or invalid otp" });
  }
  return res.status(200).json({
    success: true,
    message: "OTP verification successful",
  });
};

const resetPasswordHandler = async (req, res, next) => {
  try {
    const { otp, newPassword } = req.body;

    const user = User.findOne({ resetPasswordOtp: otp });
    if (!user) {
      return res.status(404).json({
        success: false,
        message: "Invalid Otp",
      });
    }
    let encryptedPassword = await bcrypt.hash(newPassword, 10);

    const updatePassword = await User.updateOne(
      { resetPasswordOtp: req.body.otp },
      {
        $set: {
          resetPasswordOtp: null,
          password: encryptedPassword,
        },
      },
    );

    if (updatePassword?.modifiedCount > 0)
      return res.status(200).json({
        success: true,
        message: "Password Updated Successfullly",
      });
    else
      return res.status(401).json({
        success: false,
        message: "Otp not valid try again ",
      });
  } catch (err) {
    console.log("ERROR", err);
    return res.status(500).json({
      success: false,
      message: "Internal Server Error",
    });
  }
};

const generate2faSecret = async (req, res) => {
  const userId = req.user._id;
  try {
    const user = await User.findById({ _id: userId });
    // if (user.twofaVerified) {
    //   return res.status(400).json({
    //     message: "2FA already verified and enabled",
    //     twofaVerified: user.twofaVerified,
    //   });
    // }

    const secret = authenticator.generateSecret();
    user.twofaSecret = secret;
    user.save();
    const appName = "Future Funded";

    return res.json({
      message: "2FA secret generation successful",
      secret: secret,
      qrImageDataUrl: await qrcode.toDataURL(
        authenticator.keyuri(user.email, appName, secret),
      ),
      twofaVerified: user.twofaVerified,
    });
  } catch (error) {
    console.log("ERR", error);

    return res.status(500).json({
      message: "Error Ocurred while creating 2FA Secret",
      error: error.message,
    });
  }
};

const webhook = async (req, res) => {
  try {
    const { category, tradingAccount } = req.body;

    // Early exit for non-category 0
    if (category !== 0) {
      return res.status(200).json({
        success: true,
        message: `Category ${category} ignored. No action required.`,
      });
    }

    // Validate tradingAccount
    if (
      !tradingAccount ||
      !tradingAccount.id ||
      tradingAccount.status === undefined
    ) {
      return res.status(400).json({
        success: false,
        message: "Invalid webhook payload for category 0.",
      });
    }

    // Extract relevant fields
    const { id: accountId, status, reason } = tradingAccount;

    // Map status values to logic
    const statusMapping = {
      4: {
        newStatus: "BREACHED",
        defaultReason: "Max Intraday DD Reached",
      },
      2: {
        newStatus: "FUNDED",
        defaultReason: "Account Funded Successfully",
      },
    };

    // Determine if status is supported
    const statusConfig = statusMapping[status];
    if (!statusConfig) {
      return res.status(200).json({
        success: true,
        message: `Status ${status} not applicable. No action taken.`,
      });
    }

    // Update the trading account using your helper function
    const updateResult = await updateTradingAccount(
      accountId,
      statusConfig.newStatus,
      reason || statusConfig.defaultReason,
    );

    if (!updateResult.success) {
      return res.status(417).json(updateResult); // Handle failure case
    }

    // Respond with success
    return res.status(200).json({
      success: true,
      message: updateResult.message || "Account updated successfully.",
    });
  } catch (error) {
    console.error("Webhook processing error:", error.message);
    return res.status(500).json({
      success: false,
      message: "Internal server error during webhook processing.",
      error: error.message,
    });
  }
};

const changePasswordHandler = async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body;
    const userId = req.body.userId || req.user._id;

    // Validate input
    if (!currentPassword || !newPassword) {
      return res.status(400).json({
        success: false,
        message: "Current and new passwords are required.",
      });
    }

    // Fetch user from the database
    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({
        success: false,
        message: "User not found.",
      });
    }

    // Verify the current password
    const isMatch = await bcrypt.compare(currentPassword, user.password);
    if (!isMatch) {
      return res.status(401).json({
        success: false,
        message: "Current password is incorrect.",
      });
    }

    // Check if the new password matches the old password
    const isSameAsOld = await bcrypt.compare(newPassword, user.password);
    if (isSameAsOld) {
      return res.status(400).json({
        success: false,
        message: "New password cannot be the same as the current password.",
      });
    }

    // password is hashed from user model before saving
    user.password = newPassword;
    await user.save();

    return res.status(200).json({
      success: true,
      message: "Password updated successfully.",
    });
  } catch (err) {
    console.error("Error changing password:", err);
    return res.status(500).json({
      success: false,
      message: "Internal Server Error.",
    });
  }
};

const logout = async (req, res, next) => {
  console.log("LOG OUT CALLED");
  // req.logout();
  req.session.destroy(err => {
    if (err) {
      console.log(err);
    }
    req.user = null; // clear the user object from the request object
    // return res.status(200).json({msg:"LOGGED OUT"});
    return res.redirect("http://localhost:3000/");
  });
};

const resetTwoFaAuth = async (req, res) => {
  try {
    const { email } = req.body;

    const user = await User.findOne({ email });
    if (!user) {
      return res.status(404).json({
        success: false,
        message: "User not found.",
      });
    }

    user.twofaVerified = false;
    user.twofaSecret = "";
    await user.save();

    return res.status(200).json({
      success: true,
      message: "Two-factor authentication reset successfully.",
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: "An error occurred while resetting two-factor authentication.",
      error: error.message,
    });
  }
};
const disableTwoFAForManager = async (req, res, next) => {
  try {
    const validUser = req.user;
    if (!validUser) {
      return res.status(404).json({
        message: "User not found or has been deleted.",
      });
    }
    const updatedUser = await User.findByIdAndUpdate(
      { _id: req.user._id },
      {
        twofaEnabled: false,
        twofaSecret: null,
        twofaVerified: false,
      },
      { new: true },
    );
    const returnUser = {
      id: updatedUser._id,
      firstName: updatedUser.firstName,
      lastName: updatedUser.lastName,
      userName: updatedUser.userName,
      email: updatedUser.email,
      isVeriffVerified: updatedUser.isVeriffVerified,
      couponId: updatedUser.couponId || coupon.coupon,
      referralCode: updatedUser.referralCode.couponCode,
      manager: updatedUser.manager,
      hasSubmittedForm: updatedUser.hasSubmittedForm,
      loginCount: updatedUser.loginCount,
      isSignatureApproved: updatedUser.isSignatureApproved,
      twofaEnabled: updatedUser.twofaEnabled,
      affiliationLink: `${process.env.FRONTEND_BASE_URL
        }/auth/sign-up?ref=${encodeURIComponent(updatedUser._id)}`,
      ...(updatedUser.profilePic && { profilePic: updatedUser.profilePic }),
      role: updatedUser.role,
      userLevel: updatedUser.userLevel,
    };
    return res.status(200).json({
      message: "Disable 2fa successfully!",
      user: returnUser,
    });
  } catch (err) {
    next(err);
  }
};

const verifyAuthenticatorOtp = async (req, res) => {
  try {
    const { userId } = req.body;
    const user = await User.findOne({ _id: userId }).populate({
      path: "couponId",
      select: "_id couponCode",
    });

    const token = req.body.token.replaceAll(" ", "");
    if (!authenticator.check(token, user.twofaSecret)) {
      return res.status(400).json({
        message: "OTP verification failed: Invalid token",
        twofaVerified: user.twofaVerified,
        isVeriffVerified: user.isVeriffVerified,
      });
    } else {
      user.loginCount += 1;
      await trackUserLocation(user._id, req);
      try {
        const formSubmissionExists = await FormSubmission.findOne({
          userId: user._id,
        });

        if (user.loginCount <= 7 && !formSubmissionExists) {
          user.hasSubmittedForm = true; // Form should be shown
        } else {
          user.hasSubmittedForm = false; // Form should not be shown
        }
      } catch (formError) {
        console.error("Error checking form submission:", formError.message);
        // If there's an error, default `hasSubmittedForm` to false to avoid issues
        user.hasSubmittedForm = false;
      }

      user.twofaVerified = true;
      if (!user.twofaEnabled) {
        user.twofaEnabled = true;
      }
      user.isVerified = true;
      user.save();

      const { accessToken, refreshToken } = await signToken(user);

      // Send Access Token in Cookie
      res.cookie("access_token", accessToken, accessTokenCookieOptions);
      res.cookie("refresh_token", refreshToken, refreshTokenCookieOptions);
      res.cookie("logged_in", true, {
        ...accessTokenCookieOptions,
        httpOnly: false,
      });

      let coupon;

      if (!user.couponId) {
        coupon = await discount.createCouponForUser(user._id);
      }

      const returnUser = {
        id: user._id,
        firstName: user.firstName,
        lastName: user.lastName,
        userName: user.userName,
        email: user.email,
        isVeriffVerified: user.isVeriffVerified,
        couponId: user.couponId || coupon.coupon,
        referralCode: user.referralCode.couponCode,
        manager: user.manager,
        hasSubmittedForm: user.hasSubmittedForm,
        loginCount: user.loginCount,
        isSignatureApproved: user.isSignatureApproved,
        twofaEnabled: user.twofaEnabled,
        affiliationLink: `${process.env.FRONTEND_BASE_URL
          }/auth/sign-up?ref=${encodeURIComponent(user._id)}`,
        ...(user.profilePic && { profilePic: user.profilePic }),
        access_token: accessToken,
        role: user.role,
        userLevel: user.userLevel,
      };

      return res.status(200).json({
        message: "OTP verification successful",
        twofaVerified: user.twofaVerified,
        user: returnUser,
        isVeriffVerified: user.isVeriffVerified,
      });
    }
  } catch (error) {
    console.log("ERR", error);
    return res.status(500).json({
      message: "OTP verification Failed",
      // error:error.message
    });
  }
};

const getManagers = async (req, res) => {
  try {
    let { search, page, limit } = req.query;
    page = parseInt(page) > 0 ? parseInt(page) : 1;
    limit = parseInt(limit) > 0 ? parseInt(limit) : 10;

    const skip = (parseInt(page) - 1) * parseInt(limit);

    const matchCondition = search
      ? {
        $or: [
          { firstName: { $regex: search, $options: "i" } },
          { lastName: { $regex: search, $options: "i" } },
          { email: { $regex: search, $options: "i" } },
        ],
        manager: true,
      }
      : { manager: true };

    const users = await User.find(matchCondition)
      .skip(skip)
      .limit(parseInt(limit));

    const totalCount = await User.countDocuments(matchCondition);

    return res.status(200).json({
      success: true,
      message: "Fetched successfully",
      users: users || [],
      page,
      limit,
      totalPages: Math.ceil(totalCount / parseInt(limit)),
      totalCount,
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: "Internal server error",
    });
  }
};
const getAllManagers = async (req, res) => {
  try {
    const matchCondition = {
      manager: true,
    };

    const users = await User.find(matchCondition);

    return res.status(200).json({
      success: true,
      message: "Fetched all managers successfully",
      users: users || [],
      totalCount: users.length,
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: "Internal server error",
    });
  }
};


const addManager = async (req, res, next) => {
  try {
    const {
      email,
      firstName,
      lastName,
      userName,
      password,
      userLevel = "User",
      manager = false,
    } = req.body;

    // Check if a user already exists with the given email
    const user = await User.findOne({ email });
    if (user) {
      return res.status(409).json({
        success: false,
        message: "User already exists with this email.",
      });
    }

    // Create a new user
    const newUser = new User({
      email,
      firstName,
      lastName,
      userName,
      password,
      isVerified: true,
      twofaEnabled: false,
      userLevel,
      manager,
    });

    await newUser.save();

    const returnUser = {
      id: newUser?._id,
      name: `${newUser?.firstName} ${newUser?.lastName}`,
      email: newUser?.email,
    };

    let emailData = {
      to: req.body.email,
      isTemp: true,
      subject: "Welcome to Our Team | Pride Funding Credentials",
      html: `<p>You are added as a ${userLevel} in The Pride FUNDING MANAGER</p>`,
      dynamicData: {
        email: req.body.email,
        password: req.body.password,
      },
    };

    const emailSent = await sendEmail(emailData);

    return res.status(200).json({
      success: true,
      message: "Registration successful.",
      user: returnUser,
    });
  } catch (error) {
    console.log(error);
    return res
      .status(500)
      .json({ success: false, message: "internal server error" });
  }
};

const updateRoleManager = async (req, res, next) => {
  try {
    const { userId, userLevel } = req.body;

    const user = await User.findById(userId);
    if (!user) {
      return res.status(409).json({
        success: false,
        message: "User does not exists.",
      });
    }

    user.userLevel = userLevel;

    await user.save();

    const returnUser = {
      id: user?._id,
      name: `${user?.firstName} ${user?.lastName}`,
      email: user?.email,
    };

    return res.status(200).json({
      success: true,
      message: "Role update successful.",
      user: returnUser,
    });
  } catch (error) {
    console.log(error);
    return res
      .status(500)
      .json({ success: false, message: "internal server error" });
  }
};

const managerUserLogin = async (req, res, next) => {
  try {
    const user = await User.findOne({ email: req.body.email });

    if (!user || user.isDeleted) {
      return res.status(404).json({
        message:
          "User not found or has been deleted. Contact support if you believe your account exists.",
      });
    }

    const { accessToken, refreshToken } = await signToken(user);

    // Send Access Token in Cookie
    res.cookie("access_token", accessToken, accessTokenCookieOptions);
    res.cookie("refresh_token", refreshToken, refreshTokenCookieOptions);
    res.cookie("logged_in", true, {
      ...accessTokenCookieOptions,
      httpOnly: false,
    });

    await user.save();
    let coupon;

    if (!user.couponId) {
      coupon = await discount.createCouponForUser(user._id);
    }

    const returnUser = {
      id: user._id,
      firstName: user.firstName,
      lastName: user.lastName,
      userName: user.userName,
      email: user.email,
      isVeriffVerified: user.isVeriffVerified,
      couponId: user.couponId || coupon.coupon,
      referralCode: user.referralCode.couponCode,
      manager: user.manager,
      hasSubmittedForm: user.hasSubmittedForm,
      loginCount: user.loginCount,
      isSignatureApproved: user.isSignatureApproved,
      affiliationLink: `${process.env.FRONTEND_BASE_URL
        }/auth/sign-up?ref=${encodeURIComponent(user._id)}`,
      // ...(user.referralLink && { referralLink: user.referralLink }),
      ...(user.profilePic && { profilePic: user.profilePic }),
      // referredUsersCount: user.referredUsersCount,
      access_token: accessToken,
    };
    return res.status(200).json({
      message: "Logged in Successfully!",
      twofaVerified: user.twofaVerified,
      user: returnUser,
      isVeriffVerified: user.isVeriffVerified,
      access_token: accessToken,
    });
  } catch (err) {
    next(err);
  }
};

// Separate API to check if the login count is a multiple of 8
const isMultipleOf8 = (req, res) => {
  const user = req.user;
  if (!user || !user.loginCount) {
    return res
      .status(404)
      .json({ success: false, message: "user's login count not found!" });
  }

  const isMultipleOf8 = user?.loginCount % 8 === 0;

  return res.json({
    attemptNumber: loginAttempts,
    isMultipleOf8,
  });
};

module.exports = {
  registerUser,
  verifyRegOTP,
  loginHandler,
  generate2faSecret,
  verifyOTP,
  forgetPasswordHandler,
  resetPasswordHandler,
  logout,
  webhook,
  changePasswordHandler,
  resetTwoFaAuth,
  resendOTP,
  disableTwoFAForManager,
  verifyAuthenticatorOtp,
  getManagers,
  addManager,
  updateRoleManager,
  managerUserLogin,
  verifyForgotPasswordOTP,
  isMultipleOf8,
  payoutOtpSendHandler,
  verifyPayoutOTP,
  getAllManagers
};
