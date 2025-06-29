const PaymentPlan = require("../models/paymentPlans");
const {
  createPaymentPlanSchema,
  updatePaymentPlanSchema,
} = require("../joiValidationSchemas/validationSchemas");
const axios = require("axios");

const createPaymentPlan = async (req, res) => {
  try {
    if (!req.user || req.user.manager === false) {
      return res.status(403).json({ message: "Access denied. Admins only." });
    }

    // ✅ Validate request data
    const { error, value } = createPaymentPlanSchema.validate(req.body, {
      abortEarly: false,
    });
    if (error) {
      return res.status(400).json({
        message: "Validation errors",
        errors: error.details.map(err => ({
          field: err.path.join("."),
          message: err.message,
        })),
      });
    }

    // ✅ Create and save the new payment plan
    const newPlan = new PaymentPlan(value);
    await newPlan.save();

    res
      .status(201)
      .json({ message: "Payment plan created successfully", plan: newPlan });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Failed to create payment plan",
      details: error.message,
    });
  }
};

const getPaymentPlan = async (req, res) => {
  try {
    const paymentPlan = await PaymentPlan.findById(req.params.id);

    if (!paymentPlan) {
      return res.status(404).json({
        success: false,
        message: "Payment plan not found",
      });
    }

    res.status(200).json({
      success: true,
      message: "Payment plan fetched successfully",
      data: paymentPlan,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Failed to fetch payment plan",
      details: error.message,
    });
  }
};

const getAllPaymentPlans = async (req, res) => {
  try {
    const paymentPlans = await PaymentPlan.find();

    res.status(200).json({
      success: true,
      message: "Payment plans fetched successfully",
      data: paymentPlans,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Failed to fetch payment plans",
      details: error.message,
    });
  }
};

const getCategoryBasedPaymentPlans = async (req, res) => {
  try {
    const allPlans = await PaymentPlan.find(
      {},
      { _id: 0, __v: 0, created_at: 0, updated_at: 0 },
    );
    const planTypeMap = {};
    allPlans.forEach(plan => {
      const {
        planType,
        accountSize,
        tradingPlatform,
        price,
        originalPrice,
        fundingOptions,
      } = plan.toObject();
      if (!planTypeMap[planType]) {
        planTypeMap[planType] = {
          planType,
          accountSizes: [],
        };
      }
      let sizeEntry = planTypeMap[planType].accountSizes.find(
        entry => entry.accountSize === accountSize,
      );
      if (!sizeEntry) {
        sizeEntry = {
          accountSize,
          price: price ? price.toString() : null,
          originalPrice,
          platforms: [],
          fundingOptions,
        };
        planTypeMap[planType].accountSizes.push(sizeEntry);
      }
      if (!sizeEntry.platforms.includes(tradingPlatform)) {
        sizeEntry.platforms.push(tradingPlatform);
      }
    });
    const finalResult = Object.values(planTypeMap);

    return res.status(200).json({
      success: true,
      data: finalResult,
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      error: error.message,
    });
  }
};

const getRequiredPaymentPlan = async (req, res) => {
  try {
    const { planType, accountSize, tradingPlatform } = req.body;

    // Validate required fields
    if (!planType || !accountSize || !tradingPlatform) {
      return res.status(400).json({
        success: false,
        message:
          "planType, accountSize, and tradingPlatform are required fields.",
      });
    }

    const paymentPlan = await PaymentPlan.findOne({
      planType,
      accountSize,
      tradingPlatform,
    });

    // If no plan is found, send a 404 error
    if (!paymentPlan) {
      return res.status(404).json({
        success: false,
        message: "Payment plan not found.",
      });
    }

    return res.status(200).json({
      success: true,
      message: "Payment plan fetched successfully",
      data: paymentPlan,
    });
  } catch (error) {
    console.error("Error fetching payment plan:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to fetch payment plan",
      details: error.message,
    });
  }
};

const searchPaymentPlans = async (req, res) => {
  try {
    const {
      search,
      tradingPlatform,
      planType,
      accountSize,
      minPrice,
      maxPrice,
      page,
      limit,
    } = req.query;

    // ✅ Build query object dynamically based on provided filters
    let query = {};

    // ✅ Apply regex-based search if `search` parameter is provided
    if (search) {
      query.$or = [
        { tradingPlatform: { $regex: search, $options: "i" } }, // Case-insensitive search
        { planType: { $regex: search, $options: "i" } },
        { ruleId: { $regex: search, $options: "i" } },
      ];
    }

    if (tradingPlatform) {
      query.tradingPlatform = { $regex: tradingPlatform, $options: "i" };
    }
    if (planType) {
      query.planType = { $regex: planType, $options: "i" };
    }
    if (accountSize) {
      query.accountSize = parseInt(accountSize);
    }
    if (minPrice && maxPrice) {
      query.price = { $gte: parseFloat(minPrice), $lte: parseFloat(maxPrice) };
    } else if (minPrice) {
      query.price = { $gte: parseFloat(minPrice) };
    } else if (maxPrice) {
      query.price = { $lte: parseFloat(maxPrice) };
    }

    // ✅ Pagination settings
    const pageNum = parseInt(page) || 1;
    const pageSize = parseInt(limit) || 10;
    const skip = (pageNum - 1) * pageSize;

    // ✅ Fetch results with filters and pagination
    const paymentPlans = await PaymentPlan.find(query)
      .skip(skip)
      .limit(pageSize);

    // ✅ Count total results for pagination
    const totalRecords = await PaymentPlan.countDocuments(query);

    res.status(200).json({
      message: "Payment plans retrieved successfully",
      totalRecords,
      page: pageNum,
      limit: pageSize,
      data: paymentPlans,
    });
  } catch (error) {
    res
      .status(500)
      .json({ message: "Internal server error", error: error.message });
  }
};

const updatePaymentPlan = async (req, res) => {
  try {
    if (!req.user || req.user.manager === false) {
      return res.status(403).json({ message: "Access denied. Admins only." });
    }
    const { id } = req.params;

    // ✅ Check if ID is provided
    if (!id) {
      return res.status(400).json({ message: "Payment plan ID is required" });
    }

    // ✅ Validate request data (All fields optional)
    const { error, value } = updatePaymentPlanSchema.validate(req.body, {
      abortEarly: false,
    });
    if (error) {
      return res.status(400).json({
        message: "Validation errors",
        errors: error.details.map(err => ({
          field: err.path.join("."),
          message: err.message,
        })),
      });
    }

    // ✅ Find the payment plan
    const paymentPlan = await PaymentPlan.findById(id);
    if (!paymentPlan) {
      return res.status(404).json({ message: "Payment plan not found" });
    }

    // ✅ Perform update
    const updatedPlan = await PaymentPlan.findByIdAndUpdate(id, value, {
      new: true,
    });

    res
      .status(200)
      .json({ message: "Payment plan updated successfully", updatedPlan });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Failed to update payment plan",
      details: error.message,
    });
  }
};

const deletePaymentPlan = async (req, res) => {
  try {
    if (!req.user || req.user.manager === false) {
      return res.status(403).json({ message: "Access denied. Admins only." });
    }
    const { id } = req.params;

    // ✅ Check if ID is provided
    if (!id) {
      return res.status(400).json({ message: "Payment plan ID is required" });
    }

    // ✅ Find and delete the payment plan
    const deletedPlan = await PaymentPlan.findByIdAndDelete(id);

    // ✅ Check if the plan was found and deleted
    if (!deletedPlan) {
      return res.status(404).json({ message: "Payment plan not found" });
    }

    res
      .status(200)
      .json({ message: "Payment plan deleted successfully", deletedPlan });
  } catch (error) {
    res
      .status(500)
      .json({ message: "Internal server error", error: error.message });
  }
};

const createChallengesForMatchTraderPlans = async (req, res) => {
  console.log("createChallengesForMatchTraderPlans: ");

  return res.status(200).json({
    message:
      "First Setup then used its for creating a challenge in match trader and update DB it accordingly",
  });
  try {
    const BROKER_API_URL =
      "https://broker-api-demo.match-trader.com/v1/prop/challenges";
    const AUTH_TOKEN = "2v7CWcCViyMjqh7Z5AO2HBouoOjGOeOyUOccJrygQZ8=";
    // ✅ Fetch only `matchTrader` plans from the database
    const plans = await PaymentPlan.find({
      tradingPlatform: "matchTrader",
      // accountSize: 5000,
      // planType: "1-step-Express",
    });
    console.log("plans: ", plans);

    if (!plans.length) {
      return res
        .status(404)
        .json({ message: "No payment plans found for MatchTrader." });
    }

    let results = [];
    let i = 1;

    // ✅ Loop through each plan and send a challenge request
    for (const plan of plans) {
      // ✅ Extract available phases
      const fundingOptions = plan.fundingOptions || {};
      const phaseSteps = [];

      if (fundingOptions.phase1) {
        phaseSteps.push({
          phaseStep: 1,
          phaseName: "Evaluation Phase",
          profitSplitPercentages: { broker: 20, trader: 80 },
          groupName: "testUSD", //`group-${plan.accountSize}-USD`,
          initialBalance: plan.accountSize,
          initialLeverage: parseFloat(
            fundingOptions.phase1.leverage.replace("1:", ""),
          ),
          tradingPeriod: 30,
          minimumTradingPeriod: fundingOptions.phase1.minTradingDays || 5,
          maxDailyLossPercentage: parseFloat(
            fundingOptions.phase1.maxDailyDrawdown.replace("%", ".0"),
          ),
          maxLossPercentage: parseFloat(
            fundingOptions.phase1.maxDrawdown.replace("%", ".0"),
          ),
          profitTargetPercentage: parseFloat(
            fundingOptions.phase1.profitTarget.replace("%", ".0"),
          ),
          maxDailyLossCalculationType: "INITIAL",
        });
      }

      if (fundingOptions.phase2) {
        phaseSteps.push({
          phaseStep: 2,
          phaseName: "Verification Phase",
          profitSplitPercentages: { broker: 20, trader: 80 },
          groupName: "testUSD", // `group-${plan.accountSize}-USD`,
          initialBalance: plan.accountSize,
          initialLeverage: parseFloat(
            fundingOptions.phase2.leverage.replace("1:", ""),
          ),
          tradingPeriod: 30,
          minimumTradingPeriod: fundingOptions.phase2.minTradingDays || 5,
          maxDailyLossPercentage: parseFloat(
            fundingOptions.phase2.maxDailyDrawdown.replace("%", ""),
          ),
          maxLossPercentage: parseFloat(
            fundingOptions.phase2.maxDrawdown.replace("%", ""),
          ),
          profitTargetPercentage: parseFloat(
            fundingOptions.phase2.profitTarget.replace("%", ""),
          ),
          maxDailyLossCalculationType: "INITIAL",
        });
      }

      if (fundingOptions.funded) {
        phaseSteps.push({
          phaseStep: phaseSteps.length + 1, // 3 if both phase1 and phase2 exist, otherwise 2
          phaseName: "Funded Phase",
          profitSplitPercentages: { broker: 20, trader: 80 },
          groupName: "testUSD", // `group-${plan.accountSize}-USD`,
          initialBalance: plan.accountSize,
          initialLeverage: parseFloat(
            fundingOptions.funded.leverage.replace("1:", ""),
          ),
          tradingPeriod: 1000,
          minimumTradingPeriod: fundingOptions.funded.minTradingDays || 5,
          maxDailyLossPercentage: parseFloat(
            fundingOptions.funded.maxDailyDrawdown.replace("%", ""),
          ),
          maxLossPercentage: parseFloat(
            fundingOptions.funded.maxDrawdown.replace("%", ""),
          ),
          profitTargetPercentage:
            fundingOptions.funded.profitTarget !== "-"
              ? parseFloat(fundingOptions.funded.profitTarget.replace("%", ""))
              : null,
          maxDailyLossCalculationType: "INITIAL",
        });
      }

      if (phaseSteps.length === 0) {
        console.log(
          `⚠️ Skipping ${plan.planType} - ${plan.accountSize} (No valid phase data)`,
        );
        continue;
      }

      const challengeData = {
        name: `challenge-${plan.planType}-${plan.accountSize}-${i}`,
        currency: "USD",
        description: `Challenge for ${plan.planType} - ${plan.accountSize}`,
        branchId: "5e6c932e-2e31-4d2e-aa00-a088d0d08bcc", //"d3318c30-8c90-4018-ac25-fe2d8444d77e",
        systemId: "8e9ed851-1e5e-479b-aa19-bade6a67d1d5",
        operationId: "7ad6e672-bff3-4519-be2b-5dc8ae612cfb",
        fee: plan.price,
        phases: phaseSteps,
      };
      console.log("challengeData: ", challengeData);

      try {
        // ✅ Send API request to create challenge
        const response = await axios.post(BROKER_API_URL, challengeData, {
          headers: {
            Authorization: AUTH_TOKEN,
            "Content-Type": "application/json",
          },
        });

        const challengeId = response.data.challengeId;
        console.log("response.data: ", response.data);
        console.log(
          `✅ Challenge created for ${plan.planType} - ${plan.accountSize}: ${challengeId}`,
        );

        // ✅ Update Payment Plan with the Challenge ID as `ruleId`
        await PaymentPlan.findByIdAndUpdate(plan._id, { ruleId: challengeId });

        // ✅ Store response in results array
        results.push({
          planType: plan.planType,
          accountSize: plan.accountSize,
          challengeId,
        });
      } catch (error) {
        console.error(
          `❌ Failed to create challenge for ${plan.planType} - ${plan.accountSize}`,
        );
        console.error(error.response ? error.response.data : error.message);

        // ✅ Store failure response in results
        results.push({
          planType: plan.planType,
          accountSize: plan.accountSize,
          error: error.response ? error.response.data : error.message,
        });
      }
      i++;
    }

    res.status(200).json({
      message: "Challenges processed successfully",
      results,
    });
  } catch (error) {
    res
      .status(500)
      .json({ message: "Internal server error", error: error.message });
  }
};

module.exports = {
  createPaymentPlan,
  getPaymentPlan,
  getAllPaymentPlans,
  updatePaymentPlan,
  deletePaymentPlan,
  searchPaymentPlans,
  createChallengesForMatchTraderPlans,
  getCategoryBasedPaymentPlans,
  getRequiredPaymentPlan,
};
