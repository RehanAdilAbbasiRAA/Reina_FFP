const mongoose = require("mongoose");
const axios = require("axios");
const MT5CREDENTIALS = require("../models/MT5Credentials");
const PAYMENT = require("../models/Payment");
const CRYPTO_CHARGES = require("../models/cryptoCharge");

const fetchAuthToken = async () => {
  try {
    const authResponse = await axios.post(
      `https://apis.futurefunded.com/auth/token`,
      new URLSearchParams({
        username: process.env.ADMIN_USERNAME,
        password: process.env.ADMIN_PASSWORD,
      }),
      {
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
        },
      },
    );

    if (authResponse) {
      return authResponse.data.access_token;
    } else {
      throw new Error("Failed to fetch authorization token");
    }
  } catch (error) {
    console.error("Error fetching token:", error);
    throw error;
  }
};

const updateMt5CredentialsWebhook = async (req, res) => {
  const { userId, login } = req.body;

  // Validate input
  if (!userId || !login) {
    return res.status(400).json({ error: "userId and login are required" });
  }

  // Respond immediately to acknowledge receipt
  res.status(202).json({ message: "Webhook received and processing started" });

  // Asynchronously process the webhook
  try {
    const userIdObj = new mongoose.Types.ObjectId(userId);

    // Convert login to number if it is a string
    const loginToSearch = isNaN(login) ? login : Number(login);

    // Find the latest payment or crypto charge
    const latestPayment = await PAYMENT.findOne({ user: userIdObj }).sort({
      created_at: -1,
    });

    const latestCryptoCharge = await CRYPTO_CHARGES.findOne({
      userId: userIdObj,
    }).sort({
      created_at: -1,
    });

    let transactionReferenceId = null;
    let transactionType = null;

    if (latestPayment && latestCryptoCharge) {
      if (latestPayment.created_at > latestCryptoCharge.created_at) {
        transactionReferenceId = latestPayment._id;
        transactionType = "card_payment";
      } else {
        transactionReferenceId = latestCryptoCharge._id;
        transactionType = "crypto_payment";
      }
    } else if (latestPayment) {
      console.log("latestPayment", latestPayment);
      transactionReferenceId = latestPayment._id;
      transactionType = "card_payment";
    } else if (latestCryptoCharge) {
      transactionReferenceId = latestCryptoCharge._id;
      transactionType = "crypto_payment";
    }

    if (!transactionReferenceId || !transactionType) {
      console.warn("No payment or crypto charges found for the user");
      return;
    }

    console.log(transactionReferenceId, transactionType);
    // Update MT5 credentials document
    const updatedCredentials = await MT5CREDENTIALS.findOneAndUpdate(
      { user_id: userIdObj, login: loginToSearch }, // Search criteria
      { $set: { transactionReferenceId, transactionType } }, // Update operation
      { new: true }, // Return the updated document
    );
    console.log("user_id: ", userId, "login: ", loginToSearch);

    console.log("updateResult", updatedCredentials);

    if (!updatedCredentials) {
      console.warn("No matching MT5 credentials found to update");
      return;
    }

    console.log("MT5 credentials updated successfully", updatedCredentials);

    // Update mt5_credentials reference in the respective collection
    const updateTarget =
      transactionType === "card_payment" ? PAYMENT : CRYPTO_CHARGES;
    await updateTarget.findByIdAndUpdate(transactionReferenceId, {
      $set: { mt5Credentials: updatedCredentials._id },
    });

    console.log(
      `Updated mt5_credentials reference in ${transactionType} collection`,
    );
  } catch (error) {
    console.error("Error processing webhook:", error);
  }
};

const upgradeMT5Account = async login => {
  try {
    console.log("🚀 ~ upgradeMT5Account ~");
    const token = await fetchAuthToken();

    // Step 2: Use the token to create an MT5 account
    const mtApiUrl = `${process.env.MT5_URL}/manager/upgrade_account_phase_1/${login}`;
    const accountResponse = await axios.post(
      mtApiUrl,
      {},
      {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      },
    );

    if (accountResponse) {
      return {
        success: true,
        message: "MetaTrader account upgraded and saved successfully",
        data: accountResponse?.data.create_user_response?.login,
      };
    } else {
      // throw new Error("MetaTrader account creation failed");
      return {
        success: false,
        message: "MetaTrader account upgradation failed",
        data: null,
      };
    }
  } catch (error) {
    console.error("Error in upgradeMT5Account:", error);
    return {
      success: false,
      message: "MetaTrader account upgradation failed",
      data: null,
      error: error,
    };
    // throw error;
  }
};

module.exports = {
  updateMt5CredentialsWebhook,
  fetchAuthToken,
  upgradeMT5Account,
};
