const mongoose = require("mongoose");

const orderSchema = new mongoose.Schema(
{
    user: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "User",
        required: true,
    },

    books: [
        {
            book: {
                type: mongoose.Schema.Types.ObjectId,
                ref: "Book",
                required: true,
            },
            quantity: {
                type: Number,
                default: 1,
            },
        },
    ],

    totalAmount: {
        type: Number,
        required: true,
    },

    razorpayOrderId: {
        type: String,
    },

    razorpayPaymentId: {
        type: String,
    },

    status: {
        type: String,
        default: "Paid",
    },
},
{
    timestamps: true,
});

module.exports = mongoose.model("Order", orderSchema);