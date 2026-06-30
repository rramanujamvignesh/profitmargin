/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { Product, MonthlySelection, DiscountSettings, ProfitResult, VolumeDiscountRule } from './types';
import { MASTER_PRODUCTS } from './data';

/**
 * Returns the total volume value of a product given its monthly quantity.
 * Conversions:
 * - If unit matches 'MT' (Metric Tons) and product unit is 'kg':
 *   bags (quantity) * kg per bag / 1000 = Metric Tons
 * - Otherwise: quantity * weight per SKU
 */
export function getVolumeValue(product: Product, quantity: number): number {
  if (!product.volumeDiscountRule) return 0;
  
  const ruleUnit = product.volumeDiscountRule.unit;
  const skuWeight = product.skuWeight;

  if (ruleUnit === 'MT') {
    if (product.skuUnit === 'kg') {
      return (quantity * skuWeight) / 1000;
    }
  }
  
  // Default to raw SKU weight times quantity
  return quantity * skuWeight;
}

/**
 * Calculates the volume discount percentage based on active brackets.
 */
export function getVolumeDiscountPercent(product: Product, quantity: number): number {
  if (!product.volumeDiscountRule || quantity <= 0) return 0;

  const volumeValue = getVolumeValue(product, quantity);
  const brackets = product.volumeDiscountRule.brackets;

  // Search from highest to lowest bracket to ensure boundary values (min) get matched to the higher bracket
  for (let i = brackets.length - 1; i >= 0; i--) {
    const bracket = brackets[i];
    if (volumeValue >= bracket.min && volumeValue <= bracket.max) {
      return bracket.discountPercent;
    }
  }

  return 0;
}

/**
 * Returns helper percentages for cash discount (CD) and growth periods.
 */
export function getCashDiscountPercent(period: DiscountSettings['cdPeriod']): number {
  switch (period) {
    case '0-7':
      return 3;
    case '8-15':
      return 2;
    case '16-30':
      return 1;
    default:
      return 0;
  }
}

export function getGrowthDiscountPercent(rate: DiscountSettings['growthRate']): number {
  switch (rate) {
    case 'low': // 5-9.99% growth
      return 3;
    case 'medium': // 10-19.99% growth
      return 5;
    case 'high': // >20% growth
      return 7;
    default:
      return 0;
  }
}

/**
 * Computes all profits, revenues, and purchase prices for a single product selection.
 */
export function calculateProfitSingle(
  product: Product,
  quantity: number,
  settings: DiscountSettings,
  customSellingPrice?: number,
  overrideVolumeDiscountPercent?: number,
  overrideAdPercent?: number
): ProfitResult {
  // 1. Calculate Volume Discount
  const volPercent = overrideVolumeDiscountPercent !== undefined 
    ? overrideVolumeDiscountPercent 
    : getVolumeDiscountPercent(product, quantity);
  const volumeValue = getVolumeValue(product, quantity);
  
  // Format the volume label (e.g. "0.50 MT" or "150 kgs")
  const ruleUnit = product.volumeDiscountRule?.unit || product.skuUnit;
  const totalWeightUnit = `${volumeValue.toFixed(2)} ${ruleUnit}`;

  // 2. Determine volume-discounted price per unit
  let volumeDiscountedPrice = product.dealerPrice * (1 - volPercent / 100);
  let usedFixedPrice = false;
  
  const masterProd = MASTER_PRODUCTS.find(p => p.id.toLowerCase() === product.id.toLowerCase());
  const isDefaultPrice = masterProd ? masterProd.dealerPrice === product.dealerPrice : true;

  if (isDefaultPrice && product.fixedVolumePrices && product.fixedVolumePrices[volPercent] !== undefined) {
    // If the PDF listed a specific whole price for that bracket, use it
    const fixedRowPrice = product.fixedVolumePrices[volPercent];
    volumeDiscountedPrice = fixedRowPrice;
    usedFixedPrice = true;
  }
  
  const volumeDiscountAmount = isDefaultPrice && usedFixedPrice
    ? (product.dealerPrice - volumeDiscountedPrice)
    : (product.dealerPrice * (volPercent / 100));

  if (!usedFixedPrice) {
    volumeDiscountedPrice = product.dealerPrice - volumeDiscountAmount;
  }

  // 3. Additional Discount (AD) — calculated from base Dealer Price
  const adPercent = overrideAdPercent !== undefined ? overrideAdPercent : settings.adPercent;
  const adAmount = product.dealerPrice * (adPercent / 100);

  // 4. Cash Discount (CD) — calculated from base Dealer Price
  const cdPercent = getCashDiscountPercent(settings.cdPeriod);
  const cdAmount = product.dealerPrice * (cdPercent / 100);

  // 5. Quarterly Growth Discount — calculated from base Dealer Price
  const growthPercent = getGrowthDiscountPercent(settings.growthRate);
  const growthAmount = product.dealerPrice * (growthPercent / 100);

  // 6. Final Net Purchase Unit Price
  // Subtracting discounts from the volume-discounted price
  const purchaseUnitPrice = Math.max(0, volumeDiscountedPrice - adAmount - cdAmount - growthAmount);

  // 7. Selling price is custom selling price or exactly the original Dealer Price
  const hasCustomPrice = customSellingPrice !== undefined && customSellingPrice !== null && !isNaN(customSellingPrice) && customSellingPrice > 0;
  const sellingPrice = hasCustomPrice ? customSellingPrice! : product.dealerPrice;
  const profitPerUnit = sellingPrice - purchaseUnitPrice;

  // 8. Totals
  const totalRevenue = quantity * sellingPrice;
  const totalCost = quantity * purchaseUnitPrice;
  const totalProfit = quantity * profitPerUnit;

  // 9. Profit Margin %
  const profitMarginPercent = totalCost > 0 ? (totalProfit / totalCost) * 100 : 0;

  return {
    product,
    quantity,
    totalWeightUnit,
    totalWeightValue: volumeValue,
    dealerPrice: product.dealerPrice,
    volumeDiscountPercent: volPercent,
    volumeDiscountAmount,
    adPercent,
    adAmount,
    cdPercent,
    cdAmount,
    growthPercent,
    growthAmount,
    purchaseUnitPrice,
    profitPerUnit,
    totalRevenue,
    totalCost,
    totalProfit,
    profitMarginPercent,
    customSellingPrice: hasCustomPrice ? customSellingPrice : undefined,
    sellingPrice,
    usedFixedPrice,
  };
}

/**
 * Returns the simplified category group name for volume discount pooling.
 * Specifically groups "Tile Fix (20 KG)" and "Tile Fix (40 KG)" into "Tile Fix".
 */
export function getCategoryGroup(category: string): string {
  if (category === 'Tile Fix (20 KG)' || category === 'Tile Fix (40 KG)' || category === 'Tile Fix') {
    return 'Tile Fix';
  }
  return category;
}

/**
 * Normalizes a VolumeDiscountRule deterministically, ignoring key order or floating precision differences.
 */
export function normalizeVolumeDiscountRule(rule?: VolumeDiscountRule | null): string {
  if (!rule) return '';
  const unit = rule.unit || 'none';
  const brackets = rule.brackets || [];
  // Deterministic string representation, sorted by min
  const bracketsStr = [...brackets]
    .sort((a, b) => a.min - b.min)
    .map(b => `${Number(b.min).toFixed(4)}:${Number(b.max).toFixed(4)}:${Number(b.discountPercent).toFixed(4)}`)
    .join('|');
  return `${unit}[${bracketsStr}]`;
}

/**
 * Normalizes fixedVolumePrices Record deterministically.
 */
export function normalizeFixedVolumePrices(prices?: Record<number, number> | null): string {
  if (!prices) return '';
  const sortedKeys = Object.keys(prices)
    .map(Number)
    .sort((a, b) => a - b);
  return sortedKeys.map(k => `${k}:${Number(prices[k]).toFixed(4)}`).join(',');
}

/**
 * Returns a unique grouping key combining Category Group, SKU Unit, and structural Volume Discount slab.
 * This ensures that products are pooled only if they share the same group, unit, and exact volume discount brackets.
 */
export function getVolumeGroupKey(product: Product): string {
  if (!product.volumeDiscountRule) return '';
  const catGroup = getCategoryGroup(product.category);
  const ruleStr = normalizeVolumeDiscountRule(product.volumeDiscountRule);
  return `${catGroup}|${ruleStr}`;
}

/**
 * Computes active group volumes for all products with active quantities
 * groupVolumes[volumeGroupKey] = totalSummedVolume
 */
export function getActiveGroupVolumes(
  products: Product[],
  quantities: Record<string, number>
): Record<string, number> {
  const groupVolumes: Record<string, number> = {};

  products.forEach((prod) => {
    const qty = quantities[prod.id] || 0;
    if (qty <= 0 || !prod.volumeDiscountRule) return;

    const key = getVolumeGroupKey(prod);
    if (!key) return;

    const vol = getVolumeValue(prod, qty);
    groupVolumes[key] = (groupVolumes[key] || 0) + vol;
  });

  return groupVolumes;
}

/**
 * Looks up volume discount percentage from a product's rule using the aggregated group volume.
 */
export function getGroupVolumeDiscountPercent(
  product: Product,
  groupVolumes: Record<string, number>
): number {
  if (!product.volumeDiscountRule) return 0;

  const key = getVolumeGroupKey(product);
  const groupVolume = groupVolumes[key] || 0;
  if (groupVolume <= 0) return 0;

  const brackets = product.volumeDiscountRule.brackets;
  // Search from highest to lowest bracket to ensure boundary values (min) get matched to the higher bracket
  for (let i = brackets.length - 1; i >= 0; i--) {
    const bracket = brackets[i];
    if (groupVolume >= bracket.min && groupVolume <= bracket.max) {
      return bracket.discountPercent;
    }
  }

  return 0;
}

/**
 * Compares two Product objects deterministically, ignoring key order in rules or prices.
 */
export function isProductEqual(p1: Product, p2: Product): boolean {
  if (p1.id !== p2.id) return false;
  if (p1.name !== p2.name) return false;
  if (p1.sku !== p2.sku) return false;
  if (p1.skuWeight !== p2.skuWeight) return false;
  if (p1.skuUnit !== p2.skuUnit) return false;
  if (p1.dealerPrice !== p2.dealerPrice) return false;
  if (p1.category !== p2.category) return false;
  
  const rule1 = normalizeVolumeDiscountRule(p1.volumeDiscountRule);
  const rule2 = normalizeVolumeDiscountRule(p2.volumeDiscountRule);
  if (rule1 !== rule2) return false;

  const prices1 = normalizeFixedVolumePrices(p1.fixedVolumePrices);
  const prices2 = normalizeFixedVolumePrices(p2.fixedVolumePrices);
  if (prices1 !== prices2) return false;

  return true;
}

