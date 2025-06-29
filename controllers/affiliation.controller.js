const axios = require("axios");
const User = require("../models/user");
const PayoutDetail = require("../models/payoutDetail");
const AffiliationDetail = require("../models/affiliationDetail");
const Plan = require("../models/paymentPlans");
const MilestoneAchievement = require("../models/milestoneAchievement");
const mongoose = require("mongoose");
const sendEmail = require("../utils/sendEmail");
const MT5 = require("../models/MT5Credentials");
const TradelockerCredentials = require("../models/TradelockerCredentials");
const matchTraderAccountDetails = require("../models/matchTraderTraddingAccount");
const { fetchAuthToken, checkConsistencyRule } = require("../utils/mt5")
const certificateController = require("../controllers/certificate")
const Discount = require("../models/Discount");
const processMilestonesOnReferral = async userId => {
  try {
    // Fetch milestone definitions from the model
    const milestones = MilestoneAchievement.getMilestones();

    // Fetch the user's current highest milestone rank and affiliation details in parallel
    const [currentMilestone, affiliationDetails] = await Promise.all([
      MilestoneAchievement.findOne({ userId })
        .sort({ achievedAt: -1 }) // Get the latest achieved milestone
        .select("rank") // Only fetch the rank
        .lean(), // Use lean for lightweight plain JS object
      getAffiliationDetailsByTier(userId),
    ]);

    // Determine the starting point in milestones
    const startFromIndex =
      milestones.findIndex(
        milestone => milestone.rank === currentMilestone?.rank,
      ) + 1;

    const totalUsers = affiliationDetails.totalUsers;
    const bulkOperations = [];

    // Iterate only over the remaining milestones
    for (let i = startFromIndex; i < milestones.length; i++) {
      const milestone = milestones[i];
      let conditionMet = false;

      // Check tier-specific conditions
      if (milestone.condition.tier) {
        const tierUsers =
          affiliationDetails.tierDetails[milestone.condition.tier]
            ?.totalUsers || 0;
        conditionMet = tierUsers >= milestone.condition.users;
      }

      // Check total user conditions
      if (milestone.condition.totalUsers) {
        conditionMet = totalUsers >= milestone.condition.totalUsers;
      }

      if (conditionMet) {
        // Add bulk operation for the milestone update
        bulkOperations.push({
          updateOne: {
            filter: { userId: userId, rank: milestone.rank },
            update: {
              $set: {
                milestone: milestone.condition.tier
                  ? `Successfully refer ${milestone.condition.users} clients in Tier ${milestone.condition.tier}.`
                  : `Build a total network of ${milestone.condition.totalUsers} clients across all tiers.`,
                reward: milestone.reward,
                achievedAt: new Date(),
              },
            },
            upsert: true,
          },
        });
      } else {
        // Stop further milestone checks if condition not met
        break;
      }
    }

    // Execute bulk operations if there are any
    if (bulkOperations.length > 0) {
      const bulkWriteResult =
        await MilestoneAchievement.bulkWrite(bulkOperations);
      console.log("Bulk write result:", bulkWriteResult);
    }

    // Return the last milestone that was part of bulk operations, if any
    return bulkOperations.length > 0
      ? bulkOperations[bulkOperations.length - 1].updateOne.filter
      : null;
  } catch (error) {
    console.error(
      `Error in processMilestonesOnReferral for userId ${userId}:`,
      error.message,
    );
    throw error;
  }
};

/**
 * Save affiliate commission details to the database.
 * @param {String} fromUserId - The user who initiated the purchase.
 * @param {Array} toUsers - Array of users to receive the commission.
 * @param {Number} amount - The total price of the purchase.
 * @param {Number} percentage - Commission percentage (e.g., 0.1 for 10%).
 * @param {Number} tier - The tier level (1, 2, 3, or 4).
 */
const saveAffiliateDetails = async (
  fromUserId,
  toUsers,
  amount,
  percentage,
  tier,
  planId,
) => {
  const commissionAmount = amount * percentage;

  const promises = toUsers.map(user => {
    const affiliationDetail = new AffiliationDetail({
      userId: user._id,
      fromUserId,
      amount: commissionAmount,
      percentage: percentage * 100, // Save as a percentage (e.g., 10%)
      tier,
      planId,
    });
    return affiliationDetail.save();
  });

  await Promise.all(promises); // Save all affiliate details in parallel

  // Process milestones for each referrer
  const milestonePromises = toUsers.map(user =>
    processMilestonesOnReferral(user._id),
  );

  const milestones = await Promise.all(milestonePromises);
  console.log("Processed Milestones:", milestones);
};

const getAffiliationDetailsByTier = async userId => {
  try {
    // Fetch all affiliations for the given user
    const affiliations = await AffiliationDetail.find({ userId }).populate(
      "fromUserId",
    );

    // Initialize response structure
    const response = {
      totalUsers: 0, // Total unique users across all tiers
      tierDetails: {}, // Tier-wise unique user breakdown
    };

    // Track unique users globally and per tier
    const uniqueUsersGlobal = new Set();

    // Process affiliations to calculate tier-wise unique users
    affiliations.forEach(affiliation => {
      // Track users globally
      uniqueUsersGlobal.add(affiliation.fromUserId._id.toString());

      // Initialize tier data if not already present
      if (!response.tierDetails[affiliation.tier]) {
        response.tierDetails[affiliation.tier] = new Set(); // Use Set to track unique users in this tier
      }

      // Add user to the tier-specific Set
      response.tierDetails[affiliation.tier].add(
        affiliation.fromUserId._id.toString(),
      );
    });

    // Convert tier-specific Sets to counts
    for (const tier in response.tierDetails) {
      response.tierDetails[tier] = {
        totalUsers: response.tierDetails[tier].size,
      };
    }

    // Add the total unique user count
    response.totalUsers = uniqueUsersGlobal.size;

    return response;
  } catch (error) {
    throw new Error(
      "Error fetching affiliation details by tier: " + error.message,
    );
  }
};

// Helper function to fetch affiliate users for a given list of user IDs
// const getAffiliateUsers = async userIds => {
//   return await User.find({
//     _id: {
//       $in: userIds,
//     },
//   }).select(
//     "_id firstName lastName userName email profilePic phoneNum companyName country state city affiliateDetails",
//   );
// };
const getAffiliateUsers = async userIds => {
  return await User.find({
    "affiliateDetails.affiliateUserId": { $in: userIds },
  }).select(
    "_id firstName lastName userName email profilePic phoneNum companyName country state city affiliateDetails",
  );
};
const calculateEarnings = async userId => {
  // Fetch all earnings from AffiliationDetail
  const earningsRecords = await AffiliationDetail.find({ userId });

  // Calculate the total earnings
  const totalEarnings = earningsRecords.reduce(
    (sum, record) => sum + record.amount,
    0,
  );

  // Fetch all payouts from PayoutDetail with isPaid: true
  const payoutRecords = await PayoutDetail.find({
    userId,
    isPaid: true,
  });

  // Calculate the total payouts
  const totalPayouts = payoutRecords.reduce(
    (sum, record) => sum + record.amount,
    0,
  );

  // Calculate remaining unpaid amount
  const remainingUnpaid = totalEarnings - totalPayouts;

  // Return the earnings object
  return {
    paidReferalls: totalEarnings,
    paidEarning: totalPayouts,
    unpaidEarning: remainingUnpaid,
  };
};
const processAffiliateCommissionLogic = async ({ userId, planId, isFirstOrder = false }) => {
  try {
    if (!userId) {
      throw new Error("User ID is required");
    }
    if (!planId) {
      throw new Error("Plan ID is required");
    }

    // Fetch the user and check affiliate status
    const user = await User.findById(userId);
    if (!user) {
      throw new Error("User not found");
    }

    if (user.affiliateDetails.isAffiliate) {
      return { success: false, message: "User is not an affiliate" };
    }
    if (user.affiliateDetails.affiliateUserId == null) {
      return { success: false, message: "User is not an affiliate" };
    }

    // Fetch the plan details
    const plan = await Plan.findById(planId);
    if (!plan) {
      throw new Error("Plan not found");
    }

    const planPrice = plan.price;

    // Commission percentages
    // const COMMISSION_TIERS = {
    //   tier1: user.commissionTiers?.tier1 ?? 0.1,
    //   tier2: user.commissionTiers?.tier2 ?? 0.05,
    //   tier3: user.commissionTiers?.tier3 ?? 0.03,
    //   tier4: user.commissionTiers?.tier4 ?? 0.02,
    // };

    const tier1User = await getAffiliateUsers([
      user.affiliateDetails.affiliateUserId,
    ]);
    if (tier1User) {
      const referralCount = await User.countDocuments({
        'affiliateDetails.affiliateUserId': tier1User._id,
      });
      let tier1Commission = 0.05;
      if (isFirstOrder) {
        tier1Commission = tier1User.commissionTiers?.tier1 ?? 0.1;
      } else {
        if (referralCount >= 500) {
          tier1Commission = 0.1;
        } else if (referralCount >= 200) {
          tier1Commission = 0.08;
        } else if (referralCount >= 50) {
          tier1Commission = 0.06;
        } else {
          tier1Commission = 0.05;
        }
      }
      await saveAffiliateDetails(
        userId,
        tier1User,
        planPrice,
        tier1Commission,
        1,
        planId,
      );
      const tier1UserIds = tier1User.map(
        user => user.affiliateDetails.affiliateUserId,
      );

      // const tier2Users = await getAffiliateUsers(tier1UserIds);
      // if (tier2Users.length > 0) {
      //   const tier2Commission = tier2Users.commissionTiers?.tier2 ?? 0.05;
      //   await saveAffiliateDetails(
      //     userId,
      //     tier2Users,
      //     planPrice,
      //     tier2Commission,
      //     2,
      //     planId,
      //   );
      //   const tier2UserIds = tier2Users.map(
      //     user => user.affiliateDetails.affiliateUserId,
      //   );

      //   const tier3Users = await getAffiliateUsers(tier2UserIds);
      //   if (tier3Users.length > 0) {
      //     const tier3Commission = tier3Users.commissionTiers?.tier3 ?? 0.03;
      //     await saveAffiliateDetails(
      //       userId,
      //       tier3Users,
      //       planPrice,
      //       tier3Commission,
      //       3,
      //       planId,
      //     );
      //     const tier3UserIds = tier3Users.map(
      //       user => user.affiliateDetails.affiliateUserId,
      //     );

      //     const tier4Users = await getAffiliateUsers(tier3UserIds);
      //     if (tier4Users.length > 0) {
      //       const tier4Commission = tier4Users.commissionTiers?.tier4 ?? 0.02;
      //       await saveAffiliateDetails(
      //         userId,
      //         tier4Users,
      //         planPrice,
      //         tier4Commission,
      //         4,
      //         planId,
      //       );
      //     }
      //   }
      // }
      user.affiliateDetails.isAffiliate = true;
      await user.save();
    }

    return { message: "Commission processed successfully" };
  } catch (error) {
    throw new Error(error.message || "Internal server error");
  }
};


// Function to fetch affiliation tiers
const getAffiliationTiers = async (req, res) => {
  console.log("getAffiliationTiers: Api");
  try {
    // Get userId from query or req.user object
    const userId = req.query.userId || req.user?._id;

    if (!userId) {
      return res.status(400).json({ error: "User ID is required" });
    }
    const affiliateUser = await User.findById(userId);

    // Tier 1
    // const tier1 = await getAffiliateUsers([
    //   affiliateUser.affiliateDetails.affiliateUserId,
    // ]);
    const tier1 = await getAffiliateUsers([affiliateUser._id]);

    const tier1UserIds = tier1.map(
      // user => user.affiliateDetails.affiliateUserId,
      user => user._id,
    );

    // Tier 2
    const tier2 = await getAffiliateUsers(tier1UserIds);
    const tier2UserIds = tier2.map(
      user => user._id,
      // user => user.affiliateDetails.affiliateUserId,
    );

    // Tier 3
    const tier3 = await getAffiliateUsers(tier2UserIds);
    const tier3UserIds = tier3.map(
      user => user._id,
      // user => user.affiliateDetails.affiliateUserId,
    );

    // Tier 4
    const tier4 = await getAffiliateUsers(tier3UserIds);

    // Sum of total users across all tiers
    const totalUsers =
      tier1.length + tier2.length + tier3.length + tier4.length;

    // Response with tiers and total user counts
    res.status(200).json({
      userId,
      totalUsers,
      tiers: {
        tier1,
        tier2,
        tier3,
        tier4,
      },
    });
  } catch (error) {
    console.error("Error fetching affiliation tiers:", error);
    res.status(500).json({ error: "Internal server error" });
  }
};


const processAffiliateCommission = async (req, res) => {
  console.log("processAffiliateCommission: Api");
  try {
    const { planId } = req.query;
    const userId = req.query.userId || req.user?._id;
    if (!userId) {
      return res.status(400).json({ error: "User ID is required" });
    }
    if (!planId) {
      return res.status(400).json({ error: "Plan ID is required" });
    }

    const result = await processAffiliateCommissionLogic({ userId, planId });

    res.status(200).json(result);
  } catch (error) {
    console.error("Error processing affiliate commission:", error);
    res.status(500).json({ error: error.message });
  }
};

const getAffiliationsUserList = async (req, res) => {
  try {
    const referrerId = req.user._id;
    // Find all users whose affiliateDetails.affiliateUserId matches referrerId
    const referredUsers = await User.find({
      'affiliateDetails.affiliateUserId': referrerId
    })
      .select('firstName lastName userName email created_at')  // only return fields you care about
      .lean();
    return res.status(200).json({
      success: true,
      count: referredUsers.length,
      data: referredUsers
    });
  } catch (err) {
    console.error('Error fetching referred users:', err);
    return res.status(500).json({
      success: false,
      message: 'Server error'
    });
  }
};

const getStatsAndEarnings = async (req, res) => {
  console.log("getStatsAndEarnings: Api");
  try {
    // Get the userId from query params or the authenticated user
    const userId = req.query.userId || req.user?._id;

    if (!userId) {
      return res.status(400).json({ error: "User ID is required" });
    }

    // Find Tier 1 users (users whose affiliateDetails.affiliateUserId is the current userId)
    const tier1Users = await User.find({
      "affiliateDetails.affiliateUserId": userId,
    });

    // Calculate total Tier 1 users
    const totalTier1Users = tier1Users.length;

    // Calculate how many of the Tier 1 users have isAffiliate set to true
    const affiliateUsersCount = tier1Users.filter(
      user => user.affiliateDetails.isAffiliate,
    ).length;

    // Calculate the percentage of affiliate users
    const percentage =
      totalTier1Users > 0 ? (affiliateUsersCount / totalTier1Users) * 100 : 0;

    // Performance object
    const performance = {
      referalls: totalTier1Users,
      referallsBuyPlain: affiliateUsersCount,
      conversionRate: percentage.toFixed(2), // Format percentage to two decimal places
    };

    const earnings = await calculateEarnings(userId);

    // Return response
    res.status(200).json({
      performance,
      earnings,
    });
  } catch (error) {
    console.error("Error fetching stats and earnings:", error);
    res.status(500).json({ error: "Internal server error" });
  }
};

const submitPayoutRequest = async (req, res) => {
  try {
    const userId = req.body.userId || req.user?._id;

    if (!userId) {
      return res.status(400).json({ error: "User ID is required" });
    }

    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({ error: "User not found." });
    }

    const {
      amount,
      cryptoCurrency,
      cryptoWallet,
      isAffiliatePayout,
      accountId,
      platform = "mt5",
    } = req.body;

    if (
      !amount ||
      !cryptoCurrency ||
      !cryptoWallet ||
      typeof isAffiliatePayout !== "boolean"
    ) {
      return res.status(400).json({
        error: "Amount, currency, isAffiliatePayout and wallet are required.",
      });
    }
    if (!isAffiliatePayout && !accountId) {
      return res.status(400).json({
        error: "AccountId is required for non-affiliate payouts.",
      });
    }

    if (amount < 100) {
      return res.status(400).json({
        error: "Amount should be greater or equal to $100 is required for payouts.",
      });
    }

    const orderAge = user.affiliateWithdrawalSetting?.orderAge || 14;
    const minWithdrawal = user.affiliateWithdrawalSetting?.minWithdrawal || 0;

   

    if (isAffiliatePayout) {
      const lastPayoutRequest = await PayoutDetail.findOne({ userId,
        isAffiliatePayout: true,
       }).sort({
        createdAt: -1,
      });
      if (lastPayoutRequest) {
        const lastRequestDate = new Date(lastPayoutRequest.createdAt);
        const currentDate = new Date();
        const diffInDays = Math.floor(
          (currentDate - lastRequestDate) / (1000 * 60 * 60 * 24)
        );

        if (diffInDays < orderAge) {
          return res.status(400).json({
            error: `You can request a payout only after ${orderAge} days from your last request. Please wait ${orderAge - diffInDays
              } more day(s).`,
          });
        }
      }
      const { unpaidEarning } = await calculateEarnings(userId);
      if (amount > unpaidEarning) {
        return res.status(400).json({
          error: "Requested amount exceeds the remaining unpaid earnings.",
        });
      }
      if (amount < minWithdrawal) {
        return res.status(400).json({
          error: `Minimum withdrawal amount is ${minWithdrawal}.`,
        });
      }
    } else {
      // Convert accountId to a number and then use it in your query
      const accountIdNumber = Number(accountId);
      const tradingAccount = await MT5.findOne({ login: accountIdNumber });

      if (!tradingAccount) {
        return res.status(404).json({ error: "Trading account not found." });
      }

      if (tradingAccount.state !== "Funded") {
        return res
          .status(400)
          .json({ error: "Trading account is not funded." });
      }

      // Get the payment plan associated with this trading account
      const paymentPlan = await Plan.findById(tradingAccount.plan);

      if (!paymentPlan) {
        return res.status(404).json({ error: "Payment plan not found." });
      }

      // Check for addOns payout frequency
      let payoutRequestDays;
      if (tradingAccount.addOns?.payout7Days) {
        // If addOns has payout7Days enabled, use 7 days
        payoutRequestDays = 7;
      } else {
        // Otherwise use the default from payment plan
        payoutRequestDays = parseInt(
          paymentPlan.fundingOptions?.funded?.payoutRequest || "14"
        );
      }
      // Check if enough days have passed since last payout for this specific account
      const lastAccountPayoutRequest = await PayoutDetail.findOne({
        userId,
        accountId,
        tradingPlatform: platform,
        isAffiliatePayout: false
      }).sort({ createdAt: -1 });

      if (lastAccountPayoutRequest) {
        const lastRequestDate = new Date(lastAccountPayoutRequest.createdAt);
        const currentDate = new Date();
        const diffInDays = Math.floor(
          (currentDate - lastRequestDate) / (1000 * 60 * 60 * 24)
        );

        if (diffInDays < payoutRequestDays) {
          return res.status(400).json({
            error: `You can request a payout for this account only after ${payoutRequestDays} days from your last request. Please wait ${payoutRequestDays - diffInDays
              } more day(s).`,
          });
        }
      }


      // Get the current payout count for this account (including the current request)
      const currentPayoutCount = (tradingAccount.payoutRequestCount || 0) + 1;
      // Calculate the profit split based on plan type and payout count
      let profitSplit = 0.5; // Default 50/50 split

      if (tradingAccount.addOns?.profitSplit) {
        // Use addOns profit split if available
        const addOnsProfitSplit = tradingAccount.addOns.profitSplit;
        const match = addOnsProfitSplit.match(/(\d+)\/\d+/);
        if (match && match[1]) {
          profitSplit = parseInt(match[1]) / 100;
        }
      } else {
        // Use plan-based progressive profit split logic
        if (paymentPlan.planType === "HFT") {
          // HFT: 50% -> 60% -> 70% -> 80% -> 90%
          if (currentPayoutCount === 1) {
            profitSplit = 0.50; // 50% for first payout
          } else if (currentPayoutCount === 2) {
            profitSplit = 0.60; // 60% for second payout
          } else if (currentPayoutCount === 3) {
            profitSplit = 0.70; // 70% for third payout
          } else if (currentPayoutCount === 4) {
            profitSplit = 0.80; // 80% for fourth payout
          } else {
            profitSplit = 0.90; // 90% for fifth payout and beyond
          }
        } else if (paymentPlan.planType === "2-step-Challenge") {
          // 2-step: 80% for first 3 payouts, then 95%
          if (currentPayoutCount <= 3) {
            profitSplit = 0.80; // 80% for first 3 payouts
          } else {
            profitSplit = 0.95; // 95% for 4th payout and beyond
          }
        } else {
          // Fallback to parsing the profitSplit string from payment plan
          const profitSplitString = paymentPlan.fundingOptions?.funded?.profitSplit;
          if (profitSplitString) {
            // Parse progressive split like "60/40->70/30->80/20->90/10"
            const splits = profitSplitString.split('->');
            const splitIndex = Math.min(currentPayoutCount - 1, splits.length - 1);
            const currentSplit = splits[splitIndex];
            const match = currentSplit.match(/(\d+)\/\d+/);
            if (match && match[1]) {
              profitSplit = parseInt(match[1]) / 100;
            }
          }
        }
      }

      // Validate the requested amount against available profit
      const maxAllowedAmount = tradingAccount.profit * profitSplit;

      if (amount > maxAllowedAmount) {
        return res.status(400).json({
          error: `Requested amount exceeds your available withdrawal amount of ${maxAllowedAmount.toFixed(2)} (${(profitSplit * 100).toFixed(0)}% of your ${tradingAccount.profit.toFixed(2)} profit)`,
        });
      }

      // Update the payout request count for this trading account
      await MT5.findByIdAndUpdate(tradingAccount._id, {
        $inc: { payoutRequestCount: 1 }
      });
    }

    const payoutRequest = new PayoutDetail({
      userId,
      amount,
      cryptoCurrency,
      cryptoWallet,
      isPaid: false,
      status: "Pending",
      isAffiliatePayout: isAffiliatePayout || false,
      accountId: !isAffiliatePayout ? accountId : null,
      tradingPlatform: !isAffiliatePayout ? platform : null,
    });

    await payoutRequest.save();

    if(!isAffiliatePayout) {
      await checkConsistencyRule(accountId, payoutRequest._id);
    }else{
           try {
                let emailData = {
                  to: user.email,
                  subject: "Your Payout Request Has Been Submitted",
                  htmlFile: "Affiliate-Payout-Request.html",
                  dynamicData: {
                    user: user.firstName,
                    requestedAmount: amount,
                  },
                };
                await sendEmail(emailData);
              } catch (error) {
                console.error("Error in sending email: ", error);
              }
    }

    res.status(201).json({
      message: "You will get confirmation email about this request.",
      payoutRequest,
    });
  } catch (error) {
    console.error("Error submitting payout request:", error);
    res.status(500).json({ error: "Internal server error" });
  }
};

const updateRequestStatus = async (req, res) => {
  console.log("updateRequestStatus: API called");

  const STATUS_OPTIONS = ["Approved", "Rejected"];
  if (!req.user || !req.user.manager) {
    return res.status(403).json({ error: "Access denied. Admins only." });
  }

  try {
    const { status, requestId, isSendEmail = "true", breachAccount = "false", note = "" } = req.body;

    // Validate requestId
    if (!requestId) {
      return res.status(400).json({ error: "requestId is required" });
    }

    // Validate status
    if (!STATUS_OPTIONS.includes(status)) {
      return res.status(400).json({
        error: `Invalid status. Use one of: ${STATUS_OPTIONS.join(", ")}`,
      });
    }

    // Update payout request
    const payoutRequest = await PayoutDetail.findByIdAndUpdate(
      requestId,
      {
        status,
        isPaid: status === "Approved", // Mark isPaid true if status is Approved
      },
      { new: true }, // Return the updated document
    );

    // Handle non-existent payout requests
    if (!payoutRequest) {
      return res.status(404).json({ error: "Payout request not found." });
    }

    if (note && note != "") {
      const user = await User.findByIdAndUpdate(
        payoutRequest.userId,
        {
          $push: { notes: { note } },
        },
        { new: true },
      );
    }

    if (!payoutRequest.isAffiliatePayout &&
      payoutRequest.tradingPlatform === "mt5" &&
      breachAccount == "true" &&
      status === "Rejected") {
      breachMT5(payoutRequest.accountId);
    }

    // Process non-affiliate payouts
    if (!payoutRequest.isAffiliatePayout && status === "Approved") {
      if (payoutRequest.tradingPlatform === "mt5") {
        try {
          const token = await fetchAuthToken();
          if (!token) {
            throw new Error("Authorization token is missing");
          }
          const login = parseInt(payoutRequest.accountId);
          const mtApiUrl = `${process.env.MT5_URL}/manager/reset_account/?login=${login}`;
          const res = await axios.get(mtApiUrl, {
            headers: {
              Authorization: `Bearer ${token}`,
            },
          });
        } catch (error) {
          console.error("Error upgrading MT5 account:", error.message);
          return res.status(500).json({ error: "Internal server error" });
        }
      }
    }

    // Send email for rejected payouts
    if (status === "Rejected" && isSendEmail == "true") {
      try {
        const user = await User.findById(payoutRequest.userId);

        if (user) {
          // Choose email template based on payout type
          const htmlFile = payoutRequest.isAffiliatePayout
            ? "Payout-Rejected.html"
            : "trader_payout___rejected.html";
          const dynamicDataTemp = payoutRequest.isAffiliatePayout
            ? {
              email: user.email,
              rejectionMessage: note,
            } : {
              user: user.firstName,
              login: payoutRequest.accountId,
              requestedAmount: payoutRequest.amount,
              rejectionMessage: note,
            }
          const emailData = {
            to: user.email,
            subject: payoutRequest.isAffiliatePayout
              ? "Affiliate Payout Rejected"
              : "Trader Payout Rejected",

            htmlFile: htmlFile,
            dynamicData: dynamicDataTemp,
          };
          await sendEmail(emailData);
        } else {
          console.warn(`User not found for userId ${payoutRequest.userId}`);
        }
      } catch (error) {
        console.error(
          `Error sending email for payout requestId ${requestId}:`,
          error.message,
        );
      }
    }

    // Send email for approved payouts
    if (status === "Approved" && isSendEmail == "true") {
      try {
        const user = await User.findById(payoutRequest.userId);

        if (user) {
          // Choose email template based on payout type
          const htmlFile = payoutRequest.isAffiliatePayout
            ? "Affiliate-Payout-Approved.html"
            : "trader_payout___approved.html";

          const subject = payoutRequest.isAffiliatePayout
            ? "Affiliate Payout Approved"
            : "Trader Payout Approved";
          const dynamicDataTemp = payoutRequest.isAffiliatePayout
            ? {
              email: user.email,
              amount: payoutRequest.amount,
            } : {
              user: user.firstName,
              login: payoutRequest.accountId,
              requestedAmount: payoutRequest.amount,
            }
          const emailData = {
            to: user.email,
            subject: subject,
            htmlFile: htmlFile,
            dynamicData: dynamicDataTemp,
          };
          await sendEmail(emailData);

          // Only assign certificate for affiliate payouts
          if (!payoutRequest.isAffiliatePayout) {
            try {
              const certificateAssign = await certificateController.assignCertificateToUser(
                "68432179b2955f0b194cef7a",   // certificateId
                user._id,                      // userId
                {
                  firstName: user.firstName,
                  lastName: user.lastName,
                  rewardAmount: payoutRequest.amount
                },                              // variableValues
                payoutRequest.accountId,       // accountId
                res
              );
            } catch (error) {
              console.warn(`Error while assigning certificate ${payoutRequest.userId}`);
            }
          }
        } else {
          console.warn(`User not found for userId ${payoutRequest.userId}`);
        }
      } catch (error) {
        console.error(
          `Error sending email for payout requestId ${requestId}:`,
          error.message,
        );
      }
    }

    res.status(200).json({
      message: `Payout request ${status} successfully.`,
      data: payoutRequest,
      success: true,
    });
  } catch (error) {
    console.error("Error updating payout request status:", error.message);
    res.status(500).json({ error: "Internal server error" });
  }
};

const getRequests = async (req, res) => {
  try {
    const { status, userId, page, limit, isAffiliatePayout, search } =
      req.query;
    // Validate query parameters
    if (status && !["Pending", "Approved", "Rejected"].includes(status)) {
      return res.status(400).json({
        error: "Invalid status. Use 'Pending', 'Approved', or 'Rejected'.",
      });
    }
    if (isAffiliatePayout && !["False", "True"].includes(isAffiliatePayout)) {
      return res.status(400).json({
        error: "Invalid isAffiliatePayout. Use 'True' or 'False'.",
      });
    }
    // Build the base query object
    let tempIsAffiliatePayout;
    const query = {};
    if (status) query.status = status;
    if (userId) query.userId = userId;
    if (isAffiliatePayout === "True") {
      query.isAffiliatePayout = true
    } else {
      query.isAffiliatePayout = false
    }

    // If search is provided, first find matching user IDs
    let matchingUserIds = [];
    if (search) {
      matchingUserIds = await User.find({
        $or: [
          { firstName: { $regex: search, $options: "i" } },
          { lastName: { $regex: search, $options: "i" } },
          { email: { $regex: search, $options: "i" } },
          { userName: { $regex: search, $options: "i" } },
        ],
      }).distinct("_id");

      // Add matching user IDs to the main query
      query.userId = { $in: matchingUserIds };
    }

    // Pagination
    const skip = page && limit ? (parseInt(page) - 1) * parseInt(limit) : 0;
    const limitValue = limit ? parseInt(limit) : 0;

    // Fetch data with proper query
    const requests = await PayoutDetail.find(query)
      .populate("userId", "firstName lastName email userName")
      .skip(skip)
      .limit(limitValue);

    // Count total documents
    const totalRequests = await PayoutDetail.countDocuments(query);

    res.status(200).json({
      success: true,
      status: "success",
      message: "Requests fetched successfully.",
      totalRequests,
      pagination: {
        page: page ? parseInt(page) : null,
        limit: limit ? parseInt(limit) : null,
        totalWithdrawals: totalRequests,
        totalPages: limit ? Math.ceil(totalRequests / parseInt(limit)) : null,
      },
      data: requests,
    });
  } catch (error) {
    console.error("Error fetching requests:", error);
    res.status(500).json({ error: "Internal server error" });
  }
};

const getAffiliationLink = async (req, res) => {
  console.log("getAffiliationLink: Api");
  try {
    // Get userId from query or req.user object
    const userId = req.query.userId || req.user?._id;

    if (!userId) {
      return res.status(400).json({ error: "User ID is required" });
    }
    const affiliationLink = `${process.env.FRONTEND_BASE_URL
      }/auth/sign-up?ref=${encodeURIComponent(userId)}`;

    res.status(200).json({
      link: affiliationLink,
    });
  } catch (error) {
    console.error("Error fetching affiliation tiers:", error);
    res.status(500).json({ error: "Internal server error" });
  }
};

const getUserAffiliationDetails = async (req, res) => {
  const userId = req.query.userId || req.user?._id;

  try {
    // Fetch affiliation details using the service
    const affiliationDetails = await getAffiliationDetailsByTier(userId);

    // Respond with the result
    res.status(200).json({
      success: true,
      data: affiliationDetails,
    });
  } catch (error) {
    // Handle errors gracefully
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

const testProcessMilestones = async (req, res) => {
  const userId = req.query.userId || req.user?._id;

  try {
    // Call the milestone processing method
    const lastMilestone = await processMilestonesOnReferral(userId);

    if (lastMilestone) {
      return res.status(200).json({
        success: true,
        message: "Milestones processed successfully.",
        lastMilestone,
      });
    } else {
      return res.status(200).json({
        success: true,
        message: "No new milestone achieved.",
        lastMilestone: null,
      });
    }
  } catch (error) {
    console.error("Error in processing milestones:", error.message);

    return res.status(500).json({
      success: false,
      message: "Failed to process milestones.",
      error: error.message,
    });
  }
};

const getUserAchievements = async (req, res) => {
  const userId = req.query.userId || req.user?._id;

  try {
    // Fetch achievements for the user
    const achievements = await MilestoneAchievement.find({ userId }).sort({
      achievedAt: -1, // Sort by achievement date, newest first
    });

    if (achievements.length === 0) {
      return res.status(404).json({
        success: false,
        message: "No achievements found for this user.",
      });
    }

    return res.status(200).json({
      success: true,
      message: "User achievements retrieved successfully.",
      data: achievements,
    });
  } catch (error) {
    console.error("Error fetching user achievements:", error.message);
    return res.status(500).json({
      success: false,
      message: "Failed to retrieve user achievements.",
      error: error.message,
    });
  }
};

const getLeaderboard = async (req, res) => {
  try {
    const { limit = 10, page = 1 } = req.query; // Defaults: 10 items per page, first page

    // Aggregate leaderboard data
    const leaderboard = await MilestoneAchievement.aggregate([
      {
        $group: {
          _id: "$userId", // Group by user ID
          totalMilestones: { $sum: 1 }, // Count milestones achieved by the user
          highestRank: { $max: "$rank" }, // Get the highest rank achieved
        },
      },
      { $sort: { totalMilestones: -1, highestRank: 1 } }, // Sort by total milestones, then rank
      { $skip: (page - 1) * limit }, // Skip for pagination
      { $limit: parseInt(limit) }, // Limit for pagination
    ]);

    if (leaderboard.length === 0) {
      return res.status(404).json({
        success: false,
        message: "No leaderboard data available.",
      });
    }

    return res.status(200).json({
      success: true,
      message: "Leaderboard data retrieved successfully.",
      data: leaderboard,
    });
  } catch (error) {
    console.error("Error fetching leaderboard data:", error.message);
    return res.status(500).json({
      success: false,
      message: "Failed to retrieve leaderboard data.",
      error: error.message,
    });
  }
};

const updateCouponDiscount = async (req, res, next) => {
  try {
    const { couponId, discountPercentage } = req.body;

    if (!couponId || !discountPercentage) {
      return res.status(400).json({
        success: false,
        message: "Coupon ID and discount percentage are required.",
      });
    }

    const updatedCoupon = await Discount.findOneAndUpdate(
      { _id: couponId },
      { $set: { percentageOff: discountPercentage } },
      { new: true }
    );

    if (!updatedCoupon) {
      return res.status(404).json({
        success: false,
        message: "Coupon not found.",
      });
    }

    res.status(200).json({
      success: true,
      message: "Coupon discount updated successfully.",
      data: updatedCoupon,
    });
  } catch (error) {
    console.error("Error updating coupon discount:", error);
    res.status(500).json({ success: false, message: "Internal server error" });
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
        $graphLookup: {
          from: "users",
          startWith: "$_id",
          connectFromField: "_id",
          connectToField: "affiliateDetails.affiliateUserId",
          as: "referralTree",
          maxDepth: 3,
        },
      },
      {
        $addFields: {
          referralCount: { $size: "$referralTree" },
        },
      },
      { $match: searchFilter },
    ];

    if (hasLeader == "true") {
      aggregationPipeline.unshift({
        $match: { "affiliateDetails.affiliateUserId": { $ne: null } },
      })
    } else if (hasLeader == "false") {
      aggregationPipeline.unshift({
        $match: { "affiliateDetails.affiliateUserId": null },
      })
    }

    // Get the total count of users after applying the aggregation pipeline
    const totalUsers = await User.aggregate([
      ...aggregationPipeline,
      { $count: "totalUsers" },
    ]).then((result) => (result.length > 0 ? result[0].totalUsers : 0));

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

const getAllAffiliateUsersRaw = async (req, res) => {
  try {
    const { search = "", hasLeader = "all" } = req.query;

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
        $graphLookup: {
          from: "users",
          startWith: "$_id",
          connectFromField: "_id",
          connectToField: "affiliateDetails.affiliateUserId",
          as: "referralTree",
          maxDepth: 3,
        },
      },
      {
        $addFields: {
          referralCount: { $size: "$referralTree" },
        },
      },
      { $match: searchFilter },
    ];

    if (hasLeader === "true") {
      aggregationPipeline.unshift({
        $match: { "affiliateDetails.affiliateUserId": { $ne: null } },
      });
    } else if (hasLeader === "false") {
      aggregationPipeline.unshift({
        $match: { "affiliateDetails.affiliateUserId": null },
      });
    }

    const allAffiliateUsers = await User.aggregate(aggregationPipeline);

    res.status(200).json({
      success: true,
      data: allAffiliateUsers,
      totalUsers: allAffiliateUsers.length,
    });
  } catch (error) {
    console.error("Error fetching all affiliate users:", error);
    res.status(500).json({ success: false, message: "Internal server error" });
  }
};


const getSingleAffiliateUser = async (req, res, next) => {
  try {
    const { userId } = req.query;

    const user = await User.aggregate([
      {
        $match: { _id: new mongoose.Types.ObjectId(userId) },
      },
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
          tier: { $first: "$affiliations.tier" },
        },
      },
      {
        $lookup: {
          from: "discounts",
          localField: "couponId",
          foreignField: "_id",
          as: "discountDetails",
        },
      },
      {
        $addFields: {
          discountDetails: {
            $filter: {
              input: "$discountDetails",
              as: "discount",
              cond: { $gt: ["$$discount.expiration_date", new Date()] },
            },
          },
        },
      },
      {
        $addFields: {
          discount: { $first: "$discountDetails" },
        },
      },
      {
        $lookup: {
          from: "users",
          localField: "affiliateDetails.affiliateUserId",
          foreignField: "_id",
          as: "leaderUser",
        },
      },
      {
        $addFields: {
          leader: { $first: "$leaderUser" },
        },
      },
    ]);

    if (!user || user.length === 0) {
      return res.status(404).json({ success: false, message: "User not found" });
    }

    const affiliateUser = user[0];

    let rank;
    const referralCount = affiliateUser.referralCount;

    if (referralCount >= 10000) {
      rank = "Global Ambassador";
    } else if (referralCount >= 5000) {
      rank = "Network Champion";
    } else if (referralCount >= 1000) {
      rank = "Legendary Affiliate";
    } else if (referralCount >= 500) {
      rank = "Super Affiliate";
    } else if (referralCount >= 100) {
      rank = "Elite Affiliate";
    } else if (referralCount >= 50) {
      rank = "Pro Affiliate";
    } else {
      rank = "Rookie Affiliate";
    }

    affiliateUser.rank = rank;

    res.status(200).json({
      success: true,
      data: affiliateUser,
    });
  } catch (error) {
    console.error("Error fetching single affiliate user:", error);
    res.status(500).json({ success: false, message: "Internal server error" });
  }
};

const updateUserAffiliateSettings = async (req, res, next) => {
  try {
    const { userId } = req.params;
    const { commissionTiers, affiliateWithdrawalSetting } = req.body;

    if (!userId) {
      return res.status(400).json({
        success: false,
        message: "User ID is required.",
      });
    }

    if (!commissionTiers && !affiliateWithdrawalSetting) {
      return res.status(400).json({
        success: false,
        message: "At least one field (commissionTiers or affiliateWithdrawalSetting) is required.",
      });
    }

    const updateFields = {};
    if (commissionTiers) {
      updateFields["commissionTiers"] = commissionTiers;
    }
    if (affiliateWithdrawalSetting) {
      updateFields["affiliateWithdrawalSetting"] = affiliateWithdrawalSetting;
    }

    const updatedUser = await User.findByIdAndUpdate(
      userId,
      { $set: updateFields },
      { new: true }
    );

    if (!updatedUser) {
      return res.status(404).json({
        success: false,
        message: "User not found.",
      });
    }

    res.status(200).json({
      success: true,
      message: "User settings updated successfully.",
      data: updatedUser,
    });
  } catch (error) {
    console.error("Error updating user settings:", error);
    res.status(500).json({ success: false, message: "Internal server error" });
  }
};

const undoRejection = async (req, res) => {
  console.log("undoRejection: API called");

  if (!req.user || !req.user.manager) {
    return res.status(403).json({ error: "Access denied. Admins only." });
  }

  try {
    const { requestId } = req.body;

    if (!requestId) {
      return res.status(400).json({ error: "requestId is required" });
    }

    const payoutRequest = await PayoutDetail.findByIdAndUpdate(
      requestId,
      {
        status: "Pending",
      },
      { new: true },
    );

    res.status(200).json({
      message: `Payout request updated successfully.`,
      data: payoutRequest,
      success: true,
    });
  } catch (error) {
    console.error("Error updating payout request status:", error.message);
    res.status(500).json({ error: "Internal server error" });
  }
};

const changeAffiliate = async (req, res) => {
  console.log("changeAffiliate: Api");
  try {
    const { userId, newLeader } = req.body;

    if (!userId || !newLeader) {
      return res.status(400).json({ error: "User ID and new leader are required" });
    }

    const affiliateUser = await User.findById(userId).populate("affiliateDetails.affiliateUserId");
    if (!affiliateUser) {
      return res.status(404).json({ error: "Affiliate user not found" });
    }

    const prevLeader = affiliateUser.affiliateDetails.affiliateUserId;
    // if (!prevLeader) {
    //   return res.status(400).json({ error: "User has no previous leader" });
    // }

    const newLeaderUser = await User.findOne({ userName: newLeader });
    if (!newLeaderUser) {
      return res.status(404).json({ error: "User with this Username does not exists" });
    }

    if (prevLeader) {
      const tier1 = await getAffiliateUsers([affiliateUser._id]);

      await User.updateMany(
        { _id: { $in: tier1.map(user => user._id) } },
        { $set: { "affiliateDetails.affiliateUserId": prevLeader._id } }
      );
    }

    affiliateUser.affiliateDetails.affiliateUserId = newLeaderUser._id;
    await affiliateUser.save();

    res.status(200).json({ success: true, msg: "Leader updated successfully." });
  } catch (error) {
    console.error("Error changing affiliate leader:", error);
    res.status(500).json({ error: "Internal server error" });
  }
};

module.exports = {
  getAffiliationTiers,
  processAffiliateCommission,
  getAffiliationsUserList,
  getStatsAndEarnings,
  submitPayoutRequest,
  updateRequestStatus,
  getRequests,
  getAffiliationLink,
  processAffiliateCommissionLogic,
  getUserAffiliationDetails,
  processMilestonesOnReferral,
  testProcessMilestones,
  getUserAchievements,
  getLeaderboard,
  updateCouponDiscount,
  getAllAffiliateUsers,
  getSingleAffiliateUser,
  updateUserAffiliateSettings,
  undoRejection,
  changeAffiliate,
  getAllAffiliateUsersRaw
};
