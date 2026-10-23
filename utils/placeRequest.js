const mongoose = require("mongoose");
const Book = require("../models/Book");
const Order = require("../models/order");
const User = require("../models/User");
const { assertTransactionsSupported } = require("./mongoTransactions");

function fail(status, message) {
  const err = new Error(message);
  err.status = status;
  throw err;
}

function requestFingerprint(bookIds) {
  return [...new Set(bookIds.map((id) => String(id)))].sort().join(",");
}

function fingerprintFrom(order) {
  if (order.requestFingerprint) {
    return order.requestFingerprint;
  }
  const ids = (order.books || []).map((line) => String(line.book?._id || line.book));
  return requestFingerprint(ids);
}

function parseBookIds(bookIds) {
  if (!Array.isArray(bookIds)) {
    return [];
  }
  const unique = [];
  const seen = new Set();
  for (const raw of bookIds) {
    const id = String(raw);
    if (!/^[a-f\d]{24}$/i.test(id)) {
      fail(400, "Invalid book ID.");
    }
    const key = id.toLowerCase();
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    unique.push(new mongoose.Types.ObjectId(id));
  }
  return unique;
}

function parseIdempotencyKey(idempotencyKey) {
  if (!/^[a-zA-Z\d-]{8,100}$/.test(idempotencyKey || "")) {
    fail(400, "A request ID is required.");
  }
  return idempotencyKey;
}

function owns(book, user) {
  return (
    book.userEmail &&
    user.email &&
    book.userEmail.toLowerCase() === user.email.toLowerCase()
  );
}

function requestKeyFor(buyer, idempotencyKey) {
  return `${buyer._id}:${idempotencyKey}`;
}

async function placeRequest({
  buyer,
  bookIds,
  idempotencyKey,
  clearCart = false,
}) {
  await assertTransactionsSupported();
  const key = parseIdempotencyKey(idempotencyKey);
  const ids = parseBookIds(bookIds);
  const requestKey = requestKeyFor(buyer, key);

  const existing = await Order.findOne({ mobileRequestKey: requestKey });
  if (existing) {
    if (ids.length && fingerprintFrom(existing) !== requestFingerprint(ids)) {
      fail(409, "This request ID was already used for a different order.");
    }
    return { order: existing, replay: true };
  }

  if (!ids.length) {
    fail(400, clearCart ? "Your bag is empty." : "Select a book to request.");
  }

  const intendedFingerprint = requestFingerprint(ids);
  const session = await mongoose.startSession();
  let order;
  let replay = false;
  try {
    await session.withTransaction(async () => {
      order = await Order.findOne({ mobileRequestKey: requestKey }).session(
        session
      );
      if (order) {
        replay = true;
        return;
      }

      const reserved = [];
      for (const id of ids) {
        const listed = await Book.findById(id).session(session);
        if (!listed) {
          fail(409, "This book is unavailable.");
        }
        if (owns(listed, buyer)) {
          fail(400, "You cannot request your own book.");
        }
        if (!Number.isFinite(listed.price) || listed.price < 0) {
          fail(409, "A book is unavailable. Refresh your bag.");
        }

        const book = await Book.findOneAndUpdate(
          { _id: id, quantity: { $gt: 0 } },
          { $inc: { quantity: -1 } },
          { session, new: true }
        );
        if (!book) {
          fail(409, "This book is unavailable.");
        }
        reserved.push(book);
      }

      [order] = await Order.create(
        [
          {
            user: buyer._id,
            books: reserved.map((book) => ({ book: book._id, quantity: 1 })),
            totalAmount:
              Math.round(
                reserved.reduce((sum, book) => sum + book.price, 0) * 100
              ) / 100,
            status: "Requested",
            mobileRequestKey: requestKey,
            requestFingerprint: intendedFingerprint,
            mobileTitles: reserved.map((book) => book.title),
          },
        ],
        { session }
      );

      if (clearCart) {
        await User.updateOne(
          { _id: buyer._id },
          { $pull: { mobileCart: { $in: ids } } },
          { session }
        );
      }
    });
  } catch (err) {
    if (err.code !== 11000) {
      throw err;
    }
    order = await Order.findOne({ mobileRequestKey: requestKey });
    if (!order) {
      throw err;
    }
    if (fingerprintFrom(order) !== intendedFingerprint) {
      fail(409, "This request ID was already used for a different order.");
    }
    return { order, replay: true };
  } finally {
    await session.endSession();
  }

  if (!order) {
    fail(500, "Bookly could not complete this action. Please retry.");
  }
  if (fingerprintFrom(order) !== intendedFingerprint) {
    fail(409, "This request ID was already used for a different order.");
  }
  return { order, replay };
}

async function cancelRequest({ buyer, orderId }) {
  await assertTransactionsSupported();
  if (!mongoose.isValidObjectId(orderId)) {
    fail(400, "Invalid order ID.");
  }

  const session = await mongoose.startSession();
  let order;
  try {
    await session.withTransaction(async () => {
      order = await Order.findOneAndUpdate(
        { _id: orderId, user: buyer._id, status: "Requested" },
        { $set: { status: "Cancelled" } },
        { session, new: true }
      );
      if (!order) {
        const existing = await Order.findOne({
          _id: orderId,
          user: buyer._id,
        }).session(session);
        if (!existing) {
          fail(404, "This request was not found.");
        }
        if (existing.status === "Cancelled") {
          order = existing;
          return;
        }
        fail(409, "This request cannot be cancelled.");
      }

      for (const line of order.books) {
        await Book.updateOne(
          { _id: line.book },
          { $inc: { quantity: line.quantity || 1 } },
          { session }
        );
      }
    });
  } finally {
    await session.endSession();
  }

  return order;
}

module.exports = {
  placeRequest,
  cancelRequest,
  requestFingerprint,
};
