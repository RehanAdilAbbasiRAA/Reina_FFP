const axios = require("axios");

const fetchAuthToken = async () => {
  try {
    console.log(`Attempting to connect to: ${process.env.MT5_URL}/auth/token`);

    const authResponse = await axios.post(
      `${process.env.MT5_URL}/auth/token`,
      new URLSearchParams({
        username: process.env.ADMIN_USERNAME,
        password: process.env.ADMIN_PASSWORD
      }),
      {
        headers: {
          "Content-Type": "application/x-www-form-urlencoded"
        },
        validateStatus: function (status) {
          // Log the status code for debugging
          console.log(`Auth response status: ${status}`);
          return status < 500; // Don't throw for 4xx errors so we can handle them
        }
      }
    );

    if (authResponse && authResponse.status === 200 && authResponse.data && authResponse.data.access_token) {
      console.log("Successfully obtained auth token");
      return authResponse.data.access_token;
    } else {
      console.error("Auth response error:", authResponse.status, authResponse.data);
      throw new Error(`Failed to fetch authorization token. Status: ${authResponse.status}`);
    }
  } catch (error) {
    if (error.response) {
      // The request was made and the server responded with a status code
      // that falls out of the range of 2xx
      console.error("Auth error response data:", error.response.data);
      console.error("Auth error response status:", error.response.status);
      console.error("Auth error response headers:", error.response.headers);
    } else if (error.request) {
      // The request was made but no response was received
      console.error("Auth error request (no response):", error.request);
    } else {
      // Something happened in setting up the request that triggered an Error
      console.error("Auth error message:", error.message);
    }

    // Instead of throwing, we'll return null and handle the failure downstream
    return null;
  }
};
  
const createMT5Account = async (userId, plan) => {
    try {
      console.log("🚀 ~ createMT5Account ~");
      const token = await fetchAuthToken();
  
      // Step 2: Use the token to create an MT5 account
      const mtApiUrl = `${process.env.MT5_URL}/user_v3/create-account?user_id=${userId}&plan=${plan}`;
      const accountResponse = await axios.post(
        mtApiUrl,
        {},
        {
          headers: {
            Authorization: `Bearer ${token}`
          }
        }
      );
  
      if (accountResponse) {
        const mt5Account = new MT5({
          user_id: userId,
          plan: plan,
          metaTraderResponse: accountResponse.data
        });
  
        await mt5Account.save();
        return {
          success: true,
          message: "MetaTrader account created and saved successfully",
          data: mt5Account
        };
      } else {
        // throw new Error("MetaTrader account creation failed");
        return {
          success: false,
          message: "MetaTrader account creation failed",
          data: null
        };
      }
    } catch (error) {
      console.error("Error in createMT5Account:", error);
      return {
        success: false,
        message: "MetaTrader account creation failed",
        data: null,
        error: error
      };
      // throw error;
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
            Authorization: `Bearer ${token}`
            }
        }
        );

        if (accountResponse) {
        return {
            success: true,
            message: "MetaTrader account upgraded and saved successfully",
            data: accountResponse.data.create_user_response.login
        };
        } else {
        // throw new Error("MetaTrader account creation failed");
        return {
            success: false,
            message: "MetaTrader account upgradation failed",
            data: null
        };
        }
    } catch (error) {
        console.error("Error in upgradeMT5Account:", error);
        return {
        success: false,
        message: "MetaTrader account upgradation failed",
        data: null,
        error: error
        };
        // throw error;
    }
};

const checkConsistencyRule = async (accountId, payoutRequestId) => {
  console.log("🚀 ~ checkConsistencyRule")
  try {
    const token = await fetchAuthToken();
    const login = parseInt(accountId);
    // Step 2: Use the token to create an MT5 account
    const mtApiUrl = `${process.env.MT5_URL}/user_v3/check_consistency_rule?login=${login}&payout_id=${payoutRequestId}`;
    const accountResponse = await axios.get(
      mtApiUrl,

      {
        headers: {
          Authorization: `Bearer ${token}`
        }
      }
    );

    if (accountResponse) {
      return {
        success: true,
        accountResponse
      };
    } 
  } catch (error) {
    console.error("Error in check consistency rules:", error);
    return {
      success: false,
      error: error
    };
    // throw error;
  }
};
module.exports = {
    createMT5Account,
    upgradeMT5Account,
  fetchAuthToken,
  checkConsistencyRule
};
