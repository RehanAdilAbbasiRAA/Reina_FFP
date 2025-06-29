const jwt = require("jsonwebtoken");
const bcrypt = require("bcryptjs");
const User = require("../models/user");
const UserReferral = require("../models/UserReferral");
const Discount = require("../models/Discount");
const PaymentPlan = require("../models/paymentPlans");
const UserPlan = require("../models/userPlan");
const CouponDiscount = require("../models/Discount");
const MT5Credential = require("../models/MT5Credentials");
const FormSubmission = require("../models/formSubmission");
const CryptoCharge = require("../models/cryptoCharge");
const PayoutDetails = require("../models/payoutDetail");
const Payment = require("../models/Payment");
const Withdrawal = require("../models/Withdrawal");
const mongoose = require("mongoose");
const axios = require("axios");

const {
  signToken,
  accessTokenCookieOptions,
  refreshTokenCookieOptions,
} = require("../utils/tokenHandler");
const sendEmail = require("../utils/sendEmail");

const uploadToS3 = require("../utils/s3Uploader");
const Email = require("../models/Email");
const { UserLocation } = require("../models/UserLoginLocation");
// Used
const uploadProfilePicture = async (req, res) => {
  console.log("uploadProfilePicture: ");
  try {
    const userId = req.body.userId || req.user?._id;
    if (!userId) {
      return res.status(400).json({ error: "User ID is required" });
    }
    if (!req.files || !req.files.file) {
      return res.status(400).json({ error: "No file uploaded" });
    }

    const file = req.files.file;
    // Generate a unique file name using userId and timestamp
    const originalName = file.name;
    const fileExtension = originalName.split(".").pop(); // Extract file extension
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-"); // Replace invalid filename characters
    const uniqueFileName = `${userId}-${timestamp}.${fileExtension}`; // Combine userId and timestamp

    // Use the file buffer directly
    const fileUrl = await uploadToS3(file.data, uniqueFileName);

    const user = await User.findByIdAndUpdate(
      userId,
      { profilePic: fileUrl },
      { new: true }, // Return the updated user document
    );

    if (!user) {
      return res.status(404).json({ error: "User not found" });
    }

    res.status(200).json({
      message: "File uploaded successfully",
      fileUrl,
      user,
    });
  } catch (err) {
    console.error("Error in uploadProfilePicture controller:", err.message);
    res.status(500).json({ error: "Failed to upload file" });
  }
};

const getProfile = async (req, res) => {
  try {
    const userID = req.query.userId || req.user;
    const user = await User.findById(userID).select(
      "-password -resetPasswordOtp",
    );
    // Check if the user was successfully updated
    if (!user) {
      return res.status(404).json({
        success: false,
        message: "User not found or your token expired.",
      });
    }

    return res.status(200).json({
      success: true,
      message: "Profile Fetched Successfully",
      user,
    });
  } catch (error) {
    console.error("Error updating profile:", error);
    return res.status(500).json({
      success: false,
      message: "Internal server error",
      error: error.message,
    });
  }
};

const getUserByEmail = async (req, res) => {
  try {
    const { email } = req.query;

    const user = await User.findOne({
      email,
    }).select("-password -resetPasswordOtp");

    if (!user) {
      return res.status(404).json({
        success: false,
        message: "User with this email does not exist.",
      });
    }

    return res.status(200).json({
      success: true,
      message: "User data fetched",
      user,
    });
  } catch (error) {
    console.error("Error fetching user profile:", error);
    return res.status(500).json({
      success: false,
      message: "Internal server error",
      error: error.message,
    });
  }
};

const updateProfile = async (req, res) => {
  try {
    const updateData = req.body;

    if (!updateData || Object.keys(updateData).length === 0) {
      return res.status(400).json({
        success: false,
        message: "No fields provided for update",
      });
    }

    const userID = req.user._id;

    const updatedUser = await User.findByIdAndUpdate(
      userID,
      { $set: updateData },
      { new: true, runValidators: true },
    );

    if (!updatedUser) {
      return res.status(404).json({
        success: false,
        message: "User not found",
      });
    }

    return res.status(200).json({
      success: true,
      message: "Profile updated successfully",
      user: updatedUser,
    });
  } catch (error) {
    console.error("Error updating profile:", error);
    return res.status(500).json({
      success: false,
      message: "Internal server error",
      error: error.message,
    });
  }
};

const getReferralLink = async (req, res) => {
  try {
    let userID = req.user?._id;

    if (!userID) {
      return res.status(401).json({
        success: false,
        message: "You are not authorized",
      });
    }
    const user = await User.findById(userID);
    const affiliationLink = user.affiliationLink;
    return res.status(200).json({
      success: true,
      message: "Successfully fetched affiliation link",
      affiliationLink: affiliationLink,
    });
  } catch (error) {
    console.error("Error creating Link:", error);
    return res.status(500).json({
      success: false,
      message: "Internal server error",
      error: error.message,
    });
  }
};
//Not Used
const updateProfilePayment = async (req, res) => {
  try {
    const { updateObject } = req.body;

    if (!updateObject || Object.keys(updateObject).length === 0) {
      return res.status(400).json({
        success: false,
        message: "No fields provided for update",
      });
    }

    const userID = req.user._id;

    // Update the user document with the fields in updateObject
    const updatedUser = await User.findByIdAndUpdate(
      userID,
      { $set: updateObject },
      { new: true, runValidators: true },
    );

    // Check if the user was successfully updated
    if (!updatedUser) {
      return res.status(404).json({
        success: false,
        message: "User not found",
      });
    }

    return res.status(200).json({
      success: true,
      message: "Profile Payment updated successfully",
      user: updatedUser,
    });
  } catch (error) {
    console.error("Error updating profile:", error);
    return res.status(500).json({
      success: false,
      message: "Internal server error",
      error: error.message,
    });
  }
};

const blackListUser = async (req, res, next) => {
  try {
    const { userId, status, note, isSendEmail } = req.query;
    console.log("---------------------------Note: ", note);

    // First update - store the result
    let updatedUser = await User.findByIdAndUpdate(
      userId, // Remove the object wrapper, just pass userId
      { isDeleted: status },
      { new: true },
    );

    if (!updatedUser) {
      return res.status(404).json({
        success: false,
        message: "User not found",
      });
    }

    // If note exists, update the user's notes
    if (note && note.trim() !== "") {
      updatedUser = await User.findByIdAndUpdate(
        userId,
        {
          $push: { notes: { note } },
        },
        { new: true },
      );
    }
    console.log("---------------------------UPDATED USER:");
    console.log(updatedUser);
    console.log("------------------------------------------");

    // Handle email sending
    if (isSendEmail === "true") {
      try {
        const emailData = {
          to: updatedUser.email,
          isTemp: false,
          subject: `Pride Funding Account ${status ? "BlackListed" : "Activated"}`,
          html: `<p>Your account has been ${status ? "BlackListed" : "Activated"} from FUTURE FUNDED</p>
          ${note ? `<p>Manager Note: ${note}</p>` : ""}`,
          dynamic_template_data: {
            firstName: updatedUser.firstName,
            rejectionMessage: note,
          },
        };
        await sendEmail(emailData);
      } catch (error) {
        console.error(`Error sending email for user ${userId}:`, error.message);
        // Continue execution even if email fails
      }
    }

    // Send response with lean/sanitized user object
    const userResponse = updatedUser.toObject
      ? updatedUser.toObject()
      : updatedUser;

    res.status(200).json({
      success: true,
      data: userResponse,
    });
  } catch (error) {
    console.error("Error in blackListUser:", error);
    res.status(500).json({
      success: false,
      message: "Internal server error",
    });
  }
};

const getLast30DaysVisits = async referrerID => {
  try {
    const referralEntry = await UserReferral.findOne({ referrerID });

    if (!referralEntry) {
      return 0;
    }

    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    const last30DaysVisits = referralEntry.visits.filter(
      visit => visit.visitDate >= thirtyDaysAgo,
    );

    return last30DaysVisits.length;

    // return res.status(200).json({
    //   success: true,
    //   visitCount: last30DaysVisits.length,
    //   visits: last30DaysVisits,
    // });
  } catch (error) {
    console.error("Error getting last 30 days visits:", error);
    return 0;
    // return res.status(500).json({ message: 'Internal server error' });
  }
};

const getLast30DaysSignups = async referrerID => {
  try {
    const referralEntry = await UserReferral.findOne({ referrerID });

    if (!referralEntry) {
      return 0;
    }

    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    const last30DaysSignups = referralEntry.signups.filter(
      signup => signup.signupDate >= thirtyDaysAgo,
    );

    return last30DaysSignups.length;

    // return res.status(200).json({
    //   success: true,
    //   signupCount: last30DaysSignups.length,
    //   signups: last30DaysSignups,
    // });
  } catch (error) {
    console.error("Error getting last 30 days signups:", error);
    // return res.status(500).json({ message: 'Internal server error' });
    return 0;
  }
};

const getAllCustomersWithPlans = async (req, res) => {
  try {
    const { firstName, page = 1, limit = 10 } = req.query;
    const skip = (parseInt(page) - 1) * parseInt(limit);

    const usersWithPlans = await User.find({
      activePlans: { $exists: true, $not: { $size: 0 } },
    }).populate("activePlans");

    const totalCount = await User.countDocuments({
      activePlans: { $exists: true, $not: { $size: 0 } },
    });

    return res.status(200).json({
      success: true,
      message: "Fetched successfully",
      users: usersWithPlans || [],
      page: parseInt(page),
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

const resetPasswordHandler = async (req, res) => {
  try {
    const { userId, newPassword } = req.body;
    const user = await User.findOne({ _id: userId });
    if (!user) {
      return res.status(404).json({
        success: false,
        message: "No User found",
      });
    }

    try {
      let emailData = {
        to: user.email,
        subject: "New PASSWORD",
        htmlFile: "New-Password.html",
        dynamicData: {
          firstname: user.firstName,
          newPassword: newPassword,
        },
      };
      await sendEmail(emailData);
    } catch (error) {
      console.error("Error in sending email: ", error);
    }
    let encryptedPassword = await bcrypt.hash(newPassword, 10);

    const updatePassword = await User.updateOne(
      { _id: userId },
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
        message: "Unable to update password ",
      });
  } catch (err) {
    console.log("ERROR", err);
    return res.status(500).json({
      success: false,
      message: "Internal Server Error",
    });
  }
};

const getAllCustomers = async (req, res) => {
  try {
    const {
      search,
      page = 1,
      limit = 10,
      blackListed = false,
      withPlans,
      fields,
    } = req.query;

    const skip = (parseInt(page) - 1) * parseInt(limit);
    let query = {};

    // Search functionality
    if (search) {
      query.$or = [
        { firstName: { $regex: search, $options: "i" } },
        { lastName: { $regex: search, $options: "i" } },
        { email: { $regex: search, $options: "i" } },
      ];
    }

    // Filter blacklisted users
    if (blackListed === "true") {
      query.isDeleted = true;
    }

    // Filter users with plans
    if (withPlans === "true") {
      query.hasActivePlan = true;
    }

    // Field selection
    const projection = {};
    if (fields) {
      fields.split(",").forEach(field => {
        projection[field.trim()] = 1;
      });
    } else {
      // Default fields if none specified
      Object.assign(projection, {
        firstName: 1,
        lastName: 1,
        email: 1,
        country: 1,
        created_at: 1,
        payoutsEnabled: 1,
        isDeleted: 1,
        hasActivePlan: 1,
      });
    }

    const users = await User.find(query)
      .select(projection)
      .skip(skip)
      .limit(parseInt(limit))
      .lean(); // Using lean() for better performance

    const totalCount = await User.countDocuments(query);

    // Ensure payoutsEnabled exists for each user
    const usersWithPayoutStatus = users.map(user => ({
      ...user,
      payoutsEnabled:
        user.payoutsEnabled !== undefined ? user.payoutsEnabled : false,
    }));

    return res.status(200).json({
      success: true,
      message: "Fetched successfully",
      users: usersWithPayoutStatus,
      page: parseInt(page),
      totalPages: Math.ceil(totalCount / parseInt(limit)),
      totalCount,
    });
  } catch (error) {
    console.error("Error fetching customers:", error);
    return res.status(500).json({
      success: false,
      message: "Internal server error",
      error: error.message,
    });
  }
};

const getAllCustomersforExport = async (req, res) => {
  try {
    const { search, blackListed = false, withPlans, fields } = req.query;

    let query = {};

    // Search functionality
    if (search) {
      query.$or = [
        { firstName: { $regex: search, $options: "i" } },
        { lastName: { $regex: search, $options: "i" } },
        { email: { $regex: search, $options: "i" } },
      ];
    }

    // Filter blacklisted users
    if (blackListed === "true") {
      query.isDeleted = true;
    }

    // Filter users with plans
    if (withPlans === "true") {
      query.hasActivePlan = true;
    }

    // Field selection
    const projection = {};
    if (fields) {
      fields.split(",").forEach(field => {
        projection[field.trim()] = 1;
      });
    } else {
      Object.assign(projection, {
        firstName: 1,
        lastName: 1,
        email: 1,
        country: 1,
        created_at: 1,
        payoutsEnabled: 1,
        isDeleted: 1,
        hasActivePlan: 1,
      });
    }

    const users = await User.find(query).select(projection).lean(); // Removed .skip and .limit

    const totalCount = users.length;

    const usersWithPayoutStatus = users.map(user => ({
      ...user,
      payoutsEnabled:
        user.payoutsEnabled !== undefined ? user.payoutsEnabled : false,
    }));

    return res.status(200).json({
      success: true,
      message: "Fetched successfully",
      users: usersWithPayoutStatus,
      totalCount,
    });
  } catch (error) {
    console.error("Error fetching customers:", error);
    return res.status(500).json({
      success: false,
      message: "Internal server error",
      error: error.message,
    });
  }
};

const getAllAffiliateUsers = async (req, res, next) => {
  try {
    const { page = 1, limit = 10, search = "", hasLeader = "all" } = req.query;
    const skip = (parseInt(page) - 1) * parseInt(limit);

    const searchFilter = search
      ? {
          $or: [
            { firstName: { $regex: search, $options: "i" } },
            { lastName: { $regex: search, $options: "i" } },
            { email: { $regex: search, $options: "i" } },
          ],
        }
      : {};

    const aggregationPipeline = [
      {
        $lookup: {
          from: "affiliationdetails",
          localField: "_id",
          foreignField: "userId",
          as: "affiliations",
        },
      },
      {
        $graphLookup: {
          from: "affiliationdetails",
          startWith: "$_id",
          connectFromField: "userId",
          connectToField: "fromUserId",
          as: "referralTree",
          maxDepth: 4,
        },
      },
      {
        $addFields: {
          referralCount: { $size: "$referralTree" },
        },
      },
      { $match: searchFilter },
    ];

    console.log(hasLeader);
    console.log(typeof hasLeader);
    if (hasLeader == "true") {
      console.log(hasLeader);
      aggregationPipeline.unshift({
        $match: { "affiliateDetails.affiliateUserId": { $ne: null } },
      });
    } else if (hasLeader == "false") {
      aggregationPipeline.unshift({
        $match: { "affiliateDetails.affiliateUserId": null },
      });
    }
    console.log(aggregationPipeline);

    // Get the total count of users after applying the aggregation pipeline
    const totalUsers = await User.aggregate([
      ...aggregationPipeline,
      { $count: "totalUsers" },
    ]).then(result => (result.length > 0 ? result[0].totalUsers : 0));

    // Paginate the results
    const affiliateUsers = await User.aggregate([
      ...aggregationPipeline,
      { $skip: skip },
      { $limit: parseInt(limit) },
    ]);

    res.status(200).json({
      success: true,
      data: affiliateUsers,
      pagination: {
        totalUsers,
        currentPage: parseInt(page),
        totalPages: Math.ceil(totalUsers / parseInt(limit)),
        resultsPerPage: parseInt(limit),
      },
    });
  } catch (error) {
    console.error("Error fetching affiliate users:", error);
    res.status(500).json({ success: false, message: "Internal server error" });
  }
};

const dashboardLeaderboard = async (req, res) => {
  try {
    // Fixing the volumetricaTraderAccountIDs check using $where
    const users = await User.find({
      $or: [
        { matchTraderTraderAccountID: { $exists: true, $ne: null, $ne: "" } },
        { volumetricaTraderAccountIDs: { $exists: true } }, // Check if the array exists
      ],
    }).select("firstName lastName");

    if (!users.length) {
      return res.status(404).json({
        success: false,
        message: "No users found with matchTrader or volumetrica accounts",
      });
    }

    return res.status(200).json({
      success: true,
      message: "Successful operation",
      users,
    });
  } catch (error) {
    console.error("Error fetching users:", error);
    return res.status(500).json({
      success: false,
      message: "Internal server error",
      error: error.message,
    });
  }
};

// Helper function to calculate profit from the Volumetrica account data
const calculateProfit = (balance, startBalance) => {
  return startBalance - balance;
};

// API to get top 10 users by profit

const getAllVerifiedCustomers = async (req, res) => {
  try {
    const { firstName, page = 1, limit = 10 } = req.query;
    const skip = (parseInt(page) - 1) * parseInt(limit);
    const matchCondition = {
      isVerified: true,
      ...(firstName && { firstName: { $regex: new RegExp(firstName, "i") } }),
    };

    const users = await User.find(matchCondition)
      .skip(skip)
      .limit(parseInt(limit));

    const totalCount = await User.countDocuments(matchCondition);

    return res.status(200).json({
      success: true,
      message: "Fetched successfully",
      users: users || [],
      page: parseInt(page),
      totalPages: Math.ceil(totalCount / parseInt(limit)),
      totalCount,
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: "Internal server error",
      error: error.message,
    });
  }
};

const calculateDiscountedPrice = async (req, res) => {
  try {
    const { paymentPlanID, couponCode } = req.body;
    const userID = req.user._id;

    const user = await User.findById(userID).populate("payment");

    const couponCodeUsed = user.payment.some(
      single_payment => single_payment.couponCodeUsed,
    );

    if (couponCodeUsed) {
      return res.status(400).json({
        success: false,
        message: "You have already used this coupon Code",
      });
    }

    const paymentPlan = await PaymentPlan.findById(paymentPlanID);
    if (!paymentPlan) {
      return res.status(404).json({
        success: false,
        message: "Payment plan not found",
      });
    }

    // Find the user by ID
    const referralUser = await User.findOne({
      "referralCode.couponCode": couponCode,
    });

    if (referralUser) {
      const { percentageOff } = referralUser.referralCode;
      const discountedPrice = paymentPlan.price * (1 - percentageOff / 100);

      return res.status(200).json({
        success: true,
        message: "Discount applied successfully",
        data: {
          originalPrice: paymentPlan.price,
          discountedPrice,
        },
      });
    }

    const discount = await Discount.findOne({ couponCode: couponCode });
    if (!discount) {
      return res.status(404).json({
        success: false,
        message: "Coupon not found",
      });
    }

    const currentDate = new Date();
    if (discount.expiration_date && discount.expiration_date < currentDate) {
      return res.status(400).json({
        success: false,
        message: "Coupon is expired",
      });
    }

    const { percentageOff } = discount;
    const discountedPrice = paymentPlan.price * (1 - percentageOff / 100);

    return res.status(200).json({
      success: true,
      message: "Discount applied successfully",
      data: {
        originalPrice: paymentPlan.price,
        discountedPrice,
      },
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Failed to apply Coupon Code",
      error: error.message,
    });
  }
};

const getAllUsers = async (req, res) => {
  try {
    const {
      hasCertificate = null,
      isVerified = null,
      search = "",
      page = 1,
      limit = 10,
    } = req.query;

    let query = {};

    if (hasCertificate === "true") {
      query.certificates = { $exists: true, $ne: [] };
    }

    if (isVerified === "true") {
      query.isVeriffVerified = true;
    }

    if (search.trim()) {
      const searchRegex = new RegExp(search, "i");
      query.$or = [
        { firstName: searchRegex },
        { lastName: searchRegex },
        { email: searchRegex },
        { _id: { $eq: search.length === 24 ? ObjectId(search) : null } },
      ];
    }

    const skip = (parseInt(page) - 1) * parseInt(limit);

    const users = await User.find(query)
      .skip(skip)
      .limit(parseInt(limit))
      .select("-password");

    const totalUsers = await User.countDocuments(query);

    return res.status(200).json({
      success: true,
      data: users,
      pagination: {
        currentPage: parseInt(page),
        totalPages: Math.ceil(totalUsers / parseInt(limit)),
        totalUsers,
        pageSize: users.length,
      },
    });
  } catch (error) {
    console.error("Error fetching users:", error.message);

    return res.status(500).json({
      success: false,
      message: "Server error",
    });
  }
};

const getCustomers = async (req, res) => {
  try {
    const {
      page = 1,
      limit = 10,
      sort = "totalAccounts:asc",
      search = "",
    } = req.query;

    const pageNum = parseInt(page, 10);
    const limitNum = parseInt(limit, 10);

    const sortFields = sort.split(",").reduce((acc, field) => {
      const [key, order] = field.split(":");
      acc[key] = order === "desc" ? -1 : 1;
      return acc;
    }, {});

    const matchFilter = search
      ? {
          $or: [
            { firstName: { $regex: search, $options: "i" } },
            { lastName: { $regex: search, $options: "i" } },
            { _id: { $eq: search.length === 24 ? ObjectId(search) : null } },
          ],
        }
      : {};

    const customers = await User.aggregate([
      { $match: matchFilter },
      // Lookup accounts from mt5accounts collection
      {
        $lookup: {
          from: "mt5_credentials",
          localField: "_id",
          foreignField: "user_id",
          as: "mt5Accounts",
        },
      },
      // Lookup accounts from volumetrica collection
      {
        $lookup: {
          from: "volumetrica_credentials",
          localField: "_id",
          foreignField: "user_id",
          as: "volumetricaAccounts",
        },
      },
      // Merge mt5Accounts and volumetricaAccounts
      {
        $addFields: {
          accounts: { $concatArrays: ["$mt5Accounts", "$volumetricaAccounts"] },
        },
      },
      // Add totalAccounts field with the count of all accounts
      {
        $addFields: {
          totalAccounts: { $size: "$accounts" },
        },
      },
      // Filter customers with totalAccounts > 0
      {
        $match: {
          totalAccounts: { $gt: 0 },
        },
      },
      // Optionally project only required fields
      {
        $project: {
          _id: 1,
          firstName: 1,
          lastName: 1,
          totalAccounts: 1,
          accounts: 1,
        },
      },
      // Sort by multiple fields
      {
        $sort: sortFields,
      },
      // Paginate results (skip and limit)
      {
        $skip: (pageNum - 1) * limitNum,
      },
      {
        $limit: limitNum,
      },
    ]);

    // Get total count for pagination metadata

    const totalCount = await User.aggregate([
      { $match: matchFilter },
      // Lookup accounts from mt5accounts collection
      {
        $lookup: {
          from: "mt5_credentials",
          localField: "_id",
          foreignField: "user_id",
          as: "mt5Accounts",
        },
      },
      // Lookup accounts from volumetrica collection
      {
        $lookup: {
          from: "volumetrica_credentials",
          localField: "_id",
          foreignField: "user_id",
          as: "volumetricaAccounts",
        },
      },
      // Merge mt5Accounts and volumetricaAccounts
      {
        $addFields: {
          accounts: { $concatArrays: ["$mt5Accounts", "$volumetricaAccounts"] },
        },
      },
      // Add totalAccounts field with the count of all accounts
      {
        $addFields: {
          totalAccounts: { $size: "$accounts" },
        },
      },
      // Count the total number of users with at least one account
      {
        $match: {
          totalAccounts: { $gt: 0 },
        },
      },
      {
        $count: "total",
      },
    ]);

    const total = totalCount[0]?.total || 0;

    res.status(200).json({
      success: true,
      data: customers,
      meta: {
        total,
        page: pageNum,
        limit: limitNum,
        totalPages: Math.ceil(total / limitNum),
      },
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({
      success: false,
      message: "Failed to fetch customers",
      error: error.message,
    });
  }
};

const getAllUsersOrSearchByEmail = async (req, res) => {
  try {
    let { email, page, limit } = req.query;
    page = parseInt(page) > 0 ? parseInt(page) : 1;
    limit = parseInt(limit) > 0 ? parseInt(limit) : 10;

    const skip = (parseInt(page) - 1) * parseInt(limit);

    const matchCondition = email
      ? { email: { $regex: new RegExp(email, "i") } }
      : {};

    const users = await User.find(
      matchCondition,
      "userName firstName lastName email",
    )
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

const getAllPropAccounts = async (req, res, next) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;
    const skip = (page - 1) * limit;

    const { search, breached_loss_limit, group } = req.query;

    const query = {};

    if (breached_loss_limit) {
      query.breached_loss_limit = breached_loss_limit === "true";
    }

    if (group) {
      query.group = group;
    }

    const searchNumber = !isNaN(search) ? Number(search) : null;

    const searchMatch = search
      ? {
          $or: [
            {
              login:
                searchNumber !== null
                  ? searchNumber
                  : { $regex: search, $options: "i" },
            },
            { "user.email": { $regex: search, $options: "i" } },
          ],
        }
      : {};

    // Aggregation pipeline for data
    const pipeline = [
      { $match: query }, // Match initial query filters
      {
        $lookup: {
          from: "users", // Replace with your actual users collection name
          localField: "user_id",
          foreignField: "_id",
          as: "user",
        },
      },
      { $unwind: "$user" }, // Flatten the populated user field
      { $match: { ...searchMatch } }, // Apply search filter
      {
        $project: {
          "user.password": 0, // Exclude sensitive fields
        },
      },
      { $sort: { created_at: -1 } },
      { $skip: skip },
      { $limit: limit },
    ];

    const users = await MT5Credential.aggregate(pipeline);

    // Count total matching documents
    const countPipeline = [
      { $match: query }, // Match initial query filters
      {
        $lookup: {
          from: "users",
          localField: "user_id",
          foreignField: "_id",
          as: "user",
        },
      },
      { $unwind: "$user" }, // Flatten the populated user field
      { $match: { ...searchMatch } }, // Apply search filter
      { $count: "totalUsers" },
    ];

    const totalUsersResult = await MT5Credential.aggregate(countPipeline);
    const totalUsers = totalUsersResult[0]?.totalUsers || 0;

    return res.status(200).json({
      success: true,
      users,
      pagination: {
        currentPage: page,
        totalPages: Math.ceil(totalUsers / limit),
        totalUsers,
      },
    });
  } catch (err) {
    console.error("Error fetching users:", err);
    return res.status(500).json({
      success: false,
      message: "Internal Server Error",
    });
  }
};

const getPropAccounts = async (req, res) => {
  try {
    const { userId } = req.query;
    const { page = 1, limit = 10 } = req.query;
    const skip = (parseInt(page) - 1) * parseInt(limit);

    const mt = await MT5Credential.find({ user_id: userId })
      .skip(skip)
      .limit(parseInt(limit))
      .exec();
    const populatedMT5 = await Promise.all(
      mt.map(async payment => {
        if (payment.plan) {
          console.log("PLAN ID:", payment.plan);
          const plan = mongoose.isValidObjectId(payment.plan)
            ? await PaymentPlan.findById(payment.plan)
            : null;
          console.log("PLAN:");
          console.log(plan);
          return {
            ...payment.toObject(),
            plan: plan || null,
          };
        }

        return payment;
      }),
    );

    populatedMT5.sort(
      (a, b) =>
        new Date(b.created_at || b.createdAt) -
        new Date(a.created_at || a.createdAt),
    );

    const totalResults = await MT5Credential.countDocuments({
      user_id: userId,
    });

    console.log("MT5 Credentials" , mt)

    res.status(200).json({
      success: true,
      data: populatedMT5,
      pagination: {
        totalResults,
        currentPage: parseInt(page),
        totalPages: Math.ceil(totalResults / parseInt(limit)),
        resultsPerPage: parseInt(limit),
      },
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Failed to fetch data",
      details: error.message,
    });
  }
};

const getSalesAndProfit = async (req, res) => {
  try {
    const { userId } = req.query;
    // Fetch all payments in one go
    const [cryptoPayments, cardPayments, allWithdrawals] = await Promise.all([
      CryptoCharge.find({ userId, status: "paid" }),
      Payment.find({ userId, "chargeResponse.status": "CAPTURED" }),
      Withdrawal.find({ user: userId }),
    ]);

    // Helper functions
    const parseAmount = amount => {
      if (typeof amount === "string")
        return parseFloat(amount.replace("$", ""));
      return amount || 0;
    };

    const calculatePaymentTotals = (payments, dateRange = null, type) => {
      const filtered = dateRange
        ? payments.filter(
            p => p[type] >= dateRange.start && p[type] <= dateRange.end,
          )
        : payments;

      return {
        count: filtered.length,
        total: filtered.reduce((sum, payment) => {
          const amount = payment.chargeResponse?.amount
            ? Number(payment.chargeResponse.amount)
            : parseAmount(payment?.amount_crypto);
          return sum + amount;
        }, 0),
      };
    };

    const calculateWithdrawals = (withdrawals, dateRange = null) => {
      const filtered = dateRange
        ? withdrawals.filter(
            w =>
              w.created_at >= dateRange.start && w.created_at <= dateRange.end,
          )
        : withdrawals;

      return filtered.reduce(
        (sum, w) => sum + parseFloat(w.withdrawalAmount) || 0,
        0,
      );
    };

    // Calculate all metrics
    const total = {
      crypto: calculatePaymentTotals(cryptoPayments),
      card: calculatePaymentTotals(cardPayments),
      withdrawals: calculateWithdrawals(allWithdrawals),
    };

    // Prepare response data
    const responseData = {
      totalOrders: total.crypto.count + total.card.count,
      totalWithdrawals: total.withdrawals,
      totalSale: total.crypto.total + total.card.total,
    };

    // Format numbers
    Object.keys(responseData).forEach(key => {
      if (typeof responseData[key] === "number") {
        responseData[key] = parseFloat(responseData[key].toFixed(2));
      }
    });

    res.status(200).json({
      success: true,
      message: "Data fetched successfully",
      data: responseData,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Failed to fetch data",
      details: error.message,
    });
  }
};

const getAllOrders = async (req, res, next) => {
  try {
    const { page = 1, limit = 10, userId, search = "" } = req.query;
    const skip = (parseInt(page) - 1) * parseInt(limit);
    if (!userId || !mongoose.isValidObjectId(userId)) {
      return res.status(400).json({
        success: false,
        message: "Valid User ID is required",
      });
    }
    const user_id = new mongoose.Types.ObjectId(userId);
    const [payments, cryptoCharges] = await Promise.all([
      Payment.find({ userId: user_id })
        .skip(skip)
        .limit(parseInt(limit))
        .exec(),
      CryptoCharge.find({ user: user_id })
        .skip(skip)
        .limit(parseInt(limit))
        .populate("paymentPlan")
        .exec(),
    ]);

    const populatedPayments = await Promise.all(
      payments.map(async payment => {
        if (payment.chargeResponse?.metadata?.planId) {
          const plan = await PaymentPlan.findById(
            payment.chargeResponse.metadata.planId,
          );
          return {
            ...payment.toObject(),
            plan: plan || null,
          };
        }
        return payment;
      }),
    );

    const combinedResults = [...populatedPayments, ...cryptoCharges];

    combinedResults.sort(
      (a, b) =>
        new Date(b.created_at || b.createdAt) -
        new Date(a.created_at || a.createdAt),
    );

    const [totalPayments, totalCryptoCharges] = await Promise.all([
      Payment.countDocuments({ userId: user_id }),
      CryptoCharge.countDocuments({ user: user_id }),
    ]);

    const totalResults = totalPayments + totalCryptoCharges;

    res.status(200).json({
      success: true,
      data: combinedResults,
      pagination: {
        totalResults,
        currentPage: parseInt(page),
        totalPages: Math.ceil(totalResults / parseInt(limit)),
        resultsPerPage: parseInt(limit),
      },
    });
  } catch (error) {
    console.error("Error fetching combined payments:", error);
    res.status(500).json({
      success: false,
      message: "Internal server error",
    });
  }
};

const getAllEmails = async (req, res, next) => {
  try {
    const { page = 1, limit = 10, userId } = req.query;
    const skip = (parseInt(page) - 1) * parseInt(limit);

    const emails = await Email.find({ userId })
      .skip(skip)
      .limit(parseInt(limit))
      .exec();

    const totalEmails = await Email.countDocuments({ userId });

    res.status(200).json({
      success: true,
      data: emails,
      pagination: {
        totalEmails,
        currentPage: parseInt(page),
        totalPages: Math.ceil(totalEmails / parseInt(limit)),
        resultsPerPage: parseInt(limit),
      },
    });
  } catch (error) {
    console.error("Error fetching combined payments:", error);
    res.status(500).json({
      success: false,
      message: "Internal server error",
    });
  }
};

const addNoteToUser = async (req, res) => {
  try {
    const { note, userId } = req.body;

    const user = await User.findByIdAndUpdate(
      userId,
      {
        $push: { notes: { note } },
      },
      { new: true },
    );

    return res.status(200).json({
      success: true,
      message: "Note added to user",
      user,
    });
  } catch (error) {
    console.error("Error adding note:", error);
    return res.status(500).json({
      success: false,
      message: "Internal server error",
      error: error.message,
    });
  }
};

const updateNoteOfUser = async (req, res) => {
  try {
    const { userId, noteId, note } = req.body;
    console.log("Updating note:", req.body);

    // Convert string IDs to ObjectId since MongoDB stores them as ObjectIds
    const userObjectId = new mongoose.Types.ObjectId(userId);
    const noteObjectId = new mongoose.Types.ObjectId(noteId);

    const user = await User.findOneAndUpdate(
      { _id: userObjectId, "notes._id": noteObjectId },
      { $set: { "notes.$.note": note } },
      { new: true },
    );

    if (!user) {
      return res.status(404).json({
        success: false,
        message: "User or note not found",
      });
    }

    return res.status(200).json({
      success: true,
      message: "Note updated successfully",
      user,
    });
  } catch (error) {
    console.error("Error updating note:", error);
    return res.status(500).json({
      success: false,
      message: "Internal server error",
      error: error.message,
    });
  }
};

const deleteNoteFromUser = async (req, res) => {
  try {
    const { noteId, userId } = req.query;

    console.log(req.query);

    const user = await User.findById(userId);

    if (!user) {
      return res.status(404).json({
        success: false,

        message: "User not found",
      });
    }

    const noteIndex = user.notes.findIndex(
      note => note._id.toString() === noteId,
    );

    if (noteIndex === -1) {
      return res.status(404).json({
        success: false,

        message: "Note not found",
      });
    }

    user.notes.splice(noteIndex, 1);

    await user.save();

    return res.status(200).json({
      success: true,

      message: "Note deleted successfully",

      user,
    });
  } catch (error) {
    console.error("Error deleting note:", error);

    return res.status(500).json({
      success: false,

      message: "Internal server error",

      error: error.message,
    });
  }
};

async function getTotalWithdrawalAmount(userId) {
  try {
    const result = await PayoutDetails.aggregate([
      {
        $match: { userId: new mongoose.Types.ObjectId(userId) },
        $match: { userId: new mongoose.Types.ObjectId(userId) },
      },
      {
        $group: {
          _id: null,
          totalWithdrawalAmount: { $sum: "$amount" },
        },
      },
    ]);

    if (result.length > 0) {
      return result[0].totalWithdrawalAmount;
    } else {
      return 0;
    }
  } catch (error) {
    console.error("Error calculating total withdrawal amount:", error);
    throw error;
  }
}

const getAllWithDrawals = async (req, res, next) => {
  try {
    const { page = 1, limit = 10, userId } = req.query;
    const skip = (parseInt(page) - 1) * parseInt(limit);

    // Convert userId to ObjectId safely
    let objectId;
    if (mongoose.Types.ObjectId.isValid(userId)) {
      objectId = new mongoose.Types.ObjectId(userId);
    } else {
      return res.status(400).json({
        success: false,
        message: "Invalid userId format",
      });
    }

    const withdrawals = await PayoutDetails.find({ userId: objectId })
      .skip(skip)
      .limit(parseInt(limit))
      .exec();

    const totalWithdrawals = await PayoutDetails.countDocuments({
      userId: new mongoose.Types.ObjectId(userId),
    });

    const withdrawalAmount = await getTotalWithdrawalAmount(objectId);

    res.status(200).json({
      success: true,
      data: { withdrawals, withdrawalAmount },
      pagination: {
        totalWithdrawals,
        currentPage: parseInt(page),
        totalPages: Math.ceil(totalWithdrawals / parseInt(limit)),
        resultsPerPage: parseInt(limit),
      },
    });
  } catch (error) {
    console.error("Error fetching withdrawals:", error);
    res.status(500).json({
      success: false,
      message: "Internal server error" + error,
    });
  }
};

const removeFromManager = async (req, res) => {
  try {
    const { userId } = req.body;

    const user = await User.findOne({ _id: userId });
    if (!user) {
      return res.status(404).json({
        success: false,
        message: "No User found",
      });
    }

    const updatePassword = await User.updateOne(
      { _id: userId },
      {
        $set: {
          userLevel: "User",
          manager: false,
        },
      },
    );

    if (updatePassword?.modifiedCount > 0)
      return res.status(200).json({
        success: true,
        message: "Member Updated Successfullly",
      });
    else
      return res.status(401).json({
        success: false,
        message: "Unable to update Member ",
      });
  } catch (err) {
    console.log("ERROR", err);
    return res.status(500).json({
      success: false,
      message: "Internal Server Error",
    });
  }
};

const reset2FAHandler = async (req, res) => {
  try {
    const { userId } = req.body;

    const user = await User.findOne({ _id: userId });
    if (!user) {
      return res.status(404).json({
        success: false,
        message: "User not found",
      });
    }

    const updatePassword = await User.updateOne(
      { _id: userId },
      {
        $set: {
          twofaEnabled: false,
          twofaVerified: false,
          twofaSecret: "",
        },
      },
    );

    if (updatePassword?.modifiedCount > 0)
      return res.status(200).json({
        success: true,
        message: "2FA reset successfullly",
      });
    else
      return res.status(401).json({
        success: false,
        message: "Unable to reset 2FA ",
      });
  } catch (err) {
    console.log("ERROR", err);
    return res.status(500).json({
      success: false,
      message: "Internal Server Error",
    });
  }
};

const getUserLocations = async (req, res) => {
  try {
    const { page = 1, limit = 10, userId } = req.query;

    const skip = (parseInt(page) - 1) * parseInt(limit);

    // Get total count for pagination
    const totalCount = await UserLocation.countDocuments({ userId });

    // Fetch paginated user locations
    const locations = await UserLocation.find({ userId })
      .sort({ loginTimestamp: -1 }) // Most recent first
      .skip(skip)
      .limit(parseInt(limit))
      .lean()
      .exec();

    res.status(200).json({
      success: true,
      data: locations,
      pagination: {
        total: totalCount,
        page: parseInt(page),
        limit: parseInt(limit),
        pages: Math.ceil(totalCount / parseInt(limit)),
      },
    });
  } catch (error) {
    console.error("Error fetching user locations:", error);
    res.status(500).json({
      success: false,
      error: "Failed to fetch user locations",
    });
  }
};

const submitForm = async (req, res) => {
  try {
    const userId = req.body.userId || req.user?._id;
    const userEmail = req.body.email;
    const additionalDetails = req.body.additionalDetails || {};

    // Manual Validation
    if (!userEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(userEmail)) {
      return res.status(400).json({ message: "A valid userEmail is required" });
    }

    if (additionalDetails && typeof additionalDetails !== "object") {
      return res
        .status(400)
        .json({ message: "additionalDetails must be an object if provided" });
    }

    // Call the service function to save the form submission
    const savedForm = await saveFormSubmission(
      userId,
      userEmail,
      additionalDetails,
    );

    if (!savedForm) {
      return res
        .status(500)
        .json({ message: "Failed to save form submission" });
      ``;
    }

    const userSubmittedFormsCount = await FormSubmission.countDocuments({
      userId,
    }).lean();

    const updateFormSubmitCount = await User.findByIdAndUpdate(userId, {
      formSubmitCount: userSubmittedFormsCount,
    });

    // Add the email to EmailOctopus
    // try {
    //   await addUserToEmailOctopus(userEmail);
    // } catch (error) {
    //   console.error("Error adding email to EmailOctopus:", error.message);
    // }

    return res.status(200).json({
      message: "Form submitted successfully!",
      data: { ...savedForm, formSubmitCount: userSubmittedFormsCount }, // Return the saved form submission
    });
  } catch (error) {
    console.error("Error in submitForm:", error.message);
    return res
      .status(500)
      .json({ message: "An error occurred while submitting the form" });
  }
};

const banUsers = async (req, res) => {
  try {
    const { userId, country, lastIp , banStatus} = req.body;
    console.log(req.body,"this is req body")

    // Ensure only one of the identifiers is used
    const providedFields = [userId, country, lastIp].filter(Boolean);
    if (providedFields.length !== 1) {
      return res.status(400).json({
        message: "Provide exactly one identifier: userId, country, or lastIp.",
      });
    }

    let filter = {};

    if (userId) {
      filter._id = userId;
    } else if (country) {
      filter.country = country;
      console.log(filter.country);
    } else if (lastIp) {
      filter.lastIp = lastIp;
    }

    const result = await User.updateMany(filter, {
      $set: { isBan: banStatus },
    });

    if (result.modifiedCount === 0) {
      return res.status(404).json({
        message: "No matching users found to ban.",
      });
    }

    res.status(200).json({
      message: `Successfully Banned ${banStatus} ${result.modifiedCount} user(s).`,
    });
  } catch (error) {
    console.error("Ban operation failed:", error);
    res.status(500).json({ message: "Internal server error" });
  }
};

const banUserIp = async (req, res) => {
  try {
    const { lastIp, banStatus } = req.body;

    if (!lastIp || typeof banStatus !== "boolean") {
      return res.status(400).json({
        message: "Please provide both lastIp and a valid banStatus (true or false).",
      });
    }

    const result = await UserLocation.updateMany(
      { ipAddress: lastIp },
      { $set: { isBan: banStatus } }
    );

    if (result.modifiedCount === 0) {
      return res.status(404).json({
        message: "No matching IPs found to update ban status.",
      });
    }

    res.status(200).json({
      message: `Successfully updated ban status for ${result.modifiedCount} location(s).`,
    });
  } catch (error) {
    console.error("Ban operation failed:", error);
    res.status(500).json({ message: "Internal server error" });
  }
};


const getAllCountries = async (req, res) => {
  try {
    const countries = await User.distinct("country", { country: { $ne: "" } });
    res.status(200).json({ countries });
  } catch (error) {
    console.error("Error fetching countries:", error.message);
    res.status(500).json({ message: "Failed to fetch countries" });
  }
};

const getAddOns = async (req, res) => {
  try {
    const { loginid } = req.params;

    if (!loginid) {
      return res.status(400).json({
        success: false,
        message: "Login Id is required",
      });
    }

    const mt5Account = await MT5Credential.findOne({
      login: loginid,
    }).select("addOns");

    if (!mt5Account) {
      return res.status(404).json({
        success: false,
        message: "MT5 account not found",
      });
    }

    return res.status(200).json({
      success: true,
      message: "AddOns fetched successfully",
      data: {
        login: mt5Account.login,
        addOns: mt5Account.addOns || {
          payout7Days: false,
          profitSplit: null,
          eAAllowed: false,
        },
      },
    });
  } catch (error) {
    console.error("Error fetching addOns:", error);
    return res.status(500).json({
      success: false,
      message: "Internal server error",
      error: error.message,
    });
  }
};
module.exports = {
  getAddOns,
  getProfile,
  dashboardLeaderboard,
  updateProfile,
  getReferralLink,
  getAllCustomers,
  getAllVerifiedCustomers,
  updateProfilePayment,
  getUserByEmail,
  uploadProfilePicture,
  calculateDiscountedPrice,
  getAllUsers,
  getCustomers,
  getAllUsersOrSearchByEmail,
  getAllPropAccounts,
  getAllCustomersWithPlans,
  getSalesAndProfit,
  blackListUser,
  resetPasswordHandler,
  getPropAccounts,
  getAllOrders,
  getAllAffiliateUsers,
  getAllEmails,
  addNoteToUser,
  updateNoteOfUser,
  deleteNoteFromUser,
  getAllWithDrawals,
  reset2FAHandler,
  getUserLocations,
  removeFromManager,
  submitForm,
  banUsers,
  getAllCountries,
  getAllCustomersforExport,
  banUserIp
};

const saveFormSubmission = async (userId, email, additionalDetails) => {
  const formSubmission = new FormSubmission({
    userId,
    email,
    additionalDetails,
  });

  const savedForm = await formSubmission.save();
  return await FormSubmission.findById(savedForm._id).lean(); // Returns a plain JS object
};
