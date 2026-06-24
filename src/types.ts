/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

export type ProductCategory =
  | 'Tile Fix'
  | 'Wall Putty & Block Fix'
  | 'Tile Grouts'
  | 'Epoxy Tile Grouts'
  | 'Waterproofing Coating'
  | 'Bonding Agents'
  | 'Liquid Waterproofing (IWP)'
  | 'Strong Block / RAMCO'
  | 'Special Products';

export type UnitType = 'kg' | 'L';

export interface VolumeBracket {
  min: number; // in the matching unit (MT, kg, L)
  max: number; // in the matching unit
  discountPercent: number;
}

export type BracketUnit = 'MT' | 'kg' | 'L';

export interface VolumeDiscountRule {
  unit: BracketUnit; // MT, kg, L
  brackets: VolumeBracket[];
  customLabel?: string; // If special text is needed
}

export interface Product {
  id: string;
  name: string;
  sku: string;
  skuWeight: number; // numeric value of weight/volume (e.g. 20, 50)
  skuUnit: UnitType; // 'kg' or 'L'
  dealerPrice: number;
  category: ProductCategory;
  volumeDiscountRule: VolumeDiscountRule | null;
  fixedVolumePrices?: { [percent: number]: number }; // Optional overrides to match company sheets precisely
}

export interface MonthlySelection {
  productId: string;
  quantity: number; // Number of SKUs (bags/packs/bottles) entered
}

export interface DiscountSettings {
  adPercent: number; // Additional Discount (usually 3%)
  cdPeriod: '0-7' | '8-15' | '16-30' | 'none'; // Cash discount period
  growthRate: 'low' | 'medium' | 'high' | 'none'; // Quarterly growth category
}

export interface ProfitResult {
  product: Product;
  quantity: number;
  totalWeightUnit: string; // e.g. "0.40 MT" or "20 kg"
  totalWeightValue: number; // numeric total weight in the product's rule unit
  dealerPrice: number;
  volumeDiscountPercent: number;
  volumeDiscountAmount: number;
  adPercent: number;
  adAmount: number;
  cdPercent: number;
  cdAmount: number;
  growthPercent: number;
  growthAmount: number;
  purchaseUnitPrice: number;
  profitPerUnit: number;
  totalRevenue: number;
  totalCost: number;
  totalProfit: number;
  profitMarginPercent: number;
  customSellingPrice?: number;
  sellingPrice: number;
  usedFixedPrice?: boolean;
}
