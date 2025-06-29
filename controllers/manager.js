const axios = require("axios");
const User = require("../models/user"); // Assuming the User model is in the models folder
const UserPlan = require("../models/userPlan"); // Assuming UserPlan model is available
const PaymentPlan = require("../models/paymentPlans"); // Assuming PaymentPlan model is available
// const VolumetricaTradingAccounts = require("../models/volumetricaTradingAccount");
const VolumetricaTradingAccountsCred = require("../models/volumetricaCredentials");
const MT5Credential = require("../models/MT5Credentials");
const PayoutDetail = require("../models/payoutDetail");
const DealHistory = require("../models/dealHistory");
const MT5Credentials = require("../models/MT5Credentials");
const mongoose = require("mongoose");
// const Subscription = require("../models/subscription");

const {
  upgradeMT5Account,
  breachMT5,
  changePlanMT5,
  addBalanceMT5,
  suspendMT5,
  unSuspendMT5,
} = require("./mt5Credentials");

const isTokenValid = async (req, res) => {
  try {
    res.status(200).json({ ok: true, state: "loggedIn" });
  } catch (error) {
    res.status(401).json({ msg: "Invalid token or user doesn't exist" });
  }
};

const getAccountProps = async (req, res) => {
  try {
    const { firstName, page = 1, limit = 10 } = req.query;
    const skip = (parseInt(page) - 1) * parseInt(limit);

    // Build the match condition for volumetricaAccountID and optional firstName search
    const matchCondition = {
      volumetricaAccountID: { $exists: true, $ne: null },
      ...(firstName && { firstName: new RegExp(firstName, "i") }), // Case-insensitive regex
    };

    // Fetch users with volumetricaAccountID and paginate results
    const [users, totalCount] = await Promise.all([
      User.find(matchCondition).skip(skip).limit(parseInt(limit)),
      User.countDocuments(matchCondition),
    ]);

    // If no users found, return early with pagination details
    if (!users.length) {
      return res.status(200).json({
        success: true,
        message: "No users found",
        users: [],
        page: parseInt(page),
        totalPages: 0,
        totalCount: 0,
      });
    }

    // Extract volumetricaAccountIDs from the users
    const volumetricaAccountIDs = users
      .map(user => user.volumetricaAccountID)
      .filter(Boolean); // Remove any null/undefined IDs

    // If no valid volumetricaAccountIDs found, return early
    if (!volumetricaAccountIDs.length) {
      return res.status(200).json({
        success: true,
        message: "Users fetched but no valid Volumetrica Account IDs found.",
        users,
        page: parseInt(page),
        totalPages: Math.ceil(totalCount / parseInt(limit)),
        totalCount,
      });
    }

    // Fetch trading accounts for the volumetricaAccountIDs
    const tradingAccountsResponse = await fetchTradingAccounts(
      volumetricaAccountIDs,
    );

    // Check if `tradingAccountsResponse` is an object and if `data` is an object containing the trading accounts
    const tradingAccountsData = tradingAccountsResponse.data || {}; // Fallback to an empty object

    // Fetch user plans and payment plans based on activePlans in users
    const combinedData = await Promise.all(
      users.map(async user => {
        // Lookup UserPlans based on activePlans IDs
        const userPlans = await UserPlan.find({
          _id: { $in: user.activePlans },
        });

        // Perform a lookup to get PaymentPlan details for each UserPlan
        const userPlansWithPaymentPlans = await Promise.all(
          userPlans.map(async userPlan => {
            // Find the paymentPlan details
            const paymentPlan = await PaymentPlan.findById(
              userPlan.paymentPlan,
            );

            return {
              ...userPlan._doc, // Spread userPlan data
              paymentPlanName: paymentPlan ? paymentPlan.name : null, // Attach PaymentPlan name
              paymentPlanDetails: paymentPlan || null, // Attach the full paymentPlan details
            };
          }),
        );

        // Combine user data with corresponding trading account and user plans
        const tradingAccount = tradingAccountsData.snapshot || null; // Assuming the tradingAccountsResponse contains `snapshot`

        return {
          ...user._doc, // Spread user data
          tradingAccount, // Attach trading account data or null if not found
          userPlans: userPlansWithPaymentPlans, // Attach UserPlans with payment plan names and details
        };
      }),
    );

    // Return combined data
    return res.status(200).json({
      success: true,
      message:
        "Users, Trading Accounts, and Payment Plans fetched successfully",
      data: combinedData, // Return combined data in a single array
      page: parseInt(page),
      totalPages: Math.ceil(totalCount / parseInt(limit)),
      totalCount,
    });
  } catch (error) {
    return handleApiError(res, error);
  }
};

const getManagerAccounts = async (req, res) => {
  try {
    const { firstName, page = 1, limit = 10 } = req.query;
    const skip = (parseInt(page) - 1) * parseInt(limit);

    // Build the match condition for managers with volumetricaAccountID and optional firstName search
    const matchCondition = {
      volumetricaAccountID: { $exists: true, $ne: null },
      ...(firstName && { firstName: new RegExp(firstName, "i") }), // Case-insensitive regex for firstName
    };

    // Use aggregate pipeline for lookup
    const [users, totalCount] = await Promise.all([
      User.aggregate([
        { $match: matchCondition }, // Match users based on the matchCondition
        { $skip: skip }, // Pagination: skip documents
        { $limit: parseInt(limit) }, // Limit documents per page
        {
          $lookup: {
            from: "userplans", // Collection to lookup (UserPlan collection)
            localField: "activePlans", // Field from User collection (activePlans array)
            foreignField: "_id", // Field from UserPlan collection
            as: "userPlans", // Output array in the User object
          },
        },
        {
          $lookup: {
            from: "paymentplans", // Collection to lookup (PaymentPlan collection)
            localField: "userPlans.paymentPlan", // Field from UserPlan collection
            foreignField: "_id", // Field from PaymentPlan collection
            as: "paymentPlans", // Output array in the User object
          },
        },
      ]),
      User.countDocuments(matchCondition), // Count total documents for pagination
    ]);

    // If no users found, return early with pagination details
    if (!users.length) {
      return res.status(200).json({
        success: true,
        message: "No manager accounts found",
        users: [],
        page: parseInt(page),
        totalPages: 0,
        totalCount: 0,
      });
    }

    // Return the paginated list of users with UserPlans and PaymentPlans
    return res.status(200).json({
      success: true,
      message:
        "Manager accounts with UserPlans and PaymentPlans fetched successfully",
      users, // Users with populated userPlans and paymentPlans
      page: parseInt(page),
      totalPages: Math.ceil(totalCount / parseInt(limit)),
      totalCount,
    });
  } catch (error) {
    return handleApiError(res, error);
  }
};

// Helper function to fetch trading accounts from external API
const fetchTradingAccounts = async accountIds => {
  const accountIdQuery = accountIds.join(","); // Convert array to comma-separated string
  const url = `${process.env.BASE_URL}/api/v2/Propsite/TradingAccount`;
  const config = {
    headers: { "x-api-key": process.env.VOL_API_KEY },
    params: { accountId: accountIdQuery, apiKey: process.env.API_KEY },
  };

  const response = await axios.get(url, config);
  return response.data; // Return the data directly
};

// Helper function to handle errors
const handleApiError = (res, error) => {
  if (error.response) {
    return res.status(error.response.status).json({
      success: false,
      message: "Error from external API",
      details: error.response.data,
    });
  } else if (error.request) {
    return res.status(500).json({
      success: false,
      message: "No response from external API",
    });
  } else {
    return res.status(500).json({
      success: false,
      message: "An internal error occurred",
      details: error.message,
    });
  }
};

const updateUserDetails = async (req, res) => {
  try {
    const { userId } = req.query;

    const updateObject = { ...req.body };

    if (!updateObject || Object.keys(updateObject).length === 0) {
      return res.status(400).json({
        success: false,
        message: "No fields provided for update",
      });
    }
    if ("password" in updateObject) {
      delete updateObject.password; // Remove the password field
    }

    console.log(updateObject);

    // Update the user document with the fields in updateObject
    const updatedUser = await User.findByIdAndUpdate(
      userId,
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

const getTradingAccountDetails = async (req, res) => {
  try {
    const { accId } = req.query;

    const mt5Account = await MT5Credential.findOne({ _id: accId });
    if (mt5Account) {
      const plan_id = mongoose.isValidObjectId(mt5Account.plan)
        ? await PaymentPlan.findById(mt5Account.plan)
        : null;
      const plan = await PaymentPlan.findOne({ _id: plan_id });

      const isFunded =
        mt5Account?.state === "Funded" ||
        (mt5Account?.active && plan?.planType === "Instant-Funding");

      // Define account status logic in one place
      const getAccountStatus = account => {
        if (!account) return "Unknown";
        if (account.breached_loss_limit) return "Breached";
        if (!account.active) return "Disabled";
        return isFunded ? "Funded" : "Active";
      };

      // Map status to colors (single source of truth)
      const STATUS_COLORS = {
        Active: "green",
        Funded: "green",
        Disabled: "red",
        Breached: "red",
        Unknown: "gray",
      };

      const accountStatus = getAccountStatus(mt5Account);
      const color = STATUS_COLORS[accountStatus] || "gray";

      return res.status(200).json({
        success: true,
        message: "Trading account details found in MT5",
        data: {
          account: mt5Account,
          accountType: "mt5",
          plan,
          accountStatus,
          isFunded,
          color,
        },
      });
    }

    return res.status(200).json({
      success: false,
      message: "Account not found in MT5",
    });
  } catch (error) {
    console.error("Error fetching trading account details:", error);
    return res.status(500).json({
      success: false,
      message: "Server error while fetching trading account details",
    });
  }
};

const upgradeAccount = async (req, res) => {
  const { platform, accountId } = req.query;
  console.log(platform, accountId);
  if (platform == "mt5") {
    const success = upgradeMT5Account(accountId);
    if (success) {
      return res.status(200).json({
        success: true,
        msg: "Mt5 Account Upgraded successfully!",
      });
    } else {
      return res.status(200).json({
        success: false,
        msg: "Unable to upgrade!",
      });
    }
  }

  res.status(200).json({
    success: false,
    msg: "Volumetrica pending!",
  });
};

const updateMT5AccountStatus = async (req, res) => {
  try {
    // Extract parameters from query
    const { accId, action, note } = req.query;

    // Validate required parameters
    if (!accId || !action) {
      return res.status(400).json({
        success: false,
        message: "Account ID and action are required",
      });
    }

    if (!note) {
      return res.status(400).json({
        success: false,
        message: "Note is required for account actions",
      });
    }

    // Determine update object based on action
    let updateData = {};

    switch (action.toLowerCase()) {
      case "disable":
        updateData.active = false;
        break;
      case "active":
        updateData.active = true;
        break;
      case "breach":
        updateData.active = false;
        updateData.breached_loss_limit = true;
        break;
      case "un-breach":
        updateData.active = true;
        updateData.breached_loss_limit = false;
        break;
      default:
        return res
          .status(400)
          .json({ success: false, message: "Invalid action specified" });
    }

    console.log("Update data before applying note:", updateData);

    // Perform the update with both the action data and adding the note

    const updatedAccount = await MT5Credential.findByIdAndUpdate(
      accId,
      {
        $set: updateData,
        $push: {
          notes: {
            note,
            createdAt: new Date(),
          },
        },
      },
      { new: true },
    );
    console.log(updatedAccount);

    if (!updatedAccount) {
      return res
        .status(404)
        .json({ success: false, message: "Account not found" });
    }

    return res.status(200).json({
      success: true,
      message: `Account status has been updated`,
      account: updatedAccount,
    });
  } catch (error) {
    console.error("Error updating account status:", error);
    return res
      .status(500)
      .json({ success: false, message: "Server error", error: error.message });
  }
};

const addPersonalizedDetails = async (req, res) => {
  try {
    const {
      login,
      maxDrawdown,
      profitTarget,
      dayLossLimit,
      minBettingDays,
      profitShare,
      upgradeThreshold,
      upgradeDelay,
      firstWithdrawal,
      subsequentWith,
      minWithdrawal,
    } = req.body;

    console.log("LOGIN: ", login);

    if (!login) {
      return res.status(400).json({ success: false, message: "Missing login" });
    }
    console.log(req.body);

    const user = await MT5Credential.findOne({ login });
    console.log(user);

    if (!user) {
      return res
        .status(404)
        .json({ success: false, message: "Account not found" });
    }

    const personalizedDetails = {
      maxDrawdown:
        maxDrawdown ?? user.Personalized_Account_Details?.maxDrawdown ?? null,
      profitTarget:
        profitTarget ?? user.Personalized_Account_Details?.profitTarget ?? null,
      dayLossLimit:
        dayLossLimit ?? user.Personalized_Account_Details?.dayLossLimit ?? null,
      minBettingDays:
        minBettingDays ??
        user.Personalized_Account_Details?.minBettingDays ??
        null,
      profitShare:
        profitShare ?? user.Personalized_Account_Details?.profitShare ?? null,
      upgradeThreshold:
        upgradeThreshold ??
        user.Personalized_Account_Details?.upgradeThreshold ??
        null,
      upgradeDelay:
        upgradeDelay ?? user.Personalized_Account_Details?.upgradeDelay ?? null,
      firstWithdrawal:
        firstWithdrawal ??
        user.Personalized_Account_Details?.firstWithdrawal ??
        null,
      subsequentWith:
        subsequentWith ??
        user.Personalized_Account_Details?.subsequentWith ??
        null,
      minWithdrawal:
        minWithdrawal ??
        user.Personalized_Account_Details?.minWithdrawal ??
        null,
    };

    // Update the user's personalized details
    const updatedUser = await MT5Credential.findOneAndUpdate(
      { login },
      {
        $set: {
          Personalized_Account_Details: personalizedDetails,
        },
      },
      { new: true },
    );

    return res.status(200).json({
      success: true,
      message: "Updated successfully",
      user: updatedUser,
    });
  } catch (error) {
    console.error("Error updating fields:", error);
    return res
      .status(500)
      .json({ success: false, message: "Internal Server Error" });
  }
};

const getTradingAccountHistory = async (req, res) => {
  try {
    const { accountId, page = 1, limit = 10 } = req.query;
    console.log(req.query);

    if (!accountId) {
      return res.status(400).json({
        success: false,
        message: "accountId is not provided",
      });
    }

    // Calculate skip value for pagination
    const skip = (parseInt(page) - 1) * parseInt(limit);

    // Build query
    const query = { accountId };

    // Execute query with pagination
    const [payouts, totalResults] = await Promise.all([
      PayoutDetail.find(query)
        .skip(skip)
        .limit(parseInt(limit))
        .sort({ createdAt: -1 })
        .populate("userId")
        .exec(),
      PayoutDetail.countDocuments(query),
    ]);

    // Return results with pagination info
    res.status(200).json({
      success: true,
      data: payouts,
      pagination: {
        totalResults,
        totalPages: Math.ceil(totalResults / parseInt(limit)),
      },
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Server Error",
      error: error.message,
    });
  }
};

const getMt5TradingHistory = async (req, res) => {
  try {
    const { mt5AccountId } = req.query;

    if (!mt5AccountId || !mongoose.Types.ObjectId.isValid(mt5AccountId)) {
      return res.status(400).json({ message: "Invalid MT5 Account ID format" });
    }
    const objectId = new mongoose.Types.ObjectId(mt5AccountId);
    const tradingHistory = await DealHistory.find({
      mt5_credential_id: objectId,
    });

    res.status(200).json(tradingHistory);
  } catch (error) {
    console.error("Error fetching MT5 trading history:", error);
    res.status(500).json({ message: "Internal server error" });
  }
};

const getPropAccountParameters = async (req, res) => {
  try {
    const { id } = req.query;
    console.log("ID:");
    console.log(id);

    const mt5Account = await MT5Credential.findOne({ _id: id });
    if (mt5Account) {
      return res.status(200).json({
        success: true,
        message: "Trading account details found in MT5",
        data: mt5Account,
      });
    }

    return res.status(200).json({
      success: false,
      message: "Account not found in MT5",
    });
  } catch (error) {
    console.error("Error fetching trading account details:", error);
    return res.status(500).json({
      success: false,
      message: "Server error while fetching trading account details",
    });
  }
};

const addManagerIdToReq = (req, res, next) => {
  req.user = { _id: req.query.id };
  next();
};

const addBalance = async (req, res) => {
  const { platform, accountId, balance_to_add, note, login } = req.query;
  console.log(req.query);

  if (platform == "mt5") {
    const success = await addBalanceMT5(login, balance_to_add);
    if (success) {
      await MT5Credential.findByIdAndUpdate(
        accountId,
        {
          $push: { notes: { note } },
        },
        { new: true },
      );
      return res.status(200).json({
        success: true,
        msg: "Balance added successfully!",
      });
    } else {
      return res.status(400).json({
        success: false,
        msg: "Unable to add balance!",
      });
    }
  }
};

const getPendingReviewAccounts = async (req, res) => {
  try {
    const {
      page = 1,
      limit = 10,
      mt5Token,
      search,
      type = "Pending",
    } = req.query;

    if (!mt5Token) {
      return res
        .status(400)
        .json({ success: false, message: "mt5Token is required" });
    }

    console.log("Checking backend API execution...");

    const skip = (parseInt(page) - 1) * parseInt(limit);

    if (!process.env.MT5_API_LINK) {
      console.error("MT5 API URL is not set in environment variables.");
      return res
        .status(500)
        .json({ success: false, message: "MT5 API URL is missing" });
    }

    const apiUrl = `${process.env.MT5_API_LINK}/manager/api/get_all_accounts_to_be_upgraded`;

    // Fetch data in parallel
    const [vol, mt5Response] = await Promise.all([
      VolumetricaTradingAccountsCred.find({ isReadyForFunded: true })
        .skip(skip)
        .limit(parseInt(limit / 2))
        .populate("user_id")
        .exec()
        .catch(err => {
          console.error("Error fetching Volumetrica data:", err.message);
          throw new Error("Failed to fetch Volumetrica data");
        }),
      axios
        .get(apiUrl, {
          headers: { Authorization: `Bearer ${mt5Token}` },
          params: {
            mt5_token: mt5Token,
            limit: parseInt(limit / 2),
            skip,
            search_email: search,
            returning_accounts: type,
          },
        })
        .catch(err => {
          console.error(
            "Error fetching MT5 API data:",
            err.response?.data || err.message,
          );
          throw new Error("Failed to fetch MT5 API data");
        }),
    ]);

    // Extract MT5 accounts from Python API response
    const mt = Array.isArray(mt5Response?.data?.Accounts)
      ? mt5Response.data.Accounts
      : [];

    // Combine and sort results
    const combinedResults = [...vol, ...mt].sort(
      (a, b) =>
        new Date(b.created_at || b.createdAt) -
        new Date(a.created_at || a.createdAt),
    );

    // Get total counts
    const [totalVol, totalMT] = await Promise.all([
      VolumetricaTradingAccountsCred.countDocuments({ isReadyForFunded: true }),
      parseInt(mt5Response?.data?.Total_Records || "0", 10),
    ]).catch(err => {
      console.error("Error fetching total counts:", err.message);
      throw new Error("Failed to fetch total count data");
    });

    const totalResults = totalVol + totalMT;

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
    console.error(
      "Unexpected error in getPendingReviewAccounts:",
      error.message,
    );
    res.status(500).json({
      success: false,
      message: error.message || "Internal Server Error",
    });
  }
};

const getTotalActiveUsers = async (req, res) => {
  try {
    const totalUsers = await User.countDocuments({ isDeleted: false });
    res.status(200).json({
      success: true,
      totalUsers,
    });
  } catch (error) {
    console.error("Unexpected error in getTotalActiveUSers:", error.message);
    res.status(500).json({
      success: false,
      message: error.message || "Internal Server Error",
    });
  }
};

const getSameIpAccounts = async (req, res) => {
  try {
    // Parse pagination params
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;
    const skip = (page - 1) * limit;

    // Filter query
    const query = { isSameIpLogin: true };

    // Get total count (for frontend pagination)
    const total = await User.countDocuments(query);

    // Get paginated results
    const users = await User.find(query)
      .skip(skip)
      .limit(limit)
      .select("-password -twofaSecret") // exclude sensitive fields
      .lean();

    return res.status(200).json({
      success: true,
      total,
      totalPages: Math.ceil(total / parseInt(limit)),
      page,
      limit,
      data: users,
    });
  } catch (error) {
    console.error("Error fetching same IP accounts:", error);
    return res.status(500).json({
      success: false,
      message: "Internal server error",
    });
  }
};

const updateTradingAccountNotes = async (req, res) => {
  try {
    // Extract parameters from query
    const { note, accId, noteId, platform } = req.query;

    // Validate required parameters
    if (!note || !accId || !noteId || !platform) {
      return res.status(400).json({
        success: false,
        message: "Note content, account ID, note ID, and platform are required",
      });
    }

    // Determine which model to use based on platform
    let TradingAccountModel;
    if (platform.toLowerCase() === "mt5") {
      TradingAccountModel = MT5Credential;
    } else {
      return res.status(400).json({
        success: false,
        message: "Invalid platform specified. Use 'mt5' or 'volumetrica'",
      });
    }

    // Update the specific note in the array using the $set operator with array position
    const updatedAccount = await TradingAccountModel.findOneAndUpdate(
      { _id: accId, "notes._id": noteId },
      { $set: { "notes.$.note": note, "notes.$.updatedAt": new Date() } },
      { new: true, runValidators: true },
    );

    if (!updatedAccount) {
      return res.status(404).json({
        success: false,
        message: "Account or note not found",
      });
    }

    return res.status(200).json({
      success: true,
      message: "Note has been updated successfully",
      account: updatedAccount,
    });
  } catch (error) {
    console.error("Error updating account note:", error);
    return res.status(500).json({
      success: false,
      message: "Server error",
      error: error.message,
    });
  }
};

const deleteTradingAccountNotes = async (req, res) => {
  try {
    // Extract parameters from query
    const { noteId, accId, platform } = req.query;

    // Validate required parameters
    if (!noteId || !accId || !platform) {
      return res.status(400).json({
        success: false,
        message: "Note ID, account ID, and platform are required",
      });
    }

    // Determine which model to use based on platform
    let TradingAccountModel;
    if (platform.toLowerCase() === "mt5") {
      TradingAccountModel = MT5Credential;
    } else {
      return res.status(400).json({
        success: false,
        message: "Invalid platform specified. Use 'mt5' or 'volumetrica'",
      });
    }

    // Remove the specific note from the array using the $pull operator
    const updatedAccount = await TradingAccountModel.findByIdAndUpdate(
      accId,
      { $pull: { notes: { _id: noteId } } },
      { new: true, runValidators: true },
    );

    if (!updatedAccount) {
      return res.status(404).json({
        success: false,
        message: "Account not found",
      });
    }

    return res.status(200).json({
      success: true,
      message: "Note has been deleted successfully",
      account: updatedAccount,
    });
  } catch (error) {
    console.error("Error deleting account note:", error);
    return res.status(500).json({
      success: false,
      message: "Server error",
      error: error.message,
    });
  }
};

const getMT5Account = async (req, res) => {
  try {
    const { accountId } = req.query;
    if (!accountId) {
      return res.status(400).json({ 
        success: false,
        message: "accountId is required" 
      });
    }

    let query;
    if (mongoose.isValidObjectId(accountId)) {
      query = { _id: new mongoose.Types.ObjectId(accountId) };
    } else {
      const loginNumber = isNaN(accountId) ? accountId : Number(accountId);
      query = { login: loginNumber };
    }

    // Find the MT5 account
    const account = await MT5Credentials.findOne(query)
      .select('-password -investor_password') 
      .lean();

    if (!account) {
      return res.status(404).json({ 
        success: false,
        message: "MT5 account not found" 
      });
    }

    return res.status(200).json({
      success: true,
      data: account
    });

  } catch (error) {
    console.error("Error in getMT5Account:", error);
    return res.status(500).json({ 
      success: false,
      message: "Internal server error",
      error: error.message 
    });
  }
};


module.exports = {
  isTokenValid,
  getAccountProps,
  getManagerAccounts,
  updateUserDetails,
  getTradingAccountDetails,
  upgradeAccount,
  updateMT5AccountStatus,
  addPersonalizedDetails,
  getTradingAccountHistory,
  getMt5TradingHistory,
  getPropAccountParameters,
  addManagerIdToReq,
  addBalance,
  getPendingReviewAccounts,
  getTotalActiveUsers,
  getSameIpAccounts,
  updateTradingAccountNotes,
  deleteTradingAccountNotes,
  getMT5Account
};
