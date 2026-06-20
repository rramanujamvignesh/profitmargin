/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { Product, MonthlySelection, DiscountSettings, ProfitResult } from './types';

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

  for (const bracket of brackets) {
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
  
  // Apply precisions from original pricing sheet if matches
  if (product.fixedVolumePrices && product.fixedVolumePrices[volPercent] !== undefined) {
    // If the PDF listed a specific whole price for that bracket, use it
    const fixedRowPrice = product.fixedVolumePrices[volPercent];
    volumeDiscountedPrice = fixedRowPrice;
  }
  
  const volumeDiscountAmount = product.dealerPrice - volumeDiscountedPrice;

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
 * Returns a unique grouping key combining Category Group, SKU Unit, and structural Volume Discount slab.
 * This ensures that products are pooled only if they share the same group, unit, and exact volume discount brackets.
 */
export function getVolumeGroupKey(product: Product): string {
  if (!product.volumeDiscountRule) return '';
  const catGroup = getCategoryGroup(product.category);
  const unit = product.volumeDiscountRule.unit;
  const bracketsStr = JSON.stringify(product.volumeDiscountRule.brackets);
  return `${catGroup}|${unit}|${bracketsStr}`;
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
  for (const bracket of brackets) {
    if (groupVolume >= bracket.min && groupVolume <= bracket.max) {
      return bracket.discountPercent;
    }
  }

  return 0;
}

