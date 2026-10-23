const express = require("express");
const Order = require("../models/order");
const User = require("../models/User");
const { placeRequest, cancelRequest } = require("../utils/placeRequest");

const router = express.Router();

function sendError(res, err) {
  if (err.status && err.status < 500) {
    return res.status(err.status).json({ message: err.message });
  }
  console.error("Website request:", err.name);
  return res
    .status(500)
    .json({ message: "Bookly could not complete this action. Please retry." });
}

async function loadBuyer(req, res) {
  if (!req.session || !req.session.user || !req.session.user._id) {
    res.status(401).json({ message: "Please sign in to continue." });
    return null;
  }
  const buyer = await User.findById(req.session.user._id);
  if (!buyer || buyer.blocked) {
    res.status(401).json({ message: "Please sign in to continue." });
    return null;
  }
  return buyer;
}

router.get("/", async (req, res) => {
  const user = req.session.user;
  if (!user) {
    return res.redirect("/");
  }
  const orders = await Order.find({ user: user._id })
    .sort({ createdAt: -1 })
    .populate("books.book");
  res.render("orders", { orders, user, showDropdown: true });
});

router.post("/", async (req, res) => {
  try {
    const buyer = await loadBuyer(req, res);
    if (!buyer) {
      return;
    }
    const { order, replay } = await placeRequest({
      buyer,
      bookIds: req.body.bookIds,
      idempotencyKey: req.get("Idempotency-Key"),
    });
    res.status(replay ? 200 : 201).json({
      id: String(order._id),
      status: order.status,
      total: order.totalAmount,
      message: replay
        ? "This request was already recorded."
        : "Book reserved. This is a request, not a paid purchase.",
    });
  } catch (err) {
    sendError(res, err);
  }
});

router.post("/:id/cancel", async (req, res) => {
  try {
    const buyer = await loadBuyer(req, res);
    if (!buyer) {
      return;
    }
    const order = await cancelRequest({ buyer, orderId: req.params.id });
    res.json({
      id: String(order._id),
      status: order.status,
      message:
        order.status === "Cancelled"
          ? "Request cancelled."
          : "This request was already cancelled.",
    });
  } catch (err) {
    sendError(res, err);
  }
});

module.exports = router;
