// Locale-aware formatting and fee calculations shared across dashboard features.
// /\ Use Persian digits for every price while comparing the original numeric values.
    const numberFormat = new Intl.NumberFormat("fa-IR", { maximumFractionDigits: 0 });
    const decimalNumberFormat = new Intl.NumberFormat("fa-IR", { maximumFractionDigits: 2 });
    // /\ Keep small price moves visible as a useful percentage while formatting it with Persian digits.
    const movementPercentFormat = new Intl.NumberFormat("fa-IR", { minimumFractionDigits: 2, maximumFractionDigits: 3 });

    // /\ Return the known fee object; a nil value must stay unknown instead of silently becoming zero.
    function feeFor(price, side) {
      return price[`${side}Fee`];
    }

    // /\ Included fees are already in the quote; otherwise the API's known fee object makes the estimate comparable.
    function feeKnown(price, side) {
      return price.feeIncludedInPrice || feeFor(price, side) != null;
    }

    // /\ Preserve the project's existing buy-adds and sell-subtracts fee convention for whole orders.
    function effectiveTotal(price, side, grams) {
      const fee = feeFor(price, side) || { rate: 0, fixedToman: 0 };
      const base = price[side] * grams;
      if (price.feeIncludedInPrice) return base;
      return side === "buy"
        ? base * (1 + fee.rate) + fee.fixedToman
        : base * (1 - fee.rate) - fee.fixedToman;
    }

    // /\ Format toman amounts consistently; the caller always sorts the unformatted numeric value.
    function formatToman(value, decimals = 0) {
      const formatted = decimals ? decimalNumberFormat.format(value) : numberFormat.format(Math.round(value));
      return `${formatted} تومان`;
    }

    // /\\ Render the backend's per-quote age compactly; this value advances on each API poll.

export { numberFormat, decimalNumberFormat, movementPercentFormat, feeFor, feeKnown, effectiveTotal, formatToman };
