const paymaxis = require('@api/paymaxis');
const mongoose = require("mongoose");
const User = require("../models/user");
const Payment = require("../models/Payment");
const Plan = require("../models/paymentPlans");
const Discount = require("../models/Discount");
const CryptoCharge = require("../models/cryptoCharge");
const {UserLocation} = require("../models/UserLoginLocation");
const {
    handleMT5AccountCreation,
    upgradeMT5Account
} = require("./mt5");
const { processAffiliateCommissionLogic } = require("./affiliation.controller");
const crypto = require('crypto');

// Environment/config
const PAYMAXIS_API_KEY = process.env.PAYMAXIS_API_KEY;
const PAYMAXIS_API_KEY_CRYPTO = process.env.PAYMAXIS_API_KEY_CRYPTO;
const PAYMAXIS_WEBHOOK_SECRET = process.env.PAYMAXIS_WEBHOOK_SECRET;
const PAYMAXIS_WEBHOOK_SECRET_CRYPTO = process.env.PAYMAXIS_WEBHOOK_SECRET_CRYPTO;
const FRONTEND_BASE_URL = process.env.FRONTEND_BASE_URL;
const WEBHOOK_URL = `${process.env.NGROK_URL}/paymaxis/post-processing-webhook`;
const USE_LIVE = process.env.NODE_ENV === 'production';
const baseUrl = USE_LIVE
    ? 'https://app.paymaxis.com'         // <— production
    : 'https://app-sandbox.paymaxis.com';
paymaxis.server(baseUrl);
/**
 * Validate Paymaxis webhook signature (HMAC), using different secrets based on paymentMethod.
 *
 * Expects raw JSON body captured in req.rawBody (configure express.json({ verify: ... }))
 * and a field `paymentMethod` inside the webhook payload to determine which secret to use.
 */
function verifyWebhookSignature(req, res, next) {
    const signatureHeader = req.headers['signature'] || req.headers['paymaxis-signature'];
    if (!signatureHeader) {
        return res.status(400).json({ error: 'Missing Signature header' });
    }

    // Determine which secret to use based on req.body.paymentMethod
    // If paymentMethod is "CRYPTO", use PAYMAXIS_WEBHOOK_SECRET_CRYPTO, else use PAYMAXIS_WEBHOOK_SECRET.
    const pm = req.body?.paymentMethod;
    const secret = (pm && pm.toUpperCase() === 'CRYPTO')
        ? PAYMAXIS_WEBHOOK_SECRET_CRYPTO
        : PAYMAXIS_WEBHOOK_SECRET;

    if (!secret) {
        console.error('Appropriate webhook secret is not defined for paymentMethod:', pm);
        return res.status(500).json({ error: 'Webhook secret not configured' });
    }

    if (!req.rawBody) {
        console.error('Raw body is missing: make sure express.json() is configured with a verify function.');
        return res.status(500).json({ error: 'Unable to verify signature (raw body missing)' });
    }

    const computedSignature = crypto
        .createHmac('sha256', secret)
        .update(req.rawBody)
        .digest('hex');

    const signatureBuffer = Buffer.from(signatureHeader, 'hex');
    const computedBuffer = Buffer.from(computedSignature, 'hex');

    if (
        signatureBuffer.length !== computedBuffer.length ||
        !crypto.timingSafeEqual(signatureBuffer, computedBuffer)
    ) {
        return res.status(401).json({ error: 'Invalid signature' });
    }

    return next();
}

/**
 * Process discount (and add-ons) logic, now supporting both couponCode and affiliateCode.
 *
 * Arguments:
 * - couponCode (String or null)
 * - affiliateCode (String or null)
 * - user (User document)
 * - planPrice (Number)
 * - addOns: { payout7Days: Boolean, profitSplit: String, eAAllowed: Boolean } or null
 *
 * Both couponCode and affiliateCode look up entries in the Discount collection.
 * Affiliate codes are stored in Discount with { code: affiliateCode, active: true, createdByManager: false }.
 * Coupon codes may have createdByManager: true or unspecified.
 *
 * If both codes are provided, each discount is calculated independently on adjustedPrice.
 *
 * Returns: { adjustedPrice, finalAmount, discountApplied, usedDiscounts }
 */
async function processDiscountCode({
    couponCode = null,
    affiliateCode = null,
    user,
    planPrice,
    addOns = null
}) {
    let couponObj = null;
    let affiliateObj = null;

    if (affiliateCode) {
        affiliateObj = await Discount.findOne({
            couponCode: affiliateCode,
            active: true,
            createdByManager: false
        });
        if (!affiliateObj) throw new Error("Invalid or inactive affiliate code");
        if (
            affiliateObj.expiration_date &&
            new Date(affiliateObj.expiration_date) < new Date()
        ) {
            throw new Error("Affiliate code has expired");
        }
        if (
            affiliateObj.max_times_allowed &&
            affiliateObj.times_used >= affiliateObj.max_times_allowed
        ) {
            throw new Error("Affiliate code usage limit reached");
        }
        const usedByAffiliate = affiliateObj.used_by.find(
            (u) => u.userId.toString() === user._id.toString()
        );
        if (
            usedByAffiliate &&
            affiliateObj.usage_per_client &&
            usedByAffiliate.usageCount >= affiliateObj.usage_per_client
        ) {
            throw new Error("Affiliate code usage limit reached for this user");
        }
    }

    if (couponCode) {
        couponObj = await Discount.findOne({
            couponCode: couponCode,
            active: true
        });
        if (!couponObj) throw new Error("Invalid or inactive coupon code");
        if (
            couponObj.expiration_date &&
            new Date(couponObj.expiration_date) < new Date()
        ) {
            throw new Error("Coupon code has expired");
        }
        if (
            couponObj.max_times_allowed &&
            couponObj.times_used >= couponObj.max_times_allowed
        ) {
            throw new Error("Coupon code usage limit reached");
        }
        const usedByCoupon = couponObj.used_by.find(
            (u) => u.userId.toString() === user._id.toString()
        );
        if (
            usedByCoupon &&
            couponObj.usage_per_client &&
            usedByCoupon.usageCount >= couponObj.usage_per_client
        ) {
            throw new Error("Coupon usage limit reached for this user");
        }
    }

    // Calculate adjustedPrice by applying addOns first
    let adjustedPrice = planPrice;
    if (addOns) {
        if (addOns.payout7Days) {
            adjustedPrice += planPrice * 0.35;
        }
        if (addOns.profitSplit === '80/20') {
            adjustedPrice += planPrice * 0.50;
        } else if (addOns.profitSplit === '100/0') {
            adjustedPrice += planPrice * 0.50;
        }
        if (addOns.eAAllowed) {
            adjustedPrice += planPrice * 0.20;
        }
    }
    adjustedPrice = parseFloat(adjustedPrice.toFixed(2));

    // Compute total discount amounts independently on adjustedPrice
    let totalDiscountAmount = 0;
    const usedDiscounts = [];

    const computeDiscountAmount = (baseAmount, discountDoc) => {
        let discountAmt = 0;
        if (
            discountDoc.percentageOff &&
            (discountDoc.percentageOff === '100' || discountDoc.percentageOff === '100%')
        ) {
            discountAmt = baseAmount;
        } else if (discountDoc.percentageOff) {
            const pct = parseInt(discountDoc.percentageOff.replace('%', ''), 10) / 100;
            discountAmt = baseAmount * pct;
        } else if (discountDoc.dollar_amount) {
            discountAmt = discountDoc.dollar_amount;
        }
        return parseFloat(discountAmt.toFixed(2));
    };

    if (affiliateObj) {
        const affiliateDiscountAmt = computeDiscountAmount(adjustedPrice, affiliateObj);
        if (affiliateDiscountAmt > 0) {
            totalDiscountAmount += affiliateDiscountAmt;
            usedDiscounts.push(affiliateObj);

            affiliateObj.times_used = (affiliateObj.times_used || 0) + 1;
            const usedByAffiliate = affiliateObj.used_by.find(
                (u) => u.userId.toString() === user._id.toString()
            );
            if (usedByAffiliate) {
                usedByAffiliate.usageCount += 1;
            } else {
                affiliateObj.used_by.push({ userId: user._id, usageCount: 1 });
            }
            await affiliateObj.save();
        }
    }

    if (couponObj) {
        const couponDiscountAmt = computeDiscountAmount(adjustedPrice, couponObj);
        if (couponDiscountAmt > 0) {
            totalDiscountAmount += couponDiscountAmt;
            usedDiscounts.push(couponObj);

            couponObj.times_used = (couponObj.times_used || 0) + 1;
            const usedByCoupon = couponObj.used_by.find(
                (u) => u.userId.toString() === user._id.toString()
            );
            if (usedByCoupon) {
                usedByCoupon.usageCount += 1;
            } else {
                couponObj.used_by.push({ userId: user._id, usageCount: 1 });
            }
            await couponObj.save();
        }
    }

    let finalAmount = parseFloat((adjustedPrice - totalDiscountAmount).toFixed(2));
    if (finalAmount < 0) finalAmount = 0;

    const discountApplied = usedDiscounts.length > 0;
    return { adjustedPrice, finalAmount, discountApplied, usedDiscounts };
}

/**
 * Post-payment workflow: user update, MT5, affiliate
 */
async function handlePostPaymentProcessing({ paymentRecord, user, couponCode, affiliateCode, addOns = null }) {
    if (!user.payment.includes(paymentRecord._id)) {
        user.payment.push(paymentRecord._id);
        await user.save();
    }

    const completedCryptoCharges = await CryptoCharge.countDocuments({ user: user._id, status: 'completed' });
    const paidPayments = await Payment.countDocuments({ 'chargeResponse.state': 'COMPLETED', userId: user._id });
    const isFirstOrder = (completedCryptoCharges + paidPayments) === 1;

    const { isUpgradation, login, paymentPlan } = paymentRecord;
    const accountType = paymentRecord.type;

    if (accountType === "mt5") {
        if (isUpgradation && login) {
            await upgradeMT5Account(login);
        } else if (addOns !== null) {
            await handleMT5AccountCreation(user._id.toString(), paymentPlan.toString(), addOns);
        } else {
            await handleMT5AccountCreation(user._id.toString(), paymentPlan.toString());
        }
    }
    if (paymentRecord.priceAfterDiscount !== 0){
        await processAffiliateCommissionLogic({
            userId: user._id.toString(),
            planId: paymentPlan.toString(),
            isFirstOrder
        });
    }
    
}

/**
 * Create a new Paymaxis payment charge
 * - Uses different API keys based on paymentMethod
 */
async function createPaymaxisCharge(req, res) {
    try {
        const {
            planId,
            price: frontendPrice,
            couponCode,
            affiliateCode,
            login,
            addOns,
            paymentMethod
        } = req.body;

        const userId = req.user?._id || req.body.userId;
        if (!userId) {
            return res.status(401).json({ success: false, error: 'Authentication required' });
        }

        const user = await User.findById(userId);
        if (!user) {
            return res.status(404).json({ success: false, error: 'User not found' });
        }

        if (user.isBan) {
            return res.status(404).json({ success: false, error: 'User is Ban' });
        }

        const bannedIP = await UserLocation.findOne({
        ipAddress: user.lastip,
        isBan: true,
        });

        if (bannedIP) {
        return res.status(404).json({
            success: false,
            message: "User IP ban",
        });
        }

        if (!planId) {
            return res.status(400).json({ success: false, error: 'Plan ID is required' });
        }
        if (!paymentMethod) {
            return res.status(400).json({ success: false, error: 'Payment method required' });
        }

        const plan = await Plan.findById(planId);
        if (!plan) {
            return res.status(404).json({ success: false, error: 'Plan not found' });
        }

        // Calculate adjusted price and final amount using addOns + codes
        const {
            adjustedPrice,
            finalAmount,
            discountApplied,
            usedDiscounts
        } = await processDiscountCode({
            couponCode: couponCode || null,
            affiliateCode: affiliateCode || null,
            user,
            planPrice: plan.price,
            addOns: addOns || null
        });

        // Check that frontend-sent price matches our backend calculation
        const frontendAmt = parseFloat(frontendPrice);
        if (isNaN(frontendAmt) || frontendAmt !== finalAmount) {
            return res.status(400).json({
                success: false,
                error: `Price mismatch: frontend sent ${frontendAmt.toFixed(2)}, but calculated ${finalAmount.toFixed(2)}`
            });
        }

        const paymentRecord = new Payment({
            userId,
            platform: plan.tradingPlatform,
            type: plan.tradingPlatform,
            paymentPlan: planId,
            isUpgradation: false,
            login: login || null,
            couponCodeUsed: couponCode || null,
            affiliateCodeUsed: affiliateCode || null,
            priceOfPlan: plan.price,
            priceAfterDiscount: finalAmount,
            chargeResponse: null,
            addOns: addOns || null
        });

        if (finalAmount === 0) {
            paymentRecord.chargeResponse = { state: 'COMPLETED', id: `free_${Date.now()}` };
            await paymentRecord.save();
            await handlePostPaymentProcessing({
                paymentRecord,
                user,
                couponCode: couponCode || null,
                affiliateCode: affiliateCode || null,
                addOns: addOns || null
            });
            return res.json({ success: true, message: 'Free plan activated', freeAccess: true });
        }

        const isCrypto = paymentMethod && paymentMethod.toUpperCase() === 'CRYPTO';
        const apiKeyToUse = isCrypto
            ? process.env.PAYMAXIS_API_KEY_CRYPTO
            : process.env.PAYMAXIS_API_KEY;

        paymaxis.auth(apiKeyToUse);

        // Construct payload
        const payload = {
            paymentType: 'DEPOSIT',
            amount: finalAmount.toFixed(2),
            currency: 'USD',
            description: plan.name,
            paymentMethod: isCrypto ? "CRYPTO" : "BASIC_CARD",
            customer: {
                referenceId: userId,
                firstName: user.firstName,
                lastName: user.lastName,
                email: user.email
            },
            additionalParameters: {
                userId,
                planId,
                accountType: plan.tradingPlatform,
                couponCode: couponCode || null,
                affiliateCode: affiliateCode || null,
                ...(addOns && addOns.payout7Days ? { payout7Days: addOns.payout7Days } : {}),
                ...(addOns && addOns.profitSplit ? { profitSplit: addOns.profitSplit } : {}),
                ...(addOns && addOns.eAAllowed ? { eAAllowed: addOns.eAAllowed } : {})
            },
            returnUrl: `${FRONTEND_BASE_URL}/payment-status`,
            webhookUrl: WEBHOOK_URL
        };

        const { data } = await paymaxis.createPayment(payload);
        const result = data.result;

        paymentRecord.chargeResponse = result;
        await paymentRecord.save();

        return res.json({
            success: true,
            checkOutUrl: result.redirectUrl,
            paymentId: result.id
        });

    } catch (err) {
        console.error('createPaymaxisCharge error:', err);
        const message = err.data?.errors ? JSON.stringify(err.data.errors) : err.message;
        return res.status(500).json({ success: false, error: message });
    }
}

/**
 * Webhook to handle Paymaxis events
 * - Uses verifyWebhookSignature to select correct secret based on paymentMethod in payload
 */
async function paymaxisWebhook(req, res) {
    try {
        const event = req.body;
        let { state } = event;
        if (state !== 'COMPLETED') {
            return res.status(200).json({ message: `Ignored state=${state}` });
        }

        const { id: paymentId, additionalParameters = {}, customer = {}, paymentMethodDetails } = event;
        const {
            userId = customer.referenceId,
            planId,
            accountType,
            couponCode,
            affiliateCode
        } = additionalParameters;

        if (!userId || !planId || !accountType) {
            return res.status(400).json({ error: 'Missing required additionalParameters' });
        }

        const user = await User.findById(userId);
        if (!user) {
            return res.status(404).json({ error: 'User not found' });
        }
           if (user.isBan) {
            return res.status(404).json({ success: false, error: 'User is Ban' });
        }

        const bannedIP = await UserLocation.findOne({
        ipAddress: user.lastip,
        isBan: true,
        });
          if (bannedIP) {
      return res.status(404).json({
        success: false,
        message: "User IP ban",
      });
    }

        const paymentRecord = await Payment.findOneAndUpdate(
            { 'chargeResponse.id': paymentId },
            { chargeResponse: event, accountType, type: accountType },
            { upsert: true, new: true }
        );

        if (paymentMethodDetails) {
            paymentRecord.cardDetails = {
                last4: paymentMethodDetails.customerAccountNumber.slice(-4),
                brand: paymentMethodDetails.cardBrand,
                expiryMonth: paymentMethodDetails.cardExpiryMonth,
                expiryYear: paymentMethodDetails.cardExpiryYear
            };
            await paymentRecord.save();
        }

        const webhookAddOns = {};
        if (additionalParameters.payout7Days) webhookAddOns.payout7Days = true;
        if (additionalParameters.profitSplit) webhookAddOns.profitSplit = additionalParameters.profitSplit;
        if (additionalParameters.eAAllowed) webhookAddOns.eAAllowed = true;

        if (Object.keys(webhookAddOns).length > 0) {
            await handlePostPaymentProcessing({
                paymentRecord,
                user,
                couponCode: couponCode || null,
                affiliateCode: affiliateCode || null,
                addOns: webhookAddOns
            });
        } else {
            await handlePostPaymentProcessing({
                paymentRecord,
                user,
                couponCode: couponCode || null,
                affiliateCode: affiliateCode || null
            });
        }

        return res.status(200).json({ message: 'Webhook processed' });
    } catch (err) {
        console.error('paymaxisWebhook error:', err);
        return res.status(500).json({ error: 'Internal server error' });
    }
}

async function getPaymaxisCharge(req, res) {
    try {
        const {
            paymentId,
        } = req.query;

        const userId = req.user?._id || req.body.userId;
        if (!userId) {
            return res.status(401).json({ success: false, error: 'Authentication required' });
        }
        if (!paymentId) {
            return res.status(401).json({ success: false, error: 'Payment id required' });
        }
        // if (!paymentMethod) {
        //     return res.status(400).json({ success: false, error: 'Payment method required' });
        // }

        // Choose API key based on paymentMethod
        // const isCrypto = paymentMethod && paymentMethod.toUpperCase() === 'CRYPTO';
        // const apiKeyToUse = isCrypto ? PAYMAXIS_API_KEY_CRYPTO : PAYMAXIS_API_KEY;
        paymaxis.auth(PAYMAXIS_API_KEY);

        const { data } = await paymaxis.getPayment({id:paymentId});
        const result = {
            id: data.result.id,
            state: data.result.state,
            amount: data.result.amount,
            currency: data.result.currency,
            paymentMethod: data.result.paymentMethod,
        };
        return res.json({
            success: true,
            result
        });

    } catch (err) {
        console.error('getPaymaxisCharge error:', err);
        const message = err.data?.errors ? JSON.stringify(err.data.errors) : err.message;
        return res.status(500).json({ success: false, error: message });
    }
}

module.exports = {
    createPaymaxisCharge,
    paymaxisWebhook,
    verifyWebhookSignature,
    getPaymaxisCharge
};
