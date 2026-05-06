/** YekPay gateway: pure numeric orderNumber, max length under 20. */
export const MAX_YEKPAY_ORDER_NUMBER_LENGTH = 19;

/**
 * Unique pure-numeric YekPay orderNumber (stored as provider_order_id).
 * Format: timestamp + 5-digit random — digits only, no prefix.
 */
export function generateUniqueOrderId() {
  let orderNumber =
    String(Date.now()) + String(Math.floor(Math.random() * 100_000));
  if (orderNumber.length >= 20) {
    orderNumber = orderNumber.slice(0, MAX_YEKPAY_ORDER_NUMBER_LENGTH);
  }
  return orderNumber;
}

/** @deprecated use MAX_YEKPAY_ORDER_NUMBER_LENGTH */
export const MAX_PAYMENT_ORDER_ID_LENGTH = 64;
