const Ticket = require("../models/Ticket");
const sendEmail = require("../utils/sendEmail");

const createTicket = async (req, res) => {
  try {
    const userId = req.user._id;
    const { email, subject, description, accountId, type } = req.body;
    const isfile = req.file;
    if (!req.user) {
      return res.status(404).json({
        success: false,
        message: "User not found",
      });
    }
    if (isfile) {
      var documentInfo = {
        fileName: req.file.originalname,
        fileUrl: req.file.location,
        fileKey: req.file.key,
      };
    }
    const ticket = new Ticket({
      userId,
      email,
      subject,
      description,
      accountId,
      document: isfile ? documentInfo : "No document uploaded",
      ticketType: type,
    });
    await ticket.save();
    try {

      const emailData = {
        to: process.env.PRIDE_FUNDING_SUPPORT,
        subject: `Ticket raises from user`,
        html: `<p><span style="font-family: Calibri, sans-serif;"><strong><span style="font-size: 20px;">From: </span></strong><span style="font-size: 20px;">${email}</span></span></p>
                <p><span style="font-family: Calibri, sans-serif;"><strong><span style="font-size: 20px;">Subject: </span></strong><span style="font-size: 20px;">${subject}</span></span></p>
                <p><span style="font-family: Calibri, sans-serif;"><span style="font-size: 20px;"><strong>AccountID:&nbsp;</strong> ${accountId}</span></span></p>
                <p><span style="font-family: Calibri, sans-serif;"><span style="font-size: 20px;"><span style="font-family: Calibri, sans-serif;"><span style="font-size: 20px;"><strong>Ticket Type:&nbsp;</strong></span></span>${type}</span></span></p>
                <p><span style="font-family: Calibri, sans-serif;">${description}</span></p>
                <p><span style="font-family: Calibri, sans-serif;"><br></span></p>
                <p><strong><span style="font-size: 20px; font-family: Calibri, sans-serif;">Attchment: </span><span style="font-family: Calibri, sans-serif;">: </span></strong>${isfile ? documentInfo.fileUrl : "No attchment uploaded"}</p > `,
      };
      await sendEmail(emailData);
    } catch (error) {
      console.error("Error in sending email: ", error);
      return res.status(400).json({
        message: "Ticket not send to support",
        success: false,
        data: ticket,
      });
    }
    res.status(201).json({
      success: true,
      message: "Ticket created successfully",
      data: ticket,
    });
  } catch (error) {
    console.error("Error creating ticket:", error);
    res.status(500).json({
      success: false,
      message: "Error creating ticket",
      error: error.message,
    });
  }
};
const getAllTicketsForExport = async (req, res) => {
  try {
    // Manager authorization check
    if (!req.user.manager) {
      return res.status(400).json({
        success: false,
        message: "Only managers are allowed to see tickets",
      });
    }

    const { search = "", status } = req.query;
    const query = {};

    // Search across subject, description, or email
    if (search) {
      query.$or = [
        { subject: { $regex: search, $options: "i" } },
        { description: { $regex: search, $options: "i" } },
        { email: { $regex: search, $options: "i" } },
      ];
    }

    // Status filter
    if (status) {
      if (status === "Pending") {
        query.status = { $nin: ["Resolved", "Cancelled"] };
      } else {
        query.status = { $regex: new RegExp(`^${status}$`, "i") };
      }
    }

    // Fetch all tickets matching query
    const tickets = await Ticket.find(query)
      .populate({
        path: "userId",
        select: "firstName lastName email isSignatureApproved",
        match: search
          ? {
              $or: [
                { firstName: { $regex: search, $options: "i" } },
                { lastName: { $regex: search, $options: "i" } },
                { email: { $regex: search, $options: "i" } },
              ],
            }
          : {},
      })
      .sort({ createdAt: -1 });

    // Remove tickets with no matching user after populate
    const filteredTickets = tickets.filter(ticket => ticket.userId);

    res.status(200).json({
      success: true,
      message: "Tickets fetched successfully",
      data: filteredTickets,
      totalTickets: filteredTickets.length,
    });
  } catch (error) {
    console.error("Error fetching tickets:", error);
    res.status(500).json({
      success: false,
      message: "Error fetching tickets",
      error: error.message,
    });
  }
};

const getAllTickets = async (req, res) => {
  try {
    // Manager authorization check
    if (!req.user.manager) {
      return res.status(400).json({
        success: false,
        message: "Only managers are allowed to see tickets",
      });
    }

    const { limit = 10, page = 1, search = "", status } = req.query;
    console.log("Status from query:", status);

    const query = {};

    // Handle search across multiple fields
    if (search) {
      query.$or = [
        { subject: { $regex: search, $options: "i" } },
        { description: { $regex: search, $options: "i" } },
        { email: { $regex: search, $options: "i" } },
      ];
    }

    // Advanced status filtering
    if (status) {
      if (status === "Pending") {
        // Exclude Resolved and Cancelled statuses
        query.status = {
          $nin: ["Resolved", "Cancelled"],
        };
      } else {
        // Existing logic for specific status
        query.status = {
          $regex: new RegExp(`^${status}$`, "i"),
        };
      }
    }

    console.log("Final query:", query);

    const tickets = await Ticket.find(query)
      .populate({
        path: "userId",
        select: "firstName lastName email isSignatureApproved",
        match: search
          ? {
              $or: [
                { firstName: { $regex: search, $options: "i" } },
                { lastName: { $regex: search, $options: "i" } },
                { email: { $regex: search, $options: "i" } },
              ],
            }
          : {},
      })
      .sort({ createdAt: -1 })
      .limit(limit * 1)
      .skip((page - 1) * limit);

    // Filter out tickets without a user
    const filteredTickets = tickets.filter(ticket => ticket.userId);

    // Count total tickets matching the query
    const totalTickets = await Ticket.countDocuments(query);

    res.status(200).json({
      success: true,
      data: filteredTickets,
      totalTickets,
      totalPages: Math.ceil(totalTickets / limit),
      currentPage: page,
    });
  } catch (error) {
    console.error("Error fetching tickets:", error);
    res.status(500).json({
      success: false,
      message: "Error fetching tickets",
      error: error.message,
    });
  }
};

const getAllTicketsByEmail = async (req, res) => {
  try {
    if (req.user.manager) {
      const tickets = await Ticket.find({ email: req.body.email })
        .populate("userId", "name email")
        .sort({ createdAt: -1 });

      res.status(200).json({
        success: true,
        count: tickets.length,
        data: tickets,
      });
    } else {
      res.status(400).json({
        success: true,
        message: "Only managers are allowed to see tickets",
      });
    }
  } catch (error) {
    console.error("Error fetching user tickets:", error);
    res.status(500).json({
      success: false,
      message: "Error fetching user tickets",
      error: error.message,
    });
  }
};

const getAllTicketById = async (req, res) => {
  try {
    if (req.user.manager) {
      const ticket = await Ticket.findById(req.query.ticketId).populate({
        path: "userId",
        select: "firstName lastName email",
      });

      if (ticket.userId) {
        ticket.userId = ticket.userId.toObject();
        ticket.userId.name = `${ticket.userId.firstName} ${ticket.userId.lastName}`;
      }

      res.status(200).json({
        success: true,
        ticket,
      });
    } else {
      res.status(400).json({
        success: true,
        message: "Only managers are allowed to see tickets",
      });
    }
  } catch (error) {
    console.error("Error fetching user tickets:", error);
    res.status(500).json({
      success: false,
      message: "Error fetching user tickets",
      error: error.message,
    });
  }
};

const updateTicketStatus = async (req, res) => {
  try {
    const { ticketId, status } = req.query;

    // Validate status
    const validStatuses = ["Resolved", "Cancelled"];
    if (!validStatuses.includes(status)) {
      return res.status(400).json({
        success: false,
        message: "Invalid status. Only Resolved or Canceled are allowed.",
      });
    }

    // Find and update the ticket
    const updatedTicket = await Ticket.findByIdAndUpdate(
      ticketId,
      { status },
      {
        new: true,
        runValidators: true,
      },
    );

    // Check if ticket exists
    if (!updatedTicket) {
      return res.status(404).json({
        success: false,
        message: "Ticket not found",
      });
    }

    // Successful response
    res.status(200).json({
      success: true,
      message: "Ticket status updated successfully",
      ticket: updatedTicket,
    });
  } catch (error) {
    console.error("Error updating ticket status:", error);
    res.status(500).json({
      success: false,
      message: "Internal server error",
      error: error.message,
    });
  }
};

module.exports = {
  createTicket,
  getAllTickets,
  getAllTicketsByEmail,
  getAllTicketById,
  updateTicketStatus,
  getAllTicketsForExport
};
