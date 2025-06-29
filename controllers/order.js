const PAYMENT = require("../models/Payment");
const CRYPTO_CHARGE = require("../models/cryptoCharge");

const getAllOrders = async (req, res, next) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const pageSize = parseInt(req.query.pageSize) || 10;
    const skip = (page - 1) * pageSize;

    const pipeline = [
      {
        $project: {
          allFields: "$$ROOT",
          type: "card_payment",
        },
      },
      {
        $addFields: {
          "allFields.user": "$allFields.user",
        },
      },
      {
        $unionWith: {
          coll: "cryptocharges",
          pipeline: [
            {
              $project: {
                allFields: "$$ROOT",
                type: "crypto_payment",
              },
            },
            {
              $addFields: {
                "allFields.user": "$allFields.userId",
              },
            },
          ],
        },
      },
      {
        $lookup: {
          from: "users",
          let: { userId: "$allFields.user" },
          pipeline: [
            {
              $match: {
                $expr: {
                  $eq: ["$_id", "$$userId"],
                },
              },
            },
            {
              $project: {
                password: 0, // Exclude the password field
              },
            },
          ],
          as: "allFields.userInfo",
        },
      },
      {
        $unwind: {
          path: "$allFields.userInfo",
          preserveNullAndEmptyArrays: true,
        },
      },
      {
        $lookup: {
          from: "mt5_credentials",
          localField: "_id",
          foreignField: "transactionReferenceId",
          as: "allFields.mt5Credentials",
        },
      },
      {
        $match: {
          "allFields.mt5Credentials": { $ne: [] },
        },
      },
      {
        $replaceRoot: {
          newRoot: {
            $mergeObjects: ["$allFields", { type: "$type" }],
          },
        },
      },
      {
        $facet: {
          totalCount: [{ $count: "totalCount" }],
          paginatedResults: [
            { $sort: { created_at: -1 } },
            { $skip: skip },
            { $limit: pageSize },
          ],
        },
      },
    ];

    const result = await PAYMENT.aggregate(pipeline);

    const totalCount = result[0]?.totalCount[0]?.totalCount || 0;
    const orders = result[0]?.paginatedResults || [];

    return res.status(200).json({
      success: true,
      data: orders,
      count: orders.length,
      totalCount,
      currentPage: page,
      totalPages: Math.ceil(totalCount / pageSize),
    });
  } catch (error) {
    console.error(error);
    return res.status(500).json({
      success: false,
      message: "Internal Server Error",
    });
  }
};

module.exports = { getAllOrders };
