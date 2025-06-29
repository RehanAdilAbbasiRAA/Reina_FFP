const crypto = require("crypto");
const Discount = require("../models/Discount");
const User = require("../models/user");

const generateUniqueCouponCode = async () => {
  let isUnique = false;
  let couponCode;

  // Loop until a unique coupon code is generated
  while (!isUnique) {
    couponCode = `DISCOUNT-${Math.random().toString(36).substring(2, 10).toUpperCase()}`;

    // Check if this couponCode already exists in the database
    const existingCode = await Discount.findOne({ couponCode });
    if (!existingCode) {
      isUnique = true; // Exit loop if the code is unique
    }
  }

  return couponCode;
};

const createCouponForUser = async userId => {
  try {
    // Validate if the userId is provided
    if (!userId) {
      throw new Error("User ID is required.");
    }

    // Check if the user exists
    const user = await User.findById(userId);
    if (!user) {
      throw new Error("User not found.");
    }

    // Check if a coupon already exists for this user
    const existingCoupon = await Discount.findOne({ userId });
    if (existingCoupon) {
      return {
        success: false,
        message: "A coupon already exists for this user.",
        coupon: existingCoupon,
      };
    }

    // Determine coupon code based on userName or generate unique code
    const couponCode = user?.userName
      ? user?.userName
      : await generateUniqueCouponCode();

    // Calculate expiration date (10 years from now)
    const expirationDate = new Date();
    expirationDate.setFullYear(expirationDate.getFullYear() + 10);

    // Create the discount document
    const discount = new Discount({
      name: "10% Discount",
      percentageOff: "10%",
      explanation: "This coupon provides a 10% discount.",
      expiration_date: expirationDate,
      couponCode,
      userId,
    });

    // Save the discount to the database
    const savedDiscount = await discount.save();

    // Save the coupon ID to the user's document
    user.couponId = savedDiscount._id;
    await user.save();

    // Return success response
    return {
      success: true,
      message: "Coupon created successfully.",
      coupon: savedDiscount,
    };
  } catch (error) {
    // Handle errors
    console.error(error);
    throw new Error(error.message || "Server error. Could not create coupon.");
  }
};

const createDiscount = async (req, res) => {
  try {
    const { name, percentageOff, description, expiration_date } = req.body;
    const userId = req.user._id;
    // Manual validation of required fields
    if (!name || typeof name !== "string" || name.trim() === "") {
      return res
        .status(400)
        .json({ message: "Name is required and must be a valid string." });
    }
    if (
      !description ||
      typeof description !== "string" ||
      description.trim() === ""
    ) {
      return res.status(400).json({
        message: "description is required and must be a valid string.",
      });
    }
    if (!expiration_date || isNaN(new Date(expiration_date))) {
      return res.status(400).json({
        message: "Expiration date is required and must be a valid date.",
      });
    }
    // Generate a unique coupon code
    const couponCode = await generateUniqueCouponCode();
    // Create the discount document
    const discount = new Discount({
      name: name.trim(),
      percentageOff: percentageOff,
      description: description.trim(),
      expiration_date: new Date(expiration_date),
      createdByManager: true,
      couponCode,
      userId,
    });

    // Save the discount to the database
    const savedDiscount = await discount.save();

    // Return success response
    res.status(201).json({
      message: "Discount created successfully.",
      discount: savedDiscount,
    });
  } catch (error) {
    // Handle errors
    console.error(error);
    res
      .status(500)
      .json({ message: "Server error. Could not create discount." });
  }
};

const getDiscounts = async (req, res) => {
  try {
    const { name, page = 1, limit = 10 } = req.query; // Default to page 1 and limit 10 if not provided
    const skip = (parseInt(page) - 1) * parseInt(limit);

    // Build match condition using regex for name search (case-insensitive)
    const matchCondition = {
      ...(name && { name: { $regex: new RegExp(name, "i") } }),
    };

    // Retrieve discounts based on match condition with pagination
    const discounts = await Discount.find(matchCondition)
      .skip(skip)
      .limit(parseInt(limit));

    // Get total count for the match condition
    const totalDiscounts = await Discount.countDocuments(matchCondition);

    return res.status(200).json({
      success: true,
      message: "Discounts retrieved successfully",
      data: discounts || [],
      page: parseInt(page),
      totalPages: Math.ceil(totalDiscounts / parseInt(limit)),
      totalCount: totalDiscounts,
    });
  } catch (error) {
    console.error("Error retrieving discounts:", error);
    return res.status(500).json({
      success: false,
      message: "Internal server error",
      error: error.message,
    });
  }
};

const deleteCouponCodeById = async (req, res) => {
  try {
    const { id } = req.query;

    if (!id) {
      return res.status(400).json({
        message: "Provide the id of the discount to delete.",
      });
    }
    const result = await Discount.findByIdAndDelete(id);

    if (!result) {
      return res.status(404).json({
        message: "No discount found with the specified id to delete.",
      });
    }
    return res.status(200).json({
      status: 200,
      message: "Discount deleted successfully.",
    });
  } catch (error) {
    console.error("Error deleting discount:", error);
    return res.status(500).json({ status: 500, message: "Server error" });
  }
};

const deleteCouponCodeByCode = async (req, res) => {
  try {
    const { couponCode } = req.body;
    const result = await Discount.findOneAndDelete({ couponCode: couponCode });

    if (!result) {
      return res.status(404).json({
        message: "No discount found with the specified coupon code to delete.",
      });
    }
    return res.status(200).json({
      status: 200,
      message: "Discount deleted successfully.",
    });
  } catch (error) {
    console.error("Error deleting discount:", error);
    return res.status(500).json({ status: 500, message: "Server error" });
  }
};

const validateCoupon = async (req, res) => {
  try {
    const { couponCode } = req.body;

    // Look for the discount by name
    const discount = await Discount.findOne({ couponCode: couponCode });

    // Check if discount exists and has not expired
    if (!discount || new Date() > new Date(discount.expiration_date)) {
      return res
        .status(404)
        .json({ message: "Invalid or expired coupon code" });
    }

    return res.status(200).json({
      success: true,
      message: "Coupon code is valid",
      data: discount,
    });
  } catch (error) {
    console.error("Error validating coupon code:", error);
    res.status(500).json({ message: "Server error" });
  }
};

const validateAffiliateCouponCode = async (req, res) => {
  try {
    const { affiliateCode } = req.body;
    // Find the user by ID
    const referralUser = await User.findOne({
      "referralCode.couponCode": affiliateCode,
    });

    if (referralUser) {
      return res.status(201).json({
        success: true,
        message: "Coupon code valid.",
        data: referralUser.referralCode,
      });
    }
    // Look for the discount by name
    const discount = await Discount.findOne({ couponCode: affiliateCode });
    if (discount && new Date() < new Date(discount.expiration_date)) {
      return res.status(200).json({
        success: true,
        message: "Coupon code is valid",
        data: discount,
      });
    }

    // Check if discount exists and has not expired
    if (
      !discount ||
      new Date() > new Date(discount.expiration_date) ||
      !referralUser
    ) {
      return res
        .status(404)
        .json({ message: "Invalid or expired coupon code" });
    }
  } catch (error) {
    console.error("Error creating referral coupon code:", error);
    return res.status(500).json({
      success: false,
      message: "An error occurred while creating the coupon code",
      error: error.message,
    });
  }
};

const generateCouponCode = () => {
  return crypto.randomBytes(3).toString("hex");
};

const createReferralCouponCode = async (req, res) => {
  try {
    // Ensure req.user is present
    if (!req.user || !req.user._id) {
      return res.status(400).json({
        success: false,
        message: "User not authenticated or invalid request",
      });
    }
    // Find the user by ID
    const user = await User.findById(req.user._id);
    if (!user) {
      return res.status(404).json({
        success: false,
        message: "User not found",
      });
    }

    // Check if the user already has a coupon code
    if (await user.referralCode.couponCode) {
      return res.status(409).json({
        success: false,
        message: "Coupon code already exists for this user",
        data: { couponCode: user.referralCode },
      });
    }
    // Generate the expiration date (100 years from now)
    const expirationDate = new Date();
    expirationDate.setFullYear(expirationDate.getFullYear() + 100);

    // Create referral code
    const referralCode = {
      name: "Referral Coupon Code",
      couponCode: generateCouponCode(), // Generate your coupon code using a function
      percentageOff: 5,
      description: `This coupon gives a 5% discount generated by ${user.firstName}`,
      expiration_date: expirationDate, // Set the expiration date
    };

    // Assign the referral code to the user
    user.referralCode = referralCode;
    await user.save();

    return res.status(201).json({
      success: true,
      message: "Coupon code created successfully",
      data: { couponCode: user.referralCode },
    });
  } catch (error) {
    console.error("Error creating referral coupon code:", error);
    return res.status(500).json({
      success: false,
      message: "An error occurred while creating the coupon code",
      error: error.message,
    });
  }
};

const getReferralCouponCode = async (req, res) => {
  try {
    // Ensure req.user is present
    if (!req.user || !req.user._id) {
      return res.status(400).json({
        success: false,
        message: "User not authenticated or invalid request",
      });
    }

    // Find the user by ID
    const user = await User.findById(req.user._id);
    if (!user) {
      return res.status(404).json({
        success: false,
        message: "User not found",
      });
    }

    // Check if the user has a coupon code
    if (!user.referralCode || !user.referralCode.couponCode) {
      return res.status(404).json({
        success: false,
        message: "No coupon code found for this user",
      });
    }

    // Return the coupon code
    return res.status(200).json({
      success: true,
      message: "Coupon code fetched successfully",
      data: { couponCode: user.referralCode.couponCode },
    });
  } catch (error) {
    console.error("Error fetching referral coupon code:", error);
    return res.status(500).json({
      success: false,
      message: "An error occurred while fetching the coupon code",
      error: error.message,
    });
  }
};

const getUserCoupon = async (req, res) => {
  try {
    const userId = req.query.userId || req.user?._id;

    // Validate if the userId is provided
    if (!userId) {
      return res.status(400).json({ message: "User ID is required." });
    }

    // Check if the user exists
    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({ message: "User not found." });
    }

    // Find the coupon associated with the user
    const coupon = await Discount.findOne({ userId });
    if (!coupon) {
      return res
        .status(404)
        .json({ message: "No coupon found for this user." });
    }

    // Return the coupon details
    res.status(200).json({
      message: "Coupon retrieved successfully.",
      coupon,
    });
  } catch (error) {
    // Handle errors
    console.error(error);
    res
      .status(500)
      .json({ message: "Server error. Could not retrieve coupon." });
  }
};
const showAllCoupons = async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = 10;
    const skip = (page - 1) * limit;

    const coupons = await Discount.find()
      .sort({ created_at: -1 })
      .skip(skip)
      .limit(limit);

    const totalCoupons = await Discount.countDocuments(filter);

    return res.status(200).json({
      success: true,
      coupons,
      pagination: {
        currentPage: page,
        totalPages: Math.ceil(totalCoupons / limit),
        totalCoupons,
      },
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: "An error occurred while fetching coupon details",
      error: error.message,
    });
  }
};

const getDiscountsManager = async (req, res) => {
  try {
    const { name, page = 1, limit = 10, searchQuery, status } = req.query;
    const skip = (parseInt(page) - 1) * parseInt(limit);

    const userNames = await User.distinct("userName");

    // Handle search queries
    const searchMatch = searchQuery
      ? {
          $or: [
            { name: { $regex: new RegExp(searchQuery, "i") } },
            { couponCode: { $regex: new RegExp(searchQuery, "i") } },
          ],
        }
      : {};

    // Build match condition
    const matchCondition = {
      ...(name && { name: { $regex: new RegExp(name, "i") } }),
      couponCode: { $nin: userNames },
      ...searchMatch,
    };

    // Add status filter if provided
    if (status === "enabled") {
      matchCondition.active = true;
    } else if (status === "disabled") {
      matchCondition.active = false;
    }
    // If status is not provided or has any other value, return all discounts

    const discounts = await Discount.find(matchCondition)
      .skip(skip)
      .limit(parseInt(limit))
      .sort({ created_at: -1 });

    const totalDiscounts = await Discount.countDocuments(matchCondition);

    // Generate appropriate success message based on status
    let message = "Discounts retrieved successfully";
    if (status === "enabled") {
      message = "Active discounts retrieved successfully";
    } else if (status === "disabled") {
      message = "Non active discounts retrieved successfully";
    }

    return res.status(200).json({
      success: true,
      message,
      data: discounts || [],
      page: parseInt(page),
      totalPages: Math.ceil(totalDiscounts / parseInt(limit)),
      totalCount: totalDiscounts,
    });
  } catch (error) {
    console.error("Error retrieving discounts:", error);
    return res.status(500).json({
      success: false,
      message: "Internal server error",
      error: error.message,
    });
  }
};

const getAllDiscountsRaw = async (req, res) => {
  try {
    const { name, searchQuery, status } = req.query;

    const userNames = await User.distinct("userName");

    const searchMatch = searchQuery
      ? {
          $or: [
            { name: { $regex: new RegExp(searchQuery, "i") } },
            { couponCode: { $regex: new RegExp(searchQuery, "i") } },
          ],
        }
      : {};

    const matchCondition = {
      ...(name && { name: { $regex: new RegExp(name, "i") } }),
      couponCode: { $nin: userNames },
      ...searchMatch,
    };

    if (status === "enabled") {
      matchCondition.active = true;
    } else if (status === "disabled") {
      matchCondition.active = false;
    }

    const discounts = await Discount.find(matchCondition).sort({ created_at: -1 });

    return res.status(200).json({
      success: true,
      message: "All discounts retrieved successfully",
      data: discounts,
      totalCount: discounts.length,
    });
  } catch (error) {
    console.error("Error retrieving all discounts:", error);
    return res.status(500).json({
      success: false,
      message: "Internal server error",
      error: error.message,
    });
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

const updateDiscount = async (req, res) => {
  try {
    const { id } = req.params;
    const { start_date, expiration_date } = req.body;

    if (!expiration_date || isNaN(new Date(expiration_date))) {
      return res.status(400).json({
        message: "Expiration date is required and must be a valid date.",
      });
    }

    if (!start_date || isNaN(new Date(start_date))) {
      return res.status(400).json({
        message: "Start date is required and must be a valid date.",
      });
    }

    const discount = await Discount.findById(id);
    if (!discount) {
      return res.status(404).json({ message: "Discount not found." });
    }

    discount.start_date = new Date(start_date);
    discount.expiration_date = new Date(expiration_date);
    const updatedDiscount = await discount.save();

    return res.status(200).json({
      message: "Discount updated successfully.",
      discount: updatedDiscount,
    });
  } catch (error) {
    console.error("Error updating discount:", error);
    return res.status(500).json({ message: "Server error" });
  }
};

const createDiscountManager = async (req, res) => {
  try {
    const {
      code,
      name,
      start_date,
      expiration_date,
      explanation,
      selectedDiscountTypes,
      percentageOff,
      dollarAmount,
      maxTimes,
      usagePerClient,
      userId,
    } = req.body;

    // Validate required fields

    // Process percentageOff if provided: trim it and append "%" if missing.
    let formattedPercentageOff = percentageOff;
    if (formattedPercentageOff && typeof formattedPercentageOff === "string") {
      formattedPercentageOff = formattedPercentageOff.trim();
      if (!formattedPercentageOff.endsWith("%")) {
        formattedPercentageOff += "%";
      }
      // Validate that it's in the correct format (digits followed by '%')
      if (!/^\d+%$/.test(formattedPercentageOff)) {
        return res.status(400).json({
          message:
            "Percentage off must be a valid percentage string (e.g., '5%').",
        });
      }
    }

    // const couponCode = await generateUniqueCouponCode();
    const couponCode = code;

    const discount = new Discount({
      name: name.trim(),
      percentageOff: formattedPercentageOff,
      explanation,
      expiration_date: new Date(expiration_date),
      start_date: new Date(start_date),
      dollar_amount: dollarAmount,
      max_times_allowed: maxTimes,
      usage_per_client: usagePerClient,
      selectedDiscountTypes,
      couponCode,
      userId,
      used_by: [],
    });

    // Save the discount to the database
    const savedDiscount = await discount.save();

    // Return success response
    res.status(201).json({
      message: "Discount created successfully.",
      discount: savedDiscount,
    });
  } catch (error) {
    console.error(error);
    res
      .status(500)
      .json({ message: "Server error. Could not create discount." });
  }
};

module.exports = {
  createDiscount,
  getDiscounts,
  deleteCouponCodeById,
  validateCoupon,
  validateAffiliateCouponCode,
  createReferralCouponCode,
  getReferralCouponCode,
  getUserCoupon,
  deleteCouponCodeByCode,
  showAllCoupons,
  enableDiscount,
  disableDiscount,
  createCouponForUser,
  getDiscountsManager,
  updateDiscount,
  createDiscountManager,
  getAllDiscountsRaw,
  getAllDiscountsRaw
};
