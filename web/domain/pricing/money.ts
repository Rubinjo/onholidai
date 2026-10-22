import { z } from "zod";

import { moneySchema } from "../trip/schema";

export { moneySchema, componentPriceSchema, tripPriceSchema } from "../trip/schema";
export type Money = z.infer<typeof moneySchema>;

export function addMoney(first: Money, ...rest: readonly Money[]): Money {
  const amounts = [first, ...rest].map((amount) => moneySchema.parse(amount));
  if (amounts.some((amount) => amount.currency !== first.currency))
    throw new Error("Money currencies must match");
  return moneySchema.parse({
    currency: first.currency,
    minorUnits: amounts.reduce((total, amount) => total + amount.minorUnits, 0),
  });
}
