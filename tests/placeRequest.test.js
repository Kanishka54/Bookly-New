const { describe, it, before, after, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
const mongoose = require("mongoose");
const { MongoMemoryReplSet } = require("mongodb-memory-server");
const User = require("../models/User");
const Book = require("../models/Book");
const Order = require("../models/order");
const { placeRequest, cancelRequest } = require("../utils/placeRequest");

let replSet;

async function seedBuyer(email) {
  return User.create({
    name: email.split("@")[0],
    email,
    password: "hashed",
    phone: String(Math.floor(Math.random() * 1e10)),
  });
}

async function seedBook(quantity) {
  return Book.create({
    title: "Atomic Habits",
    author: "James Clear",
    price: 499,
    quantity,
    condition: "good",
    user: "Seller",
    userEmail: "seller@bookly.test",
  });
}

describe("duplicate-purchase prevention", () => {
  before(async () => {
    replSet = await MongoMemoryReplSet.create({
      replSet: { count: 1, storageEngine: "wiredTiger" },
    });
    await mongoose.connect(replSet.getUri());
  });

  after(async () => {
    await mongoose.disconnect();
    if (replSet) {
      await replSet.stop();
    }
  });

  beforeEach(async () => {
    await Promise.all([
      User.deleteMany({}),
      Book.deleteMany({}),
      Order.deleteMany({}),
    ]);
  });

  it("lets only one buyer reserve the last copy", async () => {
    const book = await seedBook(1);
    const buyerA = await seedBuyer("a@bookly.test");
    const buyerB = await seedBuyer("b@bookly.test");

    const results = await Promise.allSettled([
      placeRequest({
        buyer: buyerA,
        bookIds: [book._id],
        idempotencyKey: "attempt-a-1",
      }),
      placeRequest({
        buyer: buyerB,
        bookIds: [book._id],
        idempotencyKey: "attempt-b-1",
      }),
    ]);

    const fulfilled = results.filter((result) => result.status === "fulfilled");
    const rejected = results.filter((result) => result.status === "rejected");
    assert.equal(fulfilled.length, 1);
    assert.equal(rejected.length, 1);
    assert.equal(rejected[0].reason.status, 409);
    assert.match(rejected[0].reason.message, /unavailable/i);
    assert.equal(fulfilled[0].value.order.status, "Requested");

    const remaining = await Book.findById(book._id);
    assert.equal(remaining.quantity, 0);
    assert.equal(await Order.countDocuments({ status: "Requested" }), 1);
  });

  it("replays the same idempotency key without reducing stock again", async () => {
    const book = await seedBook(2);
    const buyer = await seedBuyer("retry@bookly.test");

    const first = await placeRequest({
      buyer,
      bookIds: [book._id],
      idempotencyKey: "same-attempt-01",
    });
    const second = await placeRequest({
      buyer,
      bookIds: [book._id],
      idempotencyKey: "same-attempt-01",
    });

    assert.equal(second.replay, true);
    assert.equal(String(second.order._id), String(first.order._id));
    const remaining = await Book.findById(book._id);
    assert.equal(remaining.quantity, 1);
    assert.equal(await Order.countDocuments(), 1);

    const other = await seedBook(1);
    await assert.rejects(
      () =>
        placeRequest({
          buyer,
          bookIds: [other._id],
          idempotencyKey: "same-attempt-01",
        }),
      (err) => err.status === 409 && /different order/i.test(err.message)
    );
  });

  it("leaves stock unchanged when order creation fails", async () => {
    const book = await seedBook(1);
    const buyer = await seedBuyer("fail@bookly.test");
    const originalCreate = Order.create;
    Order.create = async function () {
      throw new Error("simulated create failure");
    };

    try {
      await assert.rejects(
        () =>
          placeRequest({
            buyer,
            bookIds: [book._id],
            idempotencyKey: "fail-attempt-01",
          }),
        /simulated create failure/
      );
    } finally {
      Order.create = originalCreate;
    }

    const remaining = await Book.findById(book._id);
    assert.equal(remaining.quantity, 1);
    assert.equal(await Order.countDocuments(), 0);
  });

  it("restores stock only once when a request is cancelled twice", async () => {
    const book = await seedBook(1);
    const buyer = await seedBuyer("cancel@bookly.test");
    const { order } = await placeRequest({
      buyer,
      bookIds: [book._id],
      idempotencyKey: "cancel-attempt-01",
    });

    assert.equal((await Book.findById(book._id)).quantity, 0);

    const first = await cancelRequest({ buyer, orderId: order._id });
    const second = await cancelRequest({ buyer, orderId: order._id });

    assert.equal(first.status, "Cancelled");
    assert.equal(second.status, "Cancelled");
    assert.equal((await Book.findById(book._id)).quantity, 1);
  });
});
