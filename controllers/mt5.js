const axios = require("axios");
const fetchAuthToken = async () => {
  try {
    const authResponse = await axios.post(
      `${process.env.MT5_URL}/auth/token`,
      new URLSearchParams({
        username: process.env.ADMIN_USERNAME,
        password: process.env.ADMIN_PASSWORD
      }),
      {
        headers: {
          "Content-Type": "application/x-www-form-urlencoded"
        }
      }
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


// Reusable function to create an MT5 account
// const handleMT5AccountCreation = async (userId, plan, addOns=null) => {
//   try {
//     // Fetch authorization token
//     const token = await fetchAuthToken();
//     if (!token) {
//       throw new Error("Authorization token is missing");
//     }
//     // Construct API URL
//     let mtApiUrl;
//     if(addOns !== null){
//       if (addOns.profitSplit){
//         mtApiUrl = `${process.env.MT5_URL}/user_v3/create-account/?user_id=${userId}&plan=${plan}&workingDaysAddOn=${addOns.payout7Days}&profit_split=${encodeURIComponent(addOns.profitSplit)}&EA_add_on=${addOns.eAAllowed}`;
//       }else{
//         mtApiUrl = `${process.env.MT5_URL}/user_v3/create-account/?user_id=${userId}&plan=${plan}&workingDaysAddOn=${addOns.payout7Days}&EA_add_on=${addOns.eAAllowed}`;
//       }
//     }else{
//       mtApiUrl = `${process.env.MT5_URL}/user_v3/create-account/?user_id=${userId}&plan=${plan}`;
//     }
   
//     // Attempt to create account via API
//     const accountResponse = await axios.post(
//       mtApiUrl,
//       {},
//       {
//         headers: {
//           Authorization: `Bearer ${token}`,
//         },
//       },
//     );
//     // If the response status is not 200, throw an error
//     if (accountResponse.status !== 200) {
//       console.error(
//         "MetaTrader account creation failed with status:",
//         accountResponse.status,
//       );
//       throw new Error("MetaTrader account creation failed");
//     }
//     const accountData = accountResponse.data;
//     return accountData;
//   } catch (error) {
//     // Log and throw the error for further handling by the caller
//     console.error("Error in handleMT5AccountCreation:", error.message);
//     throw error;
//   }
// };



const handleMT5AccountCreation = async (userId, plan, addOns = null) => {
  try {
    // Fetch authorization token
    const token = await fetchAuthToken();
    if (!token) {
      throw new Error("Authorization token is missing");
    }

    // Base URL and required query params
    const baseUrl = `${process.env.MT5_URL}/user_v3/create-account/`;
    const queryParams = [
      `user_id=${encodeURIComponent(userId)}`,
      `plan=${encodeURIComponent(plan)}`
    ];

    // Append addOns fields if they exist
    if (addOns) {
      if (typeof addOns.payout7Days === "boolean") {
        queryParams.push(`workingDaysAddOn=${addOns.payout7Days}`);
      }
      if (typeof addOns.profitSplit === "string" && addOns.profitSplit.trim() !== "") {
        queryParams.push(`profit_split=${encodeURIComponent(addOns.profitSplit)}`);
      }
      if (typeof addOns.eAAllowed === "boolean") {
        queryParams.push(`EA_add_on=${addOns.eAAllowed}`);
      }
    }

    // Construct full URL
    const mtApiUrl = `${baseUrl}?${queryParams.join("&")}`;

    // Attempt to create account via API
    const accountResponse = await axios.post(
      mtApiUrl,
      {},
      {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      }
    );

    // If the response status is not 200, throw an error
    if (accountResponse.status !== 200) {
      console.error(
        "MetaTrader account creation failed with status:",
        accountResponse.status
      );
      throw new Error("MetaTrader account creation failed");
    }

    return accountResponse.data;
  } catch (error) {
    console.error("Error in handleMT5AccountCreation:", error.message);
    throw error;
  }
};

// Controller function that uses the reusable logic
const createMT5Account = async (req, res) => {
  try {
    const { user_id, plan } = req.query;

    // Call the reusable MT5 account creation function
    const mt5Account = await handleMT5AccountCreation(user_id, plan);

    return res.status(200).json({
      message: "MetaTrader account created and saved successfully",
      data: mt5Account,
    });
  } catch (error) {
    console.error("Error creating MetaTrader account:", error.message);
    return res.status(500).json({
      message: "An error occurred",
      error: error.message,
    });
  }
};

const upgradeMT5Account = async login => {
  try {
    console.log("🚀 ~ upgradeMT5Account ~");
    const token = await fetchAuthToken();

    // Step 2: Use the token to create an MT5 account
    const mtApiUrl = `${process.env.FAST_API_SERVER}/manager/upgrade_account_phase_1/${login}`;
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
        data: accountResponse.data.create_user_response.login,
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


const handleTradeLockerAccountCreation = async (email, firstName, lastName, password) => {
  try {
    // Fetch authorization token
    const token = await fetchAuthToken();
    if (!token) {
      throw new Error("Authorization token is missing");
    }
    // Construct API URL
    const mtApiUrl = `${process.env.FAST_API_SERVER}/tradelocker_user/create_tradelocker_user/?email=${email}&firstName=${firstName}&lastName=${lastName}&password=${password}`;
    // Attempt to create account via API
    const accountResponse = await axios.post(
      mtApiUrl,
      {},
      {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      },
    );
    const accountData = accountResponse.data;
    return accountData;
  } catch (error) {
    // Log and throw the error for further handling by the caller
    console.error("Error in handleMT5AccountCreation:", error.message);
    throw error;
  }
};

const handleTradeLockerTradingAccountCreation = async (email, accountName, type = "DEMO", userId, planId) => {
  try {
    // Fetch authorization token
    const token = await fetchAuthToken();
    if (!token) {
      throw new Error("Authorization token is missing");
    }

    // Fix URL parameter spelling (acountName → accountName)
    const mtApiUrl = `${process.env.FAST_API_SERVER}/tradelocker_user/create_tradelocker_account/?email=${encodeURIComponent(email)}&accountName=${encodeURIComponent(accountName)}&type=${type}&user_id=${userId}&paymentplan_id=${planId}`;
    // Add error handling for API response
    const accountResponse = await axios.post(
      mtApiUrl,
      {},
      {
        headers: {
          Authorization: `Bearer ${token}`,
        }
      },
    );

    if (!accountResponse.data) {
      throw new Error("Empty response from TradeLocker API");
    }
    const accountData = accountResponse.data;
    return accountData;
  } catch (error) {
    console.error("Error in handleTradeLockerTradingAccountCreation:", error.message);
    throw error;
  }
};

module.exports = {
  createMT5Account,
  handleMT5AccountCreation,
  upgradeMT5Account, // Exported for use in other APIs
  handleTradeLockerAccountCreation,
  handleTradeLockerTradingAccountCreation
};
