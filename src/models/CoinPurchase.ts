import mongoose, { Schema, Document } from "mongoose";

/**
 * One coin-pack purchase through Razorpay. Created when the order is opened,
 * marked paid once the payment is verified (by the checkout callback or the
 * webhook, whichever arrives first). The coins themselves are a CoinLedger
 * line keyed "purchase:<orderId>", so a purchase can never pay out twice.
 */
export interface ICoinPurchase extends Document {
  userId: mongoose.Types.ObjectId;
  packId: string;
  coins: number;
  amountPaise: number;
  razorpayOrderId: string;
  razorpayPaymentId: string;
  status: "created" | "paid";
  paidAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

const coinPurchaseSchema = new Schema<ICoinPurchase>(
  {
    userId: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },
    packId: { type: String, required: true },
    coins: { type: Number, required: true },
    amountPaise: { type: Number, required: true },
    razorpayOrderId: { type: String, required: true, unique: true },
    razorpayPaymentId: { type: String, default: "" },
    status: { type: String, enum: ["created", "paid"], default: "created" },
    paidAt: { type: Date, default: null },
  },
  { timestamps: true }
);

export const CoinPurchase = mongoose.model<ICoinPurchase>("CoinPurchase", coinPurchaseSchema);
