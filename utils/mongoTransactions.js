const mongoose = require("mongoose");

async function assertTransactionsSupported() {
  if (mongoose.connection.readyState !== 1) {
    const err = new Error("Database is not connected.");
    err.status = 503;
    throw err;
  }

  const hello = await mongoose.connection.db.command({ hello: 1 });
  const isReplicaSet = Boolean(hello.setName);
  const isMongos = hello.msg === "isdbgrid";
  if (isReplicaSet || isMongos) {
    return;
  }

  const err = new Error(
    "Book requests need a MongoDB replica set so stock and the order commit together. Local setup: start mongod with --replSet rs0, then run rs.initiate() in mongosh. MongoDB Atlas already provides a replica set. A standalone mongod cannot run this safely."
  );
  err.status = 503;
  throw err;
}

module.exports = { assertTransactionsSupported };
