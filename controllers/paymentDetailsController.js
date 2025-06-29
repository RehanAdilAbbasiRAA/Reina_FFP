const PaymentDetails = require('../models/PaymentDetails');
const User = require('../models/user');

const createPaymentMethod = async (req, res, next) => {
  try {
    const { cardHolderName, cardBrand, lastFourDigits, expiryMonth, expiryYear, billingAddress, paymentProcessorId, paymentMethodType, isDefault } = req.body;

    const newPaymentMethod = new PaymentDetails({
      cardHolderName,
      cardBrand,
      lastFourDigits,
      expiryMonth,
      expiryYear,
      billingAddress,
      paymentProcessorId,
      paymentMethodType,
      isDefault,
    });

    await newPaymentMethod.save();

    const userId = req.body.userId;
    const user = await User.findById(userId);
    if (user) {
      user.paymentMethods.push(newPaymentMethod._id);
      await user.save();
    }

    res.status(201).json({
      success: true,
      message: 'Payment method created successfully',
      paymentMethod: newPaymentMethod,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Failed to create payment method',
      details: error.message,
    });
  }
};

const getPaymentMethods = async (req, res, next) => {
  try {
    const userId = req.params.userId;
    const user = await User.findById(userId).populate('paymentMethods');
    
    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found',
      });
    }

    if (user.paymentMethods.length === 0) {
      return res.status(204).json({
        success: true,
        message: 'No payment methods found for this user',
      });
    }

    res.status(200).json({
      success: true,
      paymentMethods: user.paymentMethods,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Failed to fetch payment methods',
      details: error.message,
    });
  }
};

const getPaymentMethodById = async (req, res, next) => {
  try {
    const paymentMethodId = req.params.id;
    const paymentMethod = await PaymentDetails.findById(paymentMethodId);
    
    if (!paymentMethod) {
      return res.status(404).json({
        success: false,
        message: 'Payment method not found',
      });
    }

    res.status(200).json({
      success: true,
      paymentMethod,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Failed to fetch payment method by ID',
      details: error.message,
    });
  }
};

const updatePaymentMethod = async (req, res, next) => {
  try {
    const paymentMethodId = req.params.id;
    const updatedData = req.body;

    const updatedPaymentMethod = await PaymentDetails.findByIdAndUpdate(
      paymentMethodId,
      updatedData,
      { new: true }
    );

    if (!updatedPaymentMethod) {
      return res.status(404).json({
        success: false,
        message: 'Payment method not found',
      });
    }

    res.status(200).json({
      success: true,
      message: 'Payment method updated successfully',
      paymentMethod: updatedPaymentMethod,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Failed to update payment method',
      details: error.message,
    });
  }
};

const deletePaymentMethod = async (req, res, next) => {
  try {
    const paymentMethodId = req.params.id;

    const deletedPaymentMethod = await PaymentDetails.findByIdAndDelete(paymentMethodId);

    if (!deletedPaymentMethod) {
      return res.status(404).json({
        success: false,
        message: 'Payment method not found',
      });
    }

    res.status(200).json({
      success: true,
      message: 'Payment method deleted successfully',
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Failed to delete payment method',
      details: error.message,
    });
  }
};

module.exports = {
  createPaymentMethod,
  getPaymentMethods,
  getPaymentMethodById,
  updatePaymentMethod,
  deletePaymentMethod,
};
