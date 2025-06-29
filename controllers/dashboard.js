const CryptoCharge = require("../models/cryptoCharge");
const Payment = require("../models/Payment");
const Withdrawal = require("../models/Withdrawal");
const PaymentPlan = require("../models/paymentPlans");
const moment = require("moment");
const calculateDateFilter = require("../utils/calculateDateFilter");
const { TIMEDURATION } = require("../constants/index.constants");
const PayoutDetail = require("../models/payoutDetail");
const User = require("../models/user");
const mongoose = require("mongoose");

const generateTimeline = (startDate, endDate, groupBy) => {
  const timeline = [];
  const currentDate = new Date(startDate);

  while (currentDate <= endDate) {
    let dateKey;
    if (groupBy === "hour") {
      dateKey = currentDate.toISOString().slice(0, 13).replace("T", "-");
    } else if (groupBy === "day") {
      dateKey = currentDate.toISOString().slice(0, 10);
    } else if (groupBy === "month") {
      dateKey = currentDate.toISOString().slice(0, 7);
    }

    timeline.push({ date: dateKey, count: 0, totalAmount: 0 });
    if (groupBy === "hour") {
      currentDate.setHours(currentDate.getHours() + 1);
    } else if (groupBy === "day") {
      currentDate.setDate(currentDate.getDate() + 1);
    } else if (groupBy === "month") {
      currentDate.setMonth(currentDate.getMonth() + 1);
    }
  }

  return timeline;
};

const mergeDataWithTimeline = (timeline, actualData, key) => {
  const dataMap = new Map(actualData.map(item => [item.date, item[key]]));

  return timeline.map(item => ({
    date: item.date,
    [key]: dataMap.has(item.date) ? dataMap.get(item.date) : 0,
  }));
};

const getSalesAndProfit = async (req, res) => {
  try {
    const startOfMonth = moment().startOf("month").toDate();
    const endOfMonth = moment().endOf("month").toDate();
    const startOfPrevMonth = moment()
      .subtract(1, "month")
      .startOf("month")
      .toDate();
    const endOfPrevMonth = moment()
      .subtract(1, "month")
      .endOf("month")
      .toDate();

    // Fetch all payment records with status "Approved"
    const cryptoPayment = await CryptoCharge.find({ status: "paid" });
    const cardPayment = await Payment.find({
      "chargeResponse.state": "COMPLETED",
    });

    // Total Count of All Sales
    const totalCount = cryptoPayment.length + cardPayment.length;

    // Total Revenue Calculations
    const totalCryptoCharges = cryptoPayment.reduce((sum, payment) => {
      const pricing =
        typeof payment?.amount_crypto === "string"
          ? parseFloat(payment?.amount_crypto.replace("$", ""))
          : payment?.amount_crypto || 0;
      return sum + pricing;
    }, 0);

    const totalCardCharges = cardPayment.reduce((sum, payment) => {
      const pricing = payment?.chargeResponse?.amount
        ? Number(payment?.chargeResponse?.amount)
        : 0;
      return sum + pricing;
    }, 0);

    const totalSale = (totalCryptoCharges + totalCardCharges).toFixed(2);

    // Monthly Revenue Calculation
    const monthlyCryptoPayments = cryptoPayment.filter(
      payment =>
        payment.created_at >= startOfMonth && payment.created_at <= endOfMonth,
    );

    const monthlyCardPayments = cardPayment.filter(
      payment =>
        payment.created_at >= startOfMonth && payment.created_at <= endOfMonth,
    );

    const monthlyCryptoTotalRevenue = monthlyCryptoPayments.reduce(
      (sum, payment) => {
        const pricing =
          typeof payment?.amount_crypto === "string"
            ? parseFloat(payment?.amount_crypto.replace("$", ""))
            : payment?.amount_crypto || 0;
        return sum + pricing;
      },
      0,
    );

    const monthlyCardTotalRevenue = monthlyCardPayments.reduce(
      (sum, payment) => {
        const pricing = payment?.chargeResponse?.amount
          ? Number(payment?.chargeResponse?.amount)
          : 0;
        return sum + pricing;
      },
      0,
    );

    const monthlyTotalRevenue = (
      monthlyCryptoTotalRevenue + monthlyCardTotalRevenue
    ).toFixed(2);
    const monthlyTotalSales =
      monthlyCryptoPayments.length + monthlyCardPayments.length;

    // Previous Monthly Revenue Calculation
    const previousMonthlyCryptoPayments = cryptoPayment.filter(
      payment =>
        payment.created_at >= startOfPrevMonth &&
        payment.created_at <= endOfPrevMonth,
    );

    const previousMonthlyCardPayments = cardPayment.filter(
      payment =>
        payment.created_at >= startOfPrevMonth &&
        payment.created_at <= endOfPrevMonth,
    );

    const previousMonthlyCryptoRevenue = previousMonthlyCryptoPayments.reduce(
      (sum, payment) => {
        const pricing =
          typeof payment?.amount_crypto === "string"
            ? parseFloat(payment?.amount_crypto.replace("$", ""))
            : payment?.amount_crypto || 0;
        return sum + pricing;
      },
      0,
    );

    const previousMonthlyCardRevenue = previousMonthlyCardPayments.reduce(
      (sum, payment) => {
        const pricing = payment?.chargeResponse?.amount
          ? Number(payment?.chargeResponse?.amount)
          : 0;
        return sum + pricing;
      },
      0,
    );

    const previousMonthlyTotalRevenue = (
      previousMonthlyCryptoRevenue + previousMonthlyCardRevenue
    ).toFixed(2);
    const previousMonthlyTotalSales =
      previousMonthlyCryptoPayments.length + previousMonthlyCardPayments.length;

    const salesDifference = monthlyTotalSales - previousMonthlyTotalSales;

    // Withdrawal Calculations
    const allWithdrawals = await Withdrawal.find();
    const totalWithdrawals = allWithdrawals
      .reduce((sum, withdrawal) => {
        const amount = parseFloat(withdrawal.withdrawalAmount) || 0;
        return sum + amount;
      }, 0)
      .toFixed(2);

    const comparedToPreviousMonth =
      monthlyTotalRevenue - previousMonthlyTotalRevenue;

    const monthlyWithdrawals = allWithdrawals.filter(
      withdrawal =>
        withdrawal.created_at >= startOfMonth &&
        withdrawal.created_at <= endOfMonth,
    );

    const monthlyTotalWithdrawals = monthlyWithdrawals
      .reduce((sum, withdrawal) => {
        const amount = parseFloat(withdrawal.withdrawalAmount) || 0;
        return sum + amount;
      }, 0)
      .toFixed(2);

    const overallTotalProfit = (totalSale - totalWithdrawals).toFixed(2);
    const monthlyTotalProfit = (
      monthlyTotalRevenue - monthlyTotalWithdrawals
    ).toFixed(2);

    // Respond with Calculated Data
    res.status(200).json({
      success: true,
      message: "Data fetched successfully",
      data: {
        totalCryptoCharges: parseFloat(totalCryptoCharges),
        totalCount,
        totalCardCharges: parseFloat(totalCardCharges),
        monthlyTotalRevenue: parseFloat(monthlyTotalRevenue),
        totalSale: parseFloat(totalSale),
        totalWithdrawals: parseFloat(totalWithdrawals),
        monthlyTotalWithdrawals: parseFloat(monthlyTotalWithdrawals),
        overallTotalProfit: parseFloat(overallTotalProfit),
        monthlyTotalProfit: parseFloat(monthlyTotalProfit),
        monthlyTotalSales,
        previousMonthlyTotalSales,
        comparedToPreviousMonth,
        salesDifference,
        previousMonthlyTotalRevenue: parseFloat(previousMonthlyTotalRevenue),
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

const getSalesGraph = async (req, res) => {
  try {
    const { timeDuration = "" } = req.query;
    console.log(req.query);

    // Default to 2 years if timeDuration is not provided
    const now = new Date();
    const defaultStartDate = new Date(now);
    defaultStartDate.setFullYear(now.getFullYear() - 2);

    const dateFilter = timeDuration
      ? calculateDateFilter(timeDuration)
      : { $gte: defaultStartDate, $lte: now };

    // Determine appropriate groupBy based on the time range
    let groupBy;
    if (timeDuration && timeDuration.startsWith("custom:")) {
      // For custom date ranges, determine groupBy based on the date difference
      const [_, startDateStr, endDateStr] = timeDuration.split(":");
      const startDate = new Date(startDateStr);
      const endDate = new Date(endDateStr);
      const daysDifference = Math.ceil(
        (endDate - startDate) / (1000 * 60 * 60 * 24),
      );

      if (daysDifference <= 2) {
        groupBy = "hour";
      } else if (daysDifference <= 60) {
        groupBy = "day";
      } else {
        groupBy = "month";
      }
    } else if (!timeDuration || timeDuration === TIMEDURATION.ONE_YEAR) {
      groupBy = "month";
    } else if (timeDuration === TIMEDURATION.ONE_DAY) {
      groupBy = "hour";
    } else {
      groupBy = "day";
    }

    const startDate = dateFilter ? new Date(dateFilter.$gte) : defaultStartDate;
    const endDate =
      dateFilter && dateFilter.$lte ? new Date(dateFilter.$lte) : now;
    const timeline = generateTimeline(startDate, endDate, groupBy);
    // Run all queries in parallel using Promise.all()
    const [userData, cardSalesData, cryptoSalesData] = await Promise.all([
      // Fetch User Registration Data
      User.aggregate([
        { $match: { created_at: dateFilter } },
        {
          $group: {
            _id: {
              $dateToString: {
                format:
                  groupBy === "hour"
                    ? "%Y-%m-%d-%H"
                    : groupBy === "day"
                      ? "%Y-%m-%d"
                      : "%Y-%m",
                date: "$created_at",
              },
            },
            count: { $sum: 1 },
          },
        },
        { $project: { date: "$_id", count: 1, _id: 0 } },
      ]),

      // Fetch Card Payments Data
      Payment.aggregate([
        {
          $match: {
            "chargeResponse.state": "COMPLETED",
            created_at: dateFilter,
          },
        },
        {
          $addFields: {
            sale: { $toDouble: "$chargeResponse.amount" },
            timestamp: "$created_at",
          },
        },
        {
          $group: {
            _id: {
              $dateToString: {
                format:
                  groupBy === "hour"
                    ? "%Y-%m-%d-%H"
                    : groupBy === "day"
                      ? "%Y-%m-%d"
                      : "%Y-%m",
                date: "$timestamp",
              },
            },
            totalAmount: { $sum: "$sale" },
          },
        },
        { $project: { date: "$_id", totalAmount: 1, _id: 0 } },
      ]),

      // Fetch Crypto Payments Data
      CryptoCharge.aggregate([
        { $match: { status: "paid", createdAt: dateFilter } },
        {
          $addFields: {
            sale: { $toDouble: "$amount_crypto" },
            timestamp: "$createdAt",
          },
        },
        {
          $group: {
            _id: {
              $dateToString: {
                format:
                  groupBy === "hour"
                    ? "%Y-%m-%d-%H"
                    : groupBy === "day"
                      ? "%Y-%m-%d"
                      : "%Y-%m",
                date: "$timestamp",
              },
            },
            totalAmount: { $sum: "$sale" },
          },
        },
        { $project: { date: "$_id", totalAmount: 1, _id: 0 } },
      ]),
    ]);

    // Merge Card and Crypto Payments
    const mergedSalesData = [...cardSalesData, ...cryptoSalesData];

    // Aggregate merged sales data
    const finalSalesData = mergedSalesData.reduce((acc, data) => {
      const existing = acc.find(item => item.date === data.date);
      if (existing) {
        existing.totalAmount += data.totalAmount;
      } else {
        acc.push({ date: data.date, totalAmount: data.totalAmount });
      }
      return acc;
    }, []);

    const userTimeline = mergeDataWithTimeline(timeline, userData, "count");
    const salesTimeline = mergeDataWithTimeline(
      timeline,
      finalSalesData,
      "totalAmount",
    );

    res.status(200).json({
      success: true,
      data: { resultSales: salesTimeline, resultUsers: userTimeline },
    });
  } catch (error) {
    console.error("Error fetching sales data:", error);
    res.status(500).json({ error: "Failed to fetch sales data" });
  }
};

// const getSalesGraph = async (req, res) => {
//   try {
//     const { timeDuration } = req.query;

//     const dateFilter = calculateDateFilter(timeDuration);

//     const salesPipeline = [
//       {
//         $match: {
//           "chargeResponse.status": "CAPTURED",
//         },
//       },
//       {
//         $addFields: {
//           sale: {
//             $toDouble: "$chargeResponse.amount",
//           },
//           timestamp: "$created_at",
//         },
//       },
//       {
//         $project: {
//           allFields: "$$ROOT",
//           type: "payment",
//           timestamp: "$timestamp",
//         },
//       },
//       {
//         $unionWith: {
//           coll: "cryptocharges",
//           pipeline: [
//             {
//               $match: {
//                 status: "paid",
//               },
//             },
//             {
//               $addFields: {
//                 sale: { $toDouble: "$amount_crypto" },
//                 timestamp: "$created_at",
//               },
//             },
//             {
//               $project: {
//                 allFields: "$$ROOT",
//                 type: "cryptocharge",
//                 timestamp: "$timestamp",
//               },
//             },
//           ],
//         },
//       },
//       {
//         $replaceRoot: {
//           newRoot: {
//             $mergeObjects: [
//               "$allFields",
//               {
//                 type: "$type",
//                 timestamp: "$timestamp",
//               },
//             ],
//           },
//         },
//       },
//       {
//         $match: {
//           timestamp: { $exists: true, $ne: null },
//         },
//       },

//       // Match by date filter if applicable
//       ...(dateFilter ? [{ $match: { created_at: dateFilter } }] : []),

//       // Project final fields
//       {
//         $project: {
//           _id: 0,
//           sale: 1,
//           timestamp: 1,
//         },
//       },

//       // Sort by creation date in descending order
//       { $sort: { timestamp: -1 } },
//     ];

//     // Execute the aggregation pipeline
//     const result = await Payment.aggregate(salesPipeline);

//     // Send the response
//     res.status(200).json({ success: true, data: result });
//   } catch (error) {
//     console.error("Error fetching sales data:", error);
//     res.status(500).json({ error: "Failed to fetch sales data" });
//   }
// };

const getTopSellingPlans = async (req, res) => {
  try {
    const allPlans = await mongoose.model("PaymentPlan").find({});
    if (!allPlans.length) {
      return res.status(200).json({
        success: true,
        data: {
          plans: [],
          monthPlans: [],
        },
      });
    }

    const formatCurrency = amount => {
      return new Intl.NumberFormat("en-US", {
        style: "currency",
        currency: "USD",
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      }).format(amount || 0);
    };

    const currentMonthStart = moment().startOf("month").toDate();
    const currentMonthEnd = moment().endOf("month").toDate();

    const processCardPayments = async (matchCriteria = {}) => {
      return await mongoose.model("Payment").aggregate([
        {
          $match: {
            $or: [
              { "chargeResponse.state": "COMPLETED" },
              { status: { $in: ["completed", "Approved"] } },
            ],
            ...matchCriteria,
          },
        },
        {
          $addFields: {
            planId: {
              $cond: [
                { $ifNull: ["$paymentPlan", false] },
                "$paymentPlan",
                {
                  $cond: [
                    {
                      $ifNull: [
                        "$chargeResponse.additionalParameters.planId",
                        false,
                      ],
                    },
                    {
                      $toObjectId:
                        "$chargeResponse.additionalParameters.planId",
                    },
                    null,
                  ],
                },
              ],
            },
            amount: {
              $cond: [
                { $ifNull: ["$amountPaid", false] },
                { $toDouble: "$amountPaid" },
                { $ifNull: [{ $toDouble: "$chargeResponse.amount" }, 0] },
              ],
            },
          },
        },
        { $match: { planId: { $ne: null } } },
        {
          $lookup: {
            from: "paymentplans",
            localField: "planId",
            foreignField: "_id",
            as: "planDetails",
          },
        },
        { $unwind: "$planDetails" },
        {
          $group: {
            _id: "$planDetails._id",
            planType: { $first: "$planDetails.planType" },
            accountSize: { $first: "$planDetails.accountSize" },
            totalSales: { $sum: 1 },
            totalRevenue: { $sum: "$amount" },
          },
        },
      ]);
    };

    const processCryptoPayments = async (matchCriteria = {}) => {
      return await mongoose.model("CryptoCharge").aggregate([
        {
          $match: {
            status: { $in: ["paid", "completed", "Approved"] },
            ...matchCriteria,
          },
        },
        { $match: { paymentPlan: { $ne: null } } },
        {
          $lookup: {
            from: "paymentplans",
            localField: "paymentPlan",
            foreignField: "_id",
            as: "planDetails",
          },
        },
        { $unwind: "$planDetails" },
        {
          $group: {
            _id: "$planDetails._id",
            planType: { $first: "$planDetails.planType" },
            accountSize: { $first: "$planDetails.accountSize" },
            totalSales: { $sum: 1 },
            totalRevenue: {
              $sum: {
                $cond: [
                  { $ifNull: ["$amountPaid", false] },
                  { $toDouble: "$amountPaid" },
                  { $ifNull: [{ $toDouble: "$amount_crypto" }, 0] },
                ],
              },
            },
          },
        },
      ]);
    };

    const [
      allTimeCardPayments,
      allTimeCryptoPayments,
      monthlyCardPayments,
      monthlyCryptoPayments,
    ] = await Promise.all([
      processCardPayments(),
      processCryptoPayments(),
      processCardPayments({
        created_at: {
          $gte: currentMonthStart,
          $lte: currentMonthEnd,
        },
      }),
      processCryptoPayments({
        created_at: {
          $gte: currentMonthStart,
          $lte: currentMonthEnd,
        },
      }),
    ]);

    const combineResults = (cardResults, cryptoResults) => {
      const combined = [...cardResults, ...cryptoResults].reduce(
        (acc, curr) => {
          const existing = acc.find(item => item._id.equals(curr._id));
          if (existing) {
            existing.totalSales += curr.totalSales;
            existing.totalRevenue += curr.totalRevenue;
          } else {
            acc.push(curr);
          }
          return acc;
        },
        [],
      );

      return allPlans.map(plan => {
        const salesData = combined.find(p => p._id.equals(plan._id)) || {
          _id: plan._id,
          planType: plan.planType,
          accountSize: plan.accountSize,
          totalSales: 0,
          totalRevenue: 0,
        };
        return {
          ...plan.toObject(),
          ...salesData,
        };
      });
    };

    const allPlansWithSales = combineResults(
      allTimeCardPayments,
      allTimeCryptoPayments,
    );
    const allPlansWithSalesMonth = combineResults(
      monthlyCardPayments,
      monthlyCryptoPayments,
    );

    const sortedPlans = [...allPlansWithSales].sort(
      (a, b) => b.totalSales - a.totalSales,
    );
    const sortedPlansMonth = [...allPlansWithSalesMonth].sort(
      (a, b) => b.totalSales - a.totalSales,
    );

    const formatResponse = plans =>
      plans.map(p => ({
        _id: p._id,
        planType: p.planType,
        accountSize: p.accountSize,
        totalSales: p.totalSales,
        totalRevenue: p.totalRevenue,
        plan: `${p.planType} (${p.accountSize})`,
        tx: p.totalSales.toString(),
        revenueGenerated: formatCurrency(p.totalRevenue),
      }));

    res.status(200).json({
      success: true,
      data: {
        plans: formatResponse(sortedPlans),
        monthPlans: formatResponse(sortedPlansMonth),
      },
    });
  } catch (error) {
    console.error("Error in getTopSellingPlans:", error);
    res.status(500).json({
      success: false,
      error: "Failed to fetch top selling plans",
      details: error.message,
    });
  }
};

const getPayoutGraph = async (req, res) => {
  try {
    const { timeDuration = "" } = req.query;

    const now = new Date();
    const defaultStartDate = new Date(now);
    defaultStartDate.setFullYear(now.getFullYear() - 2);

    const dateFilter = timeDuration
      ? calculateDateFilter(timeDuration)
      : { $gte: defaultStartDate, $lte: now };

    let groupBy;
    if (!timeDuration || timeDuration === TIMEDURATION.ONE_YEAR) {
      groupBy = "month";
    } else if (timeDuration === TIMEDURATION.ONE_DAY) {
      groupBy = "hour";
    } else {
      groupBy = "day";
    }

    const startDate = dateFilter ? new Date(dateFilter.$gte) : defaultStartDate;
    const timeline = generateTimeline(startDate, now, groupBy);

    const [approvedPayouts, cardSalesData, cryptoSalesData] = await Promise.all(
      [
        PayoutDetail.aggregate([
          { $match: { status: "Approved", created_at: dateFilter } },
          {
            $group: {
              _id: {
                $dateToString: {
                  format:
                    groupBy === "hour"
                      ? "%Y-%m-%d-%H"
                      : groupBy === "day"
                        ? "%Y-%m-%d"
                        : "%Y-%m",
                  date: "$created_at",
                },
              },
              totalPayout: { $sum: "$amount" },
            },
          },
          { $project: { date: "$_id", totalPayout: 1, _id: 0 } },
        ]),

        Payment.aggregate([
          {
            $match: {
              "chargeResponse.state": "COMPLETED",
              created_at: dateFilter,
            },
          },
          {
            $addFields: {
              saleAmount: {
                $cond: [
                  { $ifNull: ["$chargeResponse.amount", false] },
                  { $toDouble: "$chargeResponse.amount" },
                  {
                    $cond: [
                      { $gt: ["$priceAfterDiscount", 0] },
                      "$priceAfterDiscount",
                      "$priceOfPlan",
                    ],
                  },
                ],
              },
            },
          },
          {
            $group: {
              _id: {
                $dateToString: {
                  format:
                    groupBy === "hour"
                      ? "%Y-%m-%d-%H"
                      : groupBy === "day"
                        ? "%Y-%m-%d"
                        : "%Y-%m",
                  date: "$created_at",
                },
              },
              totalAmount: { $sum: "$saleAmount" },
            },
          },
          { $project: { date: "$_id", totalAmount: 1, _id: 0 } },
        ]),

        CryptoCharge.aggregate([
          { $match: { status: "paid", created_at: dateFilter } },
          {
            $addFields: {
              sale: { $toDouble: "$amount_crypto" },
              timestamp: "$created_at",
            },
          },
          {
            $group: {
              _id: {
                $dateToString: {
                  format:
                    groupBy === "hour"
                      ? "%Y-%m-%d-%H"
                      : groupBy === "day"
                        ? "%Y-%m-%d"
                        : "%Y-%m",
                  date: "$timestamp",
                },
              },
              totalAmount: { $sum: "$sale" },
            },
          },
          { $project: { date: "$_id", totalAmount: 1, _id: 0 } },
        ]),
      ],
    );

    const mergedSalesData = [...cardSalesData, ...cryptoSalesData];

    const finalSalesData = mergedSalesData.reduce((acc, data) => {
      const existing = acc.find(item => item.date === data.date);
      if (existing) {
        existing.totalAmount += data.totalAmount;
      } else {
        acc.push({ date: data.date, totalAmount: data.totalAmount });
      }
      return acc;
    }, []);

    const payoutTimeline = mergeDataWithTimeline(
      timeline,
      approvedPayouts,
      "totalPayout",
    );
    const salesTimeline = mergeDataWithTimeline(
      timeline,
      finalSalesData,
      "totalAmount",
    );

    res.status(200).json({
      success: true,
      data: { resultSales: salesTimeline, resultPayouts: payoutTimeline },
    });
  } catch (error) {
    console.error("Error fetching payout data:", error);
    res.status(500).json({ error: "Failed to fetch payout data" });
  }
};

const getLatestAffiliates = async (req, res) => {
  try {
    const { page = 1, search = "" } = req.query; // Default page to 1 and search to an empty string if not provided.

    // Construct the search filter
    const searchFilter = search
      ? {
          $or: [
            { firstName: { $regex: search, $options: "i" } }, // Case-insensitive search on firstName
            { lastName: { $regex: search, $options: "i" } }, // Case-insensitive search on lastName
          ],
        }
      : {};

    // Combine filters
    const filters = {
      isReferredUser: true,
      twofaVerified: true,
      ...searchFilter,
    };

    // Define the aggregation pipeline
    const pipeline = [
      {
        $match: filters,
      },
      {
        $lookup: {
          from: "userreferrals", // The name of the collection to join with
          localField: "_id", // The field from the `User` collection
          foreignField: "referrerID", // The field from the `userreferrals` collection
          as: "referrals", // The alias for the joined data
        },
      },
      {
        $match: {
          "referrals.0": { $exists: true }, // Ensure referrals array is not empty
        },
      },
      {
        $unwind: "$referrals", // Deconstruct the referrals array
      },
      {
        $lookup: {
          from: "users", // Join with the 'users' collection
          localField: "referrals.referredUserID", // The field in the referral that contains user IDs
          foreignField: "_id", // The field in the 'users' collection to match the user ID
          as: "referredUserDetails", // Alias for the user details array
        },
      },
      {
        $project: {
          referrals: 0,
          password: 0,
          "referredUserDetails.password": 0, // Exclude the password field from the referredUserDetails
          "referredUserDetails.__v": 0, // Optionally, exclude the __v field as well
        },
      },
      {
        $skip: (page - 1) * 10, // Skip the appropriate number of documents for pagination
      },
      {
        $limit: 10, // Limit the results to 10 per page
      },
    ];

    // Count total documents matching the filters without the pagination
    const totalDocs = await User.aggregate([
      { $match: filters },
      {
        $lookup: {
          from: "userreferrals",
          localField: "_id",
          foreignField: "referrerID",
          as: "referrals",
        },
      },
      { $match: { "referrals.0": { $exists: true } } },
      { $count: "totalDocs" },
    ]);

    const totalPages = Math.ceil((totalDocs[0]?.totalDocs || 0) / 10);

    // Fetch the paginated and aggregated data
    const latestRegisteredAffiliates = await User.aggregate(pipeline);

    // Send response
    res.status(200).json({
      success: true,
      data: latestRegisteredAffiliates,
      pagination: {
        totalDocs: totalDocs[0]?.totalDocs || 0,
        totalPages,
        currentPage: parseInt(page, 10),
      },
    });
  } catch (error) {
    console.error("Error fetching latest affiliates:", error.message || error);
    res.status(500).json({ success: false, message: error.message });
  }
};

const enableDiscount = async (req, res) => {
  try {
    const { id } = req.params;

    const discount = await Discount.findById(id);
    if (!discount) {
      return res.status(404).json({ message: "Discount not found." });
    }

    discount.active = true;
    const updatedDiscount = await discount.save();

    return res.status(200).json({
      message: "Discount enabled successfully.",
      discount: updatedDiscount,
    });
  } catch (error) {
    console.error("Error updating discount:", error);
    return res.status(500).json({ message: "Server error" });
  }
};

const disableDiscount = async (req, res) => {
  try {
    const { id } = req.params;

    const discount = await Discount.findById(id);
    if (!discount) {
      return res.status(404).json({ message: "Discount not found." });
    }

    discount.active = false;
    const updatedDiscount = await discount.save();

    return res.status(200).json({
      message: "Discount disabled successfully.",
      discount: updatedDiscount,
    });
  } catch (error) {
    console.error("Error updating discount:", error);
    return res.status(500).json({ message: "Server error" });
  }
};

module.exports = {
  getSalesAndProfit,
  getSalesGraph,
  getTopSellingPlans,
  getPayoutGraph,
  getLatestAffiliates,
  enableDiscount,
  disableDiscount,
};
