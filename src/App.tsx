/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useMemo, useEffect } from 'react';
import {
  MASTER_PRODUCTS,
  GROUT_DISCOUNT_RULE,
  MT_DISCOUNT_RULE,
  BONDING_AGENT_SBR_RULE,
  IWP_LIQUID_RULE,
  STRONG_BLOCK_RULE
} from './data';
import { Product, DiscountSettings, ProfitResult, ProductCategory, UnitType } from './types';
import { db } from './firebase';
import { collection, onSnapshot, doc, setDoc, deleteDoc, writeBatch } from 'firebase/firestore';
import { 
  calculateProfitSingle, 
  getVolumeValue, 
  getVolumeDiscountPercent,
  getCategoryGroup,
  getActiveGroupVolumes,
  getGroupVolumeDiscountPercent,
  getVolumeGroupKey
} from './utils';
import { 
  Calculator, 
  TrendingUp, 
  Coins, 
  Layers, 
  Search, 
  RefreshCw, 
  FileText, 
  CheckCircle2, 
  Info,
  ChevronRight,
  TrendingDown,
  ShoppingBag,
  Sliders,
  DollarSign,
  Plus,
  Minus,
  Check,
  Edit2,
  X,
  AlertCircle,
  Trash2,
  Lock,
  Key,
  Share2,
  Download,
  Copy,
  Camera
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import * as XLSX from 'xlsx';
import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';

// Categories lists
const CATEGORIES: (ProductCategory | 'All')[] = [
  'All',
  'Tile Fix',
  'Wall Putty & Block Fix',
  'Tile Grouts',
  'Epoxy Tile Grouts',
  'Waterproofing Coating',
  'Bonding Agents',
  'Liquid Waterproofing (IWP)',
  'Strong Block / RAMCO',
  'Special Products'
];

const SIMULATOR_CATEGORIES = [
  'All',
  'Tile Fix',
  'Wall Putty & Block Fix',
  'Tile Grouts',
  'Epoxy Tile Grouts',
  'Waterproofing Coating',
  'Bonding Agents',
  'Liquid Waterproofing (IWP)',
  'Strong Block / RAMCO',
  'Special Products'
];

export default function App() {
  // --- STATE ---
  const [activeTab, setActiveTab] = useState<'calculator' | 'backend'>('calculator');
  const [products, setProducts] = useState<Product[]>(() => {
    const saved = localStorage.getItem('commercial_master_products_v3');
    if (saved) {
      try {
        return JSON.parse(saved);
      } catch (e) {
        console.error("Error loading custom master products from localStorage", e);
      }
    }
    return MASTER_PRODUCTS;
  });

  // Sync products with Firestore in real-time
  useEffect(() => {
    const colRef = collection(db, "products");
    const unsubscribe = onSnapshot(colRef, async (snapshot) => {
      if (snapshot.empty) {
        // If Firestore is empty, check if we have any custom products in localStorage first
        let seedProducts = MASTER_PRODUCTS;
        const saved = localStorage.getItem('commercial_master_products_v3');
        if (saved) {
          try {
            const parsed = JSON.parse(saved);
            if (Array.isArray(parsed) && parsed.length > 0) {
              seedProducts = parsed;
              console.log("Seeding Firestore from existing localStorage products:", seedProducts.length);
            }
          } catch (e) {
            console.error("Error parsing saved products for seeding:", e);
          }
        }

        try {
          const batch = writeBatch(db);
          seedProducts.forEach((p) => {
            const docRef = doc(db, "products", p.id);
            batch.set(docRef, p);
          });
          await batch.commit();
        } catch (err) {
          console.error("Error seeding initial products to Firestore:", err);
        }
      } else {
        const loadedProducts: Product[] = [];
        const loadedIds = new Set<string>();
        snapshot.forEach((doc) => {
          const p = doc.data() as Product;
          loadedProducts.push(p);
          loadedIds.add(p.id.toLowerCase());
        });

        // Auto-heal/sync missing MASTER_PRODUCTS (e.g. if we added new products like HW 200)
        const missingMasterProducts = MASTER_PRODUCTS.filter(mp => !loadedIds.has(mp.id.toLowerCase()));
        if (missingMasterProducts.length > 0) {
          console.log(`Syncing ${missingMasterProducts.length} missing master products to Firestore...`);
          try {
            const batch = writeBatch(db);
            missingMasterProducts.forEach((mp) => {
              const docRef = doc(db, "products", mp.id);
              batch.set(docRef, mp);
              loadedProducts.push(mp);
            });
            await batch.commit();
          } catch (err) {
            console.error("Error syncing missing master products:", err);
          }
        }

        // Maintain original category order of MASTER_PRODUCTS
        const orderMap = new Map<string, number>();
        MASTER_PRODUCTS.forEach((p, idx) => orderMap.set(p.id, idx));

        loadedProducts.sort((a, b) => {
          const idxA = orderMap.get(a.id) ?? 9999;
          const idxB = orderMap.get(b.id) ?? 9999;
          if (idxA !== idxB) return idxA - idxB;
          return a.name.localeCompare(b.name);
        });

        setProducts(loadedProducts);
        localStorage.setItem('commercial_master_products_v3', JSON.stringify(loadedProducts));
      }
    }, (error) => {
      console.error("Firestore subscription error:", error);
    });

    return () => unsubscribe();
  }, []);

  const updateProductsAndPersist = async (newProducts: Product[]) => {
    setProducts(newProducts);
    localStorage.setItem('commercial_master_products_v3', JSON.stringify(newProducts));

    try {
      const batch = writeBatch(db);

      // Identify what was deleted from products list
      const currentIds = new Set(newProducts.map(p => p.id));
      products.forEach((p) => {
        if (!currentIds.has(p.id)) {
          const docRef = doc(db, "products", p.id);
          batch.delete(docRef);
        }
      });

      // Identify what was added or modified
      const existingMap = new Map<string, Product>();
      products.forEach(p => existingMap.set(p.id, p));

      newProducts.forEach((p) => {
        const existing = existingMap.get(p.id);
        if (!existing || JSON.stringify(existing) !== JSON.stringify(p)) {
          const docRef = doc(db, "products", p.id);
          batch.set(docRef, p);
        }
      });

      await batch.commit();
    } catch (err) {
      console.error("Error writing changes to Firestore:", err);
    }
  };

  const handleResetToDefaultPricing = async () => {
    if (window.confirm("Are you sure you want to restore built-in master pricing & discount tiers? This will overwrite your current configurations.")) {
      try {
        const batch = writeBatch(db);
        
        // Delete current products in Firestore
        products.forEach((p) => {
          const docRef = doc(db, "products", p.id);
          batch.delete(docRef);
        });

        // Set default MASTER_PRODUCTS
        MASTER_PRODUCTS.forEach((p) => {
          const docRef = doc(db, "products", p.id);
          batch.set(docRef, p);
        });

        await batch.commit();

        setPricingImportStatus({
          type: 'success',
          message: 'Reverted pricing & discount definitions to default settings.'
        });
      } catch (err) {
        console.error("Error resetting Firestore products:", err);
        setPricingImportStatus({
          type: 'error',
          message: 'Failed to reset Firestore: ' + (err as Error).message
        });
      }
    }
  };

  const [quantities, setQuantities] = useState<Record<string, number>>({});
  const [deferredPrompt, setDeferredPrompt] = useState<any>(null);
  const [isInstallable, setIsInstallable] = useState(false);

  useEffect(() => {
    const handleBeforeInstallPrompt = (e: Event) => {
      e.preventDefault();
      setDeferredPrompt(e);
      setIsInstallable(true);
    };

    window.addEventListener('beforeinstallprompt', handleBeforeInstallPrompt);

    // Initial check for display standalone mode
    if (window.matchMedia('(display-mode: standalone)').matches || (navigator as any).standalone) {
      setIsInstallable(false);
    }

    return () => {
      window.removeEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
    };
  }, []);

  const handleInstallApp = async () => {
    if (!deferredPrompt) return;
    deferredPrompt.prompt();
    const { outcome } = await deferredPrompt.userChoice;
    console.log(`[PWA] Install status selected by user: ${outcome}`);
    setIsInstallable(false);
    setDeferredPrompt(null);
  };

  const [customSellingPrices, setCustomSellingPrices] = useState<Record<string, number>>({});
  const [productAdPercents, setProductAdPercents] = useState<Record<string, number>>({});
  const [importStatus, setImportStatus] = useState<{ type: 'success' | 'error' | null; message: string }>({ type: null, message: '' });
  const [pricingImportStatus, setPricingImportStatus] = useState<{ type: 'success' | 'error' | null; message: string }>({ type: null, message: '' });
  const [isBackendUnlocked, setIsBackendUnlocked] = useState(false);
  const [enteredPassword, setEnteredPassword] = useState('');
  const [passwordError, setPasswordError] = useState('');

  // Auto-lock the backend after 10 minutes of inactivity
  useEffect(() => {
    if (!isBackendUnlocked) return;

    let timeoutId: NodeJS.Timeout;

    const resetTimer = () => {
      if (timeoutId) clearTimeout(timeoutId);
      timeoutId = setTimeout(() => {
        setIsBackendUnlocked(false);
      }, 10 * 60 * 1000); // 10 minutes
    };

    // Initialize timer
    resetTimer();

    // Listen for user activity events
    const events = ['mousemove', 'keydown', 'click', 'scroll', 'touchstart'];
    events.forEach(event => {
      window.addEventListener(event, resetTimer);
    });

    return () => {
      if (timeoutId) clearTimeout(timeoutId);
      events.forEach(event => {
        window.removeEventListener(event, resetTimer);
      });
    };
  }, [isBackendUnlocked]);
  const [isShareModalOpen, setIsShareModalOpen] = useState(false);
  const [screenshotDataUrl, setScreenshotDataUrl] = useState<string | null>(null);
  const [isCapturing, setIsCapturing] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [activeCategory, setActiveCategory] = useState<string>('All');
  const [showActiveOnly, setShowActiveOnly] = useState(false);

  // Step 1 Cascading Dropdowns Selection States
  const [selectedGroup, setSelectedGroup] = useState<string>('Tile Fix');
  const [selectedProductName, setSelectedProductName] = useState<string>('TILE FIX-STANDARD - HW201');
  const [selectedSkuId, setSelectedSkuId] = useState<string>('tf-standard-hw201-20');
  const [inputQuantity, setInputQuantity] = useState<number>(1);
  const [settings, setSettings] = useState<DiscountSettings>({
    adPercent: 0,
    cdPeriod: '0-7',
    growthRate: 'medium',
  });
  const [showExplanationId, setShowExplanationId] = useState<string | null>(null);
  const [binProductIds, setBinProductIds] = useState<string[]>([]);
  const [selectedSkuByFamily, setSelectedSkuByFamily] = useState<Record<string, string>>({});

  // Pricing tab search options
  const [pricingSearchQuery, setPricingSearchQuery] = useState('');
  const [pricingActiveCategory, setPricingActiveCategory] = useState<ProductCategory | 'All'>('All');

  // Filtered pricing products for the Backend table view
  const filteredPricingProducts = useMemo(() => {
    return products.filter((p) => {
      const matchesCategory = pricingActiveCategory === 'All' || p.category === pricingActiveCategory;
      const matchesSearch = p.name.toLowerCase().includes(pricingSearchQuery.toLowerCase()) ||
                            p.id.toLowerCase().includes(pricingSearchQuery.toLowerCase()) ||
                            p.sku.toLowerCase().includes(pricingSearchQuery.toLowerCase()) ||
                            p.category.toLowerCase().includes(pricingSearchQuery.toLowerCase());
      return matchesCategory && matchesSearch;
    });
  }, [products, pricingSearchQuery, pricingActiveCategory]);

  // Slab editor modal state
  const [editingProductSlabs, setEditingProductSlabs] = useState<Product | null>(null);
  const [tempSlabs, setTempSlabs] = useState<{ min: number; discountPercent: number }[]>([]);
  const [tempUnit, setTempUnit] = useState<'MT' | 'kg' | 'L'>('kg');

  // Product info editing states
  const [editingProductId, setEditingProductId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const [editSku, setEditSku] = useState('');
  const [editSkuWeight, setEditSkuWeight] = useState<number>(20);
  const [editSkuUnit, setEditSkuUnit] = useState<UnitType>('kg');

  // Add Product modal states
  const [addProductModalOpen, setAddProductModalOpen] = useState(false);
  const [newProdName, setNewProdName] = useState('');
  const [newProdId, setNewProdId] = useState('');
  const [newProdSku, setNewProdSku] = useState('20 kg Bag');
  const [newProdSkuWeight, setNewProdSkuWeight] = useState<number>(20);
  const [newProdSkuUnit, setNewProdSkuUnit] = useState<'kg' | 'L'>('kg');
  const [newProdDealerPrice, setNewProdDealerPrice] = useState<number>(300);
  const [newProdCategory, setNewProdCategory] = useState<ProductCategory>('Tile Fix');
  const [newProdDiscountUnit, setNewProdDiscountUnit] = useState<'none' | 'MT' | 'kg' | 'L'>('none');
  const [newProdSlabs, setNewProdSlabs] = useState<{ min: number; discountPercent: number }[]>([]);
  const [newProdError, setNewProdError] = useState('');

  // --- COMPUTE PRODUCTS FAMILIES (GROUPED BY NAME AND CATEGORY) ---
  const productFamilies = useMemo(() => {
    const families: Record<string, { key: string; name: string; category: string; variants: Product[] }> = {};
    products.forEach(p => {
      const catGroup = p.category;
      const groupKey = `${catGroup}::${p.name}`;
      if (!families[groupKey]) {
        families[groupKey] = {
          key: groupKey,
          name: p.name,
          category: catGroup,
          variants: []
        };
      }
      families[groupKey].variants.push(p);
    });
    return Object.values(families);
  }, [products]);

  // --- AUTOMATIC DERIVATION OF SIMULATOR BIN SUBSET ---
  const activeBinProductIds = useMemo(() => {
    const ids = new Set<string>();
    binProductIds.forEach(id => ids.add(id));
    Object.keys(quantities).forEach(id => {
      if (quantities[id] > 0) {
        ids.add(id);
      }
    });
    Object.keys(customSellingPrices).forEach(id => {
      ids.add(id);
    });
    return Array.from(ids);
  }, [binProductIds, quantities, customSellingPrices]);

  // --- ACTIONS ---
  // Load standard pre-populated sales quantities for realistic demo metrics
  const handleLoadSample = () => {
    const sample: Record<string, number> = {
      // Tile Fix 20kg
      'tf-slurry-hw207-20': 150, // 3 MT -> 8% Vol Disc
      'tf-medium-hw202-20': 305, // 6.1 MT -> 9% Vol Disc
      // Epoxy Grouts
      'epoxy-grout-hw211-1': 80, // 80 kgs -> 10% Vol Disc
      'epoxy-grout-hw211-5': 30, // 150 kgs -> 10% Vol Disc
      // Waterproofing
      'wp-coating-hw103-15': 10, // 150 kgs -> 7% Vol Disc
      // Bonding Agents
      'bonding-agent-sbr-50l': 5, // 250 L -> 10% Vol Disc
      // IWP
      'iwp-hw101-20l': 20, // 400 L -> 20% Vol Disc
      // Strong Block
      'strong-block-50l': 12, // 600 L -> 15% Vol Disc
    };
    setQuantities(sample);
    setBinProductIds(Object.keys(sample));
  };

  const handleClearAll = () => {
    setQuantities({});
    setCustomSellingPrices({});
    setBinProductIds([]);
  };

  const handleAddToBin = (productId: string) => {
    if (!binProductIds.includes(productId)) {
      setBinProductIds((prev) => [...prev, productId]);
    }
    setQuantities((prev) => {
      const currentQty = prev[productId] || 0;
      return {
        ...prev,
        [productId]: currentQty > 0 ? currentQty : 1
      };
    });
  };

  const handleRemoveFromBin = (productId: string) => {
    setQuantities((prev) => {
      const updated = { ...prev };
      delete updated[productId];
      return updated;
    });
    setCustomSellingPrices((prev) => {
      const updated = { ...prev };
      delete updated[productId];
      return updated;
    });
    setBinProductIds((prev) => prev.filter(id => id !== productId));
  };

  const handleFamilySkuChange = (familyKey: string, productId: string) => {
    setSelectedSkuByFamily((prev) => ({
      ...prev,
      [familyKey]: productId
    }));
  };

  const updateQuantity = (productId: string, val: number) => {
    const safeVal = Math.max(0, isNaN(val) ? 0 : val);
    setQuantities((prev) => ({
      ...prev,
      [productId]: safeVal,
    }));
  };

  const updateCustomSellingPrice = (productId: string, val: number | string) => {
    const num = typeof val === 'string' ? parseFloat(val) : val;
    setCustomSellingPrices((prev) => {
      const updated = { ...prev };
      if (isNaN(num) || num <= 0) {
        delete updated[productId];
      } else {
        updated[productId] = num;
      }
      return updated;
    });
  };

  const updateProductAdPercent = (productId: string, val: number | string) => {
    const num = typeof val === 'string' ? parseFloat(val) : val;
    setProductAdPercents((prev) => {
      const updated = { ...prev };
      if (isNaN(num) || num < 0) {
        delete updated[productId];
      } else {
        updated[productId] = num;
      }
      return updated;
    });
  };

  // --- INTEGRATED GROUP VOLUMES FOR GROUPED SLABS ---
  const groupVolumes = useMemo(() => {
    return getActiveGroupVolumes(products, quantities);
  }, [products, quantities]);

  // --- DYNAMIC SLAB SATELLITE RECOMMENDATION ---
  const getNextSlabSuggestion = (product: Product, quantity: number, customPrice?: number, currentProfit: number = 0) => {
    if (!product.volumeDiscountRule || quantity <= 0) return null;

    const key = getVolumeGroupKey(product);
    const currentVolume = groupVolumes[key] || 0;

    const brackets = product.volumeDiscountRule.brackets;
    const activePercent = getGroupVolumeDiscountPercent(product, groupVolumes);

    const activeIndex = brackets.map((b, idx) => ({ ...b, idx }))
      .reverse()
      .find(b => currentVolume >= b.min && currentVolume <= b.max)?.idx ?? -1;

    // Next bracket has a discountPercent higher than activePercent, and min is greater than current volume
    const nextBracket = brackets.find((b, idx) => {
      if (activeIndex !== -1) {
        return idx > activeIndex && b.discountPercent > activePercent;
      } else {
        return b.min > currentVolume;
      }
    });

    if (!nextBracket) return null;

    const volumeNeeded = nextBracket.min;
    const volumePerSKU = getVolumeValue(product, 1);
    if (volumePerSKU <= 0) return null;

    const additionalVolumeNeeded = volumeNeeded - currentVolume;
    const additionalUnitsNeeded = Math.max(1, Math.ceil(additionalVolumeNeeded / volumePerSKU));

    const simulatedQuantity = quantity + additionalUnitsNeeded;
    const productAdPercentOverride = productAdPercents[product.id];
    const simulatedCalcResult = calculateProfitSingle(
      product, 
      simulatedQuantity, 
      settings, 
      customPrice, 
      nextBracket.discountPercent,
      productAdPercentOverride
    );

    return {
      additionalUnits: additionalUnitsNeeded,
      nextPercent: nextBracket.discountPercent,
      projectedProfit: simulatedCalcResult.totalProfit,
      profitIncrease: simulatedCalcResult.totalProfit - currentProfit,
      ruleUnit: product.volumeDiscountRule.unit
    };
  };

  // --- EXCEL OPERATIONS (Estimates) ---
  const downloadTemplate = () => {
    const templateData = products.map((p) => ({
      'Product Code (ID)': p.id,
      'Product Name': p.name,
      'SKU Unit': p.sku,
      'Dealer Price (INR)': p.dealerPrice,
      'Monthly Quantity Request (Units)': 0,
      'Custom Selling Price Override (INR)': '',
    }));

    const worksheet = XLSX.utils.json_to_sheet(templateData);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, "Sheet1");
    XLSX.writeFile(workbook, "Dealer_Commercial_Simulator_Template.xlsx");
  };

  const handleShareScreenshot = () => {
    const activeItems = activeCalculations.filter(calc => calc.quantity > 0);
    if (activeItems.length === 0) {
      alert("No active items in order summary to screenshot. Please adjust quantities of some items above.");
      return;
    }

    setIsShareModalOpen(true);
    setIsCapturing(true);
    setScreenshotDataUrl(null);

    // Wait slightly to let the off-screen division render accurately before capturing
    setTimeout(async () => {
      try {
        const element = document.getElementById('hardwork-profit-estimation-document');
        if (element) {
          const html2canvasModule = await import('html2canvas');
          const html2canvas = html2canvasModule.default;
          const canvas = await html2canvas(element, {
            scale: 2, // High resolution
            useCORS: true,
            allowTaint: true,
            backgroundColor: '#ffffff'
          });
          const dataUrl = canvas.toDataURL('image/png');
          setScreenshotDataUrl(dataUrl);
        } else {
          console.error("Screenshot element not found!");
        }
      } catch (err) {
        console.error("Error capturing screenshot:", err);
      } finally {
        setIsCapturing(false);
      }
    }, 500);
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (evt) => {
      try {
        const bstr = evt.target?.result;
        const wb = XLSX.read(bstr, { type: 'binary' });
        const wsname = wb.SheetNames[0];
        const ws = wb.Sheets[wsname];
        const data = XLSX.utils.sheet_to_json<any>(ws);

        if (!data || data.length === 0) {
          throw new Error("No data rows found in the uploaded sheet!");
        }

        const newQuantities: Record<string, number> = {};
        const newCustomPrices: Record<string, number> = {};
        let matchedCount = 0;

        data.forEach((row) => {
          let matchedProduct: Product | undefined;
          const keys = Object.keys(row);

          // Fuzzy helper
          const getValByKeys = (possibleHeadings: string[]) => {
            const foundKey = keys.find(k => 
              possibleHeadings.some(ph => k.toLowerCase().replace(/[^a-z0-9]/g, '').includes(ph.toLowerCase().replace(/[^a-z0-9]/g, '')))
            );
            return foundKey ? row[foundKey] : undefined;
          };

          const rowId = row['Product Code (ID)'] || row['ID'] || row['id'] || row['Code'] || row['Product Code'] || getValByKeys(['productcode', 'id', 'idcode', 'code']);
          const rowSku = row['SKU'] || row['sku'] || getValByKeys(['sku', 'unitweight']);
          const rowName = row['Product Name'] || row['Name'] || row['name'] || row['item'] || getValByKeys(['productname', 'name', 'item', 'description']);

          if (rowId) {
            const idStr = String(rowId).trim().toLowerCase();
            matchedProduct = products.find(p => p.id.toLowerCase() === idStr);
          }
          if (!matchedProduct && rowSku) {
            const skuStr = String(rowSku).trim().toLowerCase();
            matchedProduct = products.find(p => p.sku.toLowerCase() === skuStr || p.id.toLowerCase() === skuStr);
          }
          if (!matchedProduct && rowName) {
            const nameStr = String(rowName).trim().toLowerCase();
            matchedProduct = products.find(p => 
              p.name.toLowerCase() === nameStr || 
              p.name.toLowerCase().includes(nameStr) || 
              nameStr.includes(p.name.toLowerCase())
            );
          }

          if (matchedProduct) {
            matchedCount++;
            
            // Quantity Parse
            const qtyVal = row['Monthly Quantity Request (Units)'] || row['Monthly Quantity'] || row['Quantity'] || row['Qty'] || row['Volume'] || row['Bags'] || row['Packs'] || getValByKeys(['qty', 'quantity', 'volume', 'bag', 'pack', 'unit', 'monthlyquantity']);
            if (qtyVal !== undefined && qtyVal !== null && !isNaN(Number(qtyVal))) {
              const numQty = parseFloat(String(qtyVal));
              if (numQty > 0) {
                newQuantities[matchedProduct.id] = numQty;
              }
            }

            // Custom Selling Price Parse
            const priceVal = row['Custom Selling Price Override (INR)'] || row['Custom Selling Price'] || row['Selling Price'] || row['Selling Price Override'] || row['Price'] || row['Rate'] || getValByKeys(['customselling', 'sellingprice', 'customprice', 'rate', 'price', 'overriderate']);
            if (priceVal !== undefined && priceVal !== null && !isNaN(Number(priceVal))) {
              const numPrice = parseFloat(String(priceVal));
              if (numPrice > 0) {
                newCustomPrices[matchedProduct.id] = numPrice;
              }
            }
          }
        });

        if (matchedCount > 0) {
          setQuantities(newQuantities);
          setCustomSellingPrices(newCustomPrices);
          setImportStatus({
            type: 'success',
            message: `Successfully sync'ed Excel data! Matched ${matchedCount} lines. Profit margins corrected according to uploaded quantity metrics and custom pricing offsets.`
          });
        } else {
          setImportStatus({
            type: 'error',
            message: `Could not identify any matching products in this Excel file. Ensure columns 'Product Code (ID)' or 'Product Name' are correct.`
          });
        }
      } catch (err: any) {
        setImportStatus({
          type: 'error',
          message: `Error parsing Excel sheet: ${err?.message || 'Check template structure and try again.'}`
        });
      }
    };
    reader.readAsBinaryString(file);
    // Reset file input target value so user can upload the same file again if desired
    e.target.value = '';
  };

  // --- BACKEND EXCEL PRICING OPERATIONS ---
  const downloadPricingMasterTemplate = () => {
    const templateData = products.map((p) => {
      const rule = p.volumeDiscountRule;
      const row: Record<string, any> = {
        'Product ID': p.id,
        'Product Name': p.name,
        'Category': p.category,
        'SKU': p.sku,
        'SKU Weight': p.skuWeight,
        'SKU Unit': p.skuUnit,
        'Dealer Price (INR)': p.dealerPrice,
        'Discount Unit (MT, kg, L)': rule ? rule.unit : p.skuUnit,
      };

      for (let i = 1; i <= 7; i++) {
        const bracket = rule?.brackets[i - 1];
        row[`Slab ${i} Min Volume`] = bracket ? bracket.min : '';
        row[`Slab ${i} Discount %`] = bracket ? bracket.discountPercent : '';
      }

      return row;
    });

    const worksheet = XLSX.utils.json_to_sheet(templateData);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, "Pricing Rules Master");
    XLSX.writeFile(workbook, "Pricing_And_Discounts_Master.xlsx");
  };

  const handlePricingFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (evt) => {
      try {
        const bstr = evt.target?.result;
        const wb = XLSX.read(bstr, { type: 'binary' });
        const wsname = wb.SheetNames[0];
        const ws = wb.Sheets[wsname];
        const data = XLSX.utils.sheet_to_json<any>(ws);

        if (!data || data.length === 0) {
          throw new Error("No data rows found in the uploaded sheet!");
        }

        const updatedProductsList = [...products];
        let updatedCount = 0;

        data.forEach((row) => {
          const rowId = row['Product ID'] || row['ID'] || row['id'] || row['Product Code (ID)'] || row['Product Code'];
          if (!rowId) return;

          const productId = String(rowId).trim();
          const prodIndex = updatedProductsList.findIndex(p => p.id.toLowerCase() === productId.toLowerCase());

          // Parse Dealer Price
          const dealerPriceVal = row['Dealer Price (INR)'] || row['Dealer Price'] || row['price'] || row['Rate'] || row['Standard Dealer Price (INR)'];
          let parsedDealerPrice = 0;
          if (dealerPriceVal !== undefined && dealerPriceVal !== null && !isNaN(Number(dealerPriceVal))) {
            parsedDealerPrice = parseFloat(String(dealerPriceVal));
          }

          // Parse Discount Unit
          const discUnitVal = String(row['Discount Unit (MT, kg, L)'] || row['Discount Unit'] || row['Unit'] || row['Rule Unit'] || row['Volume Unit'] || '').trim();

          // Compile Slabs/Brackets
          const brackets: any[] = [];
          for (let i = 1; i <= 7; i++) {
            const minVal = row[`Slab ${i} Min Volume`];
            const pctVal = row[`Slab ${i} Discount %`];

            if (minVal !== undefined && minVal !== null && minVal !== '' && !isNaN(Number(minVal)) &&
                pctVal !== undefined && pctVal !== null && pctVal !== '' && !isNaN(Number(pctVal))) {
              brackets.push({
                min: parseFloat(String(minVal)),
                max: Infinity,
                discountPercent: parseFloat(String(pctVal))
              });
            }
          }

          // Sort brackets by min value ascending
          brackets.sort((a, b) => a.min - b.min);

          // Reconstruct max value of each slab to match the next slab's minimum
          for (let i = 0; i < brackets.length; i++) {
            if (i < brackets.length - 1) {
              brackets[i].max = brackets[i + 1].min - 0.01;
            } else {
              brackets[i].max = Infinity;
            }
          }

          let volumeDiscountRule = null;
          if (brackets.length > 0) {
            volumeDiscountRule = {
              unit: (discUnitVal === 'MT' || discUnitVal === 'kg' || discUnitVal === 'L') ? discUnitVal as 'MT' | 'kg' | 'L' : 'kg' as const,
              brackets: brackets
            };
          }

          if (prodIndex !== -1) {
            const currentItem = updatedProductsList[prodIndex];
            const updatedItem = { ...currentItem };

            if (dealerPriceVal !== undefined && dealerPriceVal !== null && !isNaN(Number(dealerPriceVal))) {
              updatedItem.dealerPrice = parsedDealerPrice;
            }

            if (volumeDiscountRule) {
              const finalUnit = (discUnitVal === 'MT' || discUnitVal === 'kg' || discUnitVal === 'L')
                ? (discUnitVal as 'MT' | 'kg' | 'L')
                : (currentItem.skuUnit === 'kg' ? 'kg' as const : 'L' as const);
              updatedItem.volumeDiscountRule = {
                unit: finalUnit,
                brackets: brackets
              };
            } else {
              updatedItem.volumeDiscountRule = null;
            }

            updatedProductsList[prodIndex] = updatedItem;
            updatedCount++;
          } else {
            // Create brand new product from spreadsheet row!
            let name = String(row['Product Name'] || row['Name'] || row['name'] || '').trim();
            if (!name) {
              name = productId.toUpperCase();
            }

            const categoryRaw = String(row['Category'] || row['category'] || 'Special Products').trim();
            const validCategories: ProductCategory[] = [
              'Tile Fix',
              'Wall Putty & Block Fix',
              'Tile Grouts',
              'Epoxy Tile Grouts',
              'Waterproofing Coating',
              'Bonding Agents',
              'Liquid Waterproofing (IWP)',
              'Strong Block / RAMCO',
              'Special Products'
            ];
            const category = validCategories.find(c => c.toLowerCase() === categoryRaw.toLowerCase()) || 'Special Products';

            const skuUnitRaw = String(row['SKU Unit'] || row['skuUnit'] || 'kg').trim().toLowerCase();
            const skuUnit: UnitType = (skuUnitRaw === 'l' || skuUnitRaw === 'L') ? 'L' : 'kg';

            const skuWeightVal = row['SKU Weight'] || row['skuWeight'] || 20;
            const skuWeight = !isNaN(Number(skuWeightVal)) ? parseFloat(String(skuWeightVal)) : 20;

            const sku = String(row['SKU'] || row['sku'] || `${skuWeight} ${skuUnit} Bag`).trim();

            const newProduct: Product = {
              id: productId,
              name: name.toUpperCase(),
              sku: sku,
              skuWeight: skuWeight,
              skuUnit: skuUnit,
              dealerPrice: parsedDealerPrice,
              category: category,
              volumeDiscountRule: volumeDiscountRule
            };

            updatedProductsList.push(newProduct);
            updatedCount++;
          }
        });

        if (updatedCount > 0) {
          updateProductsAndPersist(updatedProductsList);
          setPricingImportStatus({
            type: 'success',
            message: `Successfully sync'ed ${updatedCount} master product prices and volume discount matrices from Excel!`
          });
        } else {
          setPricingImportStatus({
            type: 'error',
            message: "Could not identify any matching Product IDs in this Excel file. Ensure column 'Product ID' is correct."
          });
        }
      } catch (err: any) {
        setPricingImportStatus({
          type: 'error',
          message: `Error parsing pricing Excel sheet: ${err?.message || 'Check template structure and try again.'}`
        });
      }
    };
    reader.readAsBinaryString(file);
    e.target.value = '';
  };

  // --- ADD NEW PRODUCT ACTIONS ---
  const handleNewProductNameChange = (val: string) => {
    setNewProdName(val);
    
    // Auto-generate suggestion ID: e.g. "TILE FIX-MEDIUM - HW202" -> "tf-medium-hw202"
    const slug = val
      .toLowerCase()
      .replace(/[^a-z0-9\s-]/g, '') // remove special chars
      .trim()
      .replace(/\s+/g, '-') // spaces to dashes
      .replace(/-+/g, '-'); // collapse double dashes
    
    setNewProdId(slug ? `${slug}-${newProdSkuWeight}` : '');
  };

  const handleAddFormSlab = () => {
    setNewProdSlabs([...newProdSlabs, { min: 0, discountPercent: 0 }]);
  };

  const handleRemoveFormSlab = (index: number) => {
    setNewProdSlabs(newProdSlabs.filter((_, idx) => idx !== index));
  };

  const handleFormSlabChange = (index: number, field: 'min' | 'discountPercent', value: number) => {
    const updated = newProdSlabs.map((item, idx) => {
      if (idx === index) {
        return { ...item, [field]: value };
      }
      return item;
    });
    setNewProdSlabs(updated);
  };

  const handleSaveNewProduct = () => {
    if (!newProdName.trim()) {
      setNewProdError('Product name is required.');
      return;
    }
    if (!newProdId.trim()) {
      setNewProdError('Product ID code is required.');
      return;
    }
    // Check if ID is already taken
    const idExists = products.some(p => p.id.toLowerCase() === newProdId.trim().toLowerCase());
    if (idExists) {
      setNewProdError(`A product with ID "${newProdId.trim()}" already exists. Please choose a unique ID.`);
      return;
    }
    if (newProdSkuWeight <= 0) {
      setNewProdError('SKU weight or volume must be a positive number.');
      return;
    }
    if (newProdDealerPrice < 0) {
      setNewProdError('Dealer price cannot be negative.');
      return;
    }

    let discountRule = null;
    if (newProdDiscountUnit !== 'none') {
      const validSlabs = newProdSlabs
        .filter(s => s.min >= 0 && s.discountPercent >= 0)
        .sort((a, b) => a.min - b.min);

      const brackets = validSlabs.map((s, idx) => {
        const nextSlab = validSlabs[idx + 1];
        const maxLimit = nextSlab ? nextSlab.min : Infinity;
        return {
          min: s.min,
          max: maxLimit,
          discountPercent: s.discountPercent
        };
      });

      discountRule = {
        unit: newProdDiscountUnit as 'MT' | 'kg' | 'L',
        brackets: brackets
      };
    }

    const newProduct: Product = {
      id: newProdId.trim(),
      name: newProdName.trim().toUpperCase(),
      sku: newProdSku.trim() || `${newProdSkuWeight} ${newProdSkuUnit} Bag`,
      skuWeight: newProdSkuWeight,
      skuUnit: newProdSkuUnit,
      dealerPrice: newProdDealerPrice,
      category: newProdCategory,
      volumeDiscountRule: discountRule,
    };

    const updated = [newProduct, ...products];
    updateProductsAndPersist(updated);

    // Reset fields & close
    setAddProductModalOpen(false);
    setNewProdName('');
    setNewProdId('');
    setNewProdSku('20 kg Bag');
    setNewProdSkuWeight(20);
    setNewProdSkuUnit('kg');
    setNewProdDealerPrice(300);
    setNewProdCategory('Tile Fix');
    setNewProdDiscountUnit('none');
    setNewProdSlabs([]);
    setNewProdError('');

    setPricingImportStatus({
      type: 'success',
      message: `Successfully added and compiled new custom product "${newProduct.name}".`
    });
  };

  // --- SLAB BRACKETS EDITOR ACTIONS ---
  const openSlabEditor = (prod: Product) => {
    setEditingProductSlabs(prod);
    if (prod.volumeDiscountRule) {
      setTempUnit(prod.volumeDiscountRule.unit);
      setTempSlabs(
        prod.volumeDiscountRule.brackets.map((b) => ({
          min: b.min,
          discountPercent: b.discountPercent
        }))
      );
    } else {
      setTempUnit(prod.skuUnit === 'kg' ? 'kg' : 'L');
      setTempSlabs([{ min: 10, discountPercent: 5 }]);
    }
  };

  const handleAddTempSlab = () => {
    setTempSlabs([...tempSlabs, { min: 0, discountPercent: 0 }]);
  };

  const handleTempSlabChange = (index: number, field: 'min' | 'discountPercent', value: number) => {
    const updated = tempSlabs.map((item, idx) => {
      if (idx === index) {
        return { ...item, [field]: value };
      }
      return item;
    });
    setTempSlabs(updated);
  };

  const handleRemoveTempSlab = (index: number) => {
    setTempSlabs(tempSlabs.filter((_, idx) => idx !== index));
  };

  const handleSaveTempSlabs = () => {
    if (!editingProductSlabs) return;

    // Filter out zero/negative/empty records, and sort ASC by 'min'
    const validSlabs = tempSlabs
      .filter((s) => s.min >= 0 && s.discountPercent >= 0)
      .sort((a, b) => a.min - b.min);

    // Reconstruct progressive brackets with computed dynamic 'max'
    const finalBrackets = validSlabs.map((s, idx) => {
      const nextSlab = validSlabs[idx + 1];
      const maxLimit = nextSlab ? nextSlab.min : Infinity;
      return {
        min: s.min,
        max: maxLimit,
        discountPercent: s.discountPercent
      };
    });

    const updated = products.map((item) => {
      if (item.id === editingProductSlabs.id) {
        if (finalBrackets.length === 0) {
          return { ...item, volumeDiscountRule: null };
        }
        return {
          ...item,
          volumeDiscountRule: {
            unit: tempUnit,
            brackets: finalBrackets
          }
        };
      }
      return item;
    });

    updateProductsAndPersist(updated);
    setEditingProductSlabs(null);
  };

  // --- COMPUTATIONS ---
  // Apply logic across all products where quantity > 0
  const activeCalculations = useMemo(() => {
    return products.map((prod) => {
      const q = quantities[prod.id] || 0;
      const customPrice = customSellingPrices[prod.id];
      const productAdPercentOverride = productAdPercents[prod.id];
      
      if (q > 0 && prod.volumeDiscountRule) {
        const groupVolumeDiscountPercent = getGroupVolumeDiscountPercent(prod, groupVolumes);
        return calculateProfitSingle(prod, q, settings, customPrice, groupVolumeDiscountPercent, productAdPercentOverride);
      }
      
      return calculateProfitSingle(prod, q, settings, customPrice, undefined, productAdPercentOverride);
    });
  }, [products, quantities, settings, customSellingPrices, groupVolumes, productAdPercents]);

  // Aggregate active results
  const summary = useMemo(() => {
    let totalRevenue = 0;
    let totalCost = 0;
    let totalProfit = 0;
    let activeLinesCount = 0;
    
    // Categorized variables
    const categoryProfitMap: Record<string, number> = {};
    const categoryRevenueMap: Record<string, number> = {};

    activeCalculations.forEach((calc) => {
      if (calc.quantity > 0) {
        totalRevenue += calc.totalRevenue;
        totalCost += calc.totalCost;
        totalProfit += calc.totalProfit;
        activeLinesCount++;

        categoryProfitMap[calc.product.category] = (categoryProfitMap[calc.product.category] || 0) + calc.totalProfit;
        categoryRevenueMap[calc.product.category] = (categoryRevenueMap[calc.product.category] || 0) + calc.totalRevenue;
      }
    });

    const averageMarginPercent = totalCost > 0 ? (totalProfit / totalCost) * 100 : 0;

    return {
      totalRevenue,
      totalCost,
      totalProfit,
      averageMarginPercent,
      activeLinesCount,
      categoryProfitMap,
      categoryRevenueMap
    };
  }, [activeCalculations]);

  // Dynamic counts for each category to display on filter badges
  const categoryCounts = useMemo(() => {
    const counts: Record<string, { total: number; active: number }> = {};
    
    // Initialize structure
    SIMULATOR_CATEGORIES.forEach(cat => {
      counts[cat] = { total: 0, active: 0 };
    });

    // Count products
    products.forEach(p => {
      const cat = p.category;
      const isActive = (quantities[p.id] || 0) > 0;
      
      if (counts[cat]) {
        counts[cat].total++;
        if (isActive) {
          counts[cat].active++;
        }
      }
    });

    // Sum all categories for 'All'
    let grandTotal = 0;
    let grandActive = 0;
    Object.keys(counts).forEach(key => {
      if (key !== 'All') {
        grandTotal += counts[key].total;
        grandActive += counts[key].active;
      }
    });
    counts['All'] = { total: grandTotal, active: grandActive };

    return counts;
  }, [products, quantities]);

  // --- CASCADING DROPDOWNS LOGIC & RESOLUTIONS ---
  const availableGroups = useMemo(() => {
    const s = new Set<string>();
    products.forEach(p => s.add(getCategoryGroup(p.category)));
    return Array.from(s).sort();
  }, [products]);

  const availableProductNames = useMemo(() => {
    const s = new Set<string>();
    products.forEach(p => {
      if (getCategoryGroup(p.category) === selectedGroup) {
        s.add(p.name);
      }
    });
    return Array.from(s).sort();
  }, [selectedGroup, products]);

  // Adjust selectedProductName when availableProductNames changes
  useEffect(() => {
    if (availableProductNames.length > 0) {
      if (!selectedProductName || !availableProductNames.includes(selectedProductName)) {
        const preferred = availableProductNames.find(name => name === 'TILE FIX-STANDARD - HW201');
        setSelectedProductName(preferred || availableProductNames[0]);
      }
    } else {
      setSelectedProductName('');
    }
  }, [availableProductNames, selectedProductName]);

  const availableSkus = useMemo(() => {
    return products.filter(p => 
      getCategoryGroup(p.category) === selectedGroup && 
      p.name === selectedProductName
    );
  }, [selectedGroup, selectedProductName, products]);

  // Adjust selectedSkuId when availableSkus changes
  useEffect(() => {
    if (availableSkus.length > 0) {
      if (!selectedSkuId || !availableSkus.some(s => s.id === selectedSkuId)) {
        const preferredSku = availableSkus.find(s => s.id === 'tf-standard-hw201-20');
        setSelectedSkuId(preferredSku ? preferredSku.id : availableSkus[0].id);
      }
    } else {
      setSelectedSkuId('');
    }
  }, [availableSkus, selectedSkuId]);

  // Sync chosen input quantity with quantities in bin
  useEffect(() => {
    if (selectedSkuId) {
      const qtyInBin = quantities[selectedSkuId] || 0;
      setInputQuantity(qtyInBin > 0 ? qtyInBin : 1);
    }
  }, [selectedSkuId, quantities]);

  // Filtered list of item IDs currently in active bin workspace (using showActiveOnly filter)
  const filteredBinProductIds = useMemo(() => {
    return activeBinProductIds.filter((id) => {
      const prod = products.find(p => p.id === id);
      if (!prod) return false;
      const hasQtyValue = (quantities[id] || 0) > 0;
      const satisfiesActiveFilter = !showActiveOnly || hasQtyValue;
      return satisfiesActiveFilter;
    });
  }, [products, activeBinProductIds, showActiveOnly, quantities]);

  // Handle printing/pdf statement click
  const handlePrint = () => {
    window.print();
  };

  return (
    <div className="min-h-screen bg-earth-50 text-earth-800 flex flex-col antialiased">
      {/* HEADER SECTION */}
      <header className="bg-earth-100 text-earth-800 border-b border-earth-200 print:hidden shrink-0 shadow-xs">
        <div className="max-w-7xl mx-auto px-4 py-5 sm:px-6 lg:px-8 flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="p-2.5 bg-sage-500 rounded-xl text-white shadow-sm">
              <Calculator className="w-6 h-6" />
            </div>
            <div>
              <h1 className="text-xl sm:text-2xl font-bold font-serif tracking-tight text-earth-900">
                Dealer Profit <span className="text-sage-500">Margin Calculator</span>
              </h1>
              <p className="text-xs text-earth-500 mt-0.5">
                Calculate custom monthly volumes, dealer purchase discounts, and cash margins automatically
              </p>
            </div>
          </div>
          
          <div className="flex flex-wrap items-center gap-2">
            <button
              onClick={handleLoadSample}
              className="px-3.5 py-1.5 text-xs font-semibold bg-white hover:bg-earth-50 border border-earth-200 text-earth-800 rounded-lg transition-all flex items-center gap-1.5 shadow-2xs cursor-pointer"
              title="Prepopulate with standard sales targets"
            >
              <RefreshCw className="w-3.5 h-3.5 text-sage-500" />
              Load Sample Sheet
            </button>
            <button
              onClick={handleClearAll}
              disabled={(Object.values(quantities) as number[]).reduce((a, b) => a + b, 0) === 0}
              className="px-3 py-1.5 text-xs font-semibold bg-rose-50 border border-rose-200 text-rose-700 hover:bg-rose-100/60 rounded-lg disabled:opacity-40 disabled:pointer-events-none transition-all cursor-pointer"
            >
              Reset Sheet
            </button>
            <button
              onClick={handleShareScreenshot}
              disabled={(Object.values(quantities) as number[]).reduce((a, b) => a + b, 0) === 0}
              className="px-3.5 py-1.5 text-xs font-semibold bg-sage-500 hover:bg-sage-600 active:bg-sage-700 text-white rounded-lg shadow-sm hover:shadow-md transition-all flex items-center gap-1.5 cursor-pointer disabled:opacity-40 disabled:pointer-events-none"
              title="Capture and share a screenshot of the profit estimation"
            >
              <Camera className="w-3.5 h-3.5" />
              Share screenshot
            </button>
            {isInstallable && (
              <button
                onClick={handleInstallApp}
                className="px-3.5 py-1.5 text-xs font-semibold bg-amber-600 hover:bg-amber-700 active:bg-amber-800 text-white rounded-lg shadow-sm hover:shadow-md transition-all flex items-center gap-1.5 cursor-pointer uppercase tracking-wider animate-pulse"
                title="Install this calculator as a native mobile/desktop application"
              >
                <Download className="w-3.5 h-3.5" />
                Install App
              </button>
            )}
          </div>
        </div>

        {/* Tab switcher navigation bar */}
        <div className="border-t border-earth-200/60 bg-earth-50/50">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 flex justify-between items-center">
            <nav className="-mb-px flex space-x-6" aria-label="Tabs">
              <button
                onClick={() => setActiveTab('calculator')}
                className={`border-b-2 py-3 px-1 text-sm font-semibold flex items-center gap-2 cursor-pointer transition-all ${
                  activeTab === 'calculator'
                    ? 'border-sage-500 text-sage-600'
                    : 'border-transparent text-earth-500 hover:text-earth-700 hover:border-earth-300'
                }`}
              >
                <Calculator className="w-4 h-4" />
                📊 Simulation Calculator
              </button>
              <button
                onClick={() => {
                  setActiveTab('backend');
                  setPricingImportStatus({ type: null, message: '' });
                }}
                className={`border-b-2 py-3 px-1 text-sm font-semibold flex items-center gap-2 cursor-pointer transition-all ${
                  activeTab === 'backend'
                    ? 'border-sage-500 text-sage-600'
                    : 'border-transparent text-earth-500 hover:text-earth-700 hover:border-earth-300'
                }`}
              >
                <Sliders className="w-4 h-4" />
                🛠️ Backend Pricing & Discount Sheet
              </button>
            </nav>
            {activeTab === 'backend' ? (
              <span className="text-[10px] font-bold bg-sage-100 text-sage-700 border border-sage-200 px-2.5 py-1 rounded-full font-mono uppercase">
                Active Master Override Mode
              </span>
            ) : (
              <button
                type="button"
                onClick={() => {
                  if (window.confirm("This will clear any stale browser cache, purge unregistered PWA service workers, reset local database storage, and perform a clean hard-reload of the app. Continue?")) {
                    if ((window as any).forceUpdateApp) {
                      (window as any).forceUpdateApp();
                    } else {
                      localStorage.clear();
                      sessionStorage.clear();
                      window.location.reload();
                    }
                  }
                }}
                className="my-2 px-2.5 py-1.5 text-[10px] font-bold text-rose-600 hover:text-rose-700 bg-rose-50 hover:bg-rose-100/60 rounded-lg border border-rose-200 transition-all flex items-center gap-1 cursor-pointer select-none"
                title="Purge cache, unregister service workers, and force download the absolute newest version"
              >
                <RefreshCw className="w-3.5 h-3.5 text-rose-500" />
                <span>Fix Mobile Cache / Hard Reload</span>
              </button>
            )}
          </div>
        </div>
      </header>

      {/* DASHBOARD CORE CONTENT */}
      {activeTab === 'calculator' ? (
        <main className="flex-1 max-w-7xl w-full mx-auto p-4 sm:p-6 lg:p-8 flex flex-col lg:flex-row gap-6">
        
        {/* LEFT COLUMN: PRODUCT LISTING & BROWSER */}
        <div className="flex-1 flex flex-col gap-5 min-w-0">

          {/* STEP 1: BROWSE & ADD PRODUCT SKUs */}
          <section className="bg-white rounded-xl border border-earth-200 p-3.5 sm:p-5 shadow-2xs print:hidden flex flex-col gap-3.5 sm:gap-4">
            <div className="border-b border-earth-200 pb-3">
              <h2 className="text-sm font-bold text-earth-900 flex items-center gap-2 font-serif uppercase tracking-wider">
                <ShoppingBag className="w-4 h-4 text-sage-500" />
                Step 1: Browse & Add Product SKUs
              </h2>
              <p className="text-xs text-earth-500 mt-1">
                Select your desires by product group, product name, and target SKU packaging to configure and simulate.
              </p>
            </div>

            <div className="bg-earth-50/55 border border-earth-200/60 rounded-xl p-4 flex flex-col gap-4">
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3.5">
                {/* 1st Dropdown: Product Group */}
                <div className="flex flex-col gap-1.5 text-xs">
                  <label className="text-earth-700 font-bold flex items-center gap-1.5">
                    <span className="w-1.5 h-1.5 rounded-full bg-sage-500"></span>
                    1st Product Group
                  </label>
                  <select
                    value={selectedGroup}
                    onChange={(e) => setSelectedGroup(e.target.value)}
                    className="bg-white border border-earth-300 rounded-lg px-3 py-2 text-xs text-earth-900 font-semibold outline-none focus:border-sage-500 focus:ring-1 focus:ring-sage-500/10 w-full shadow-3xs cursor-pointer"
                  >
                    {availableGroups.map((group) => (
                      <option key={group} value={group}>
                        {group}
                      </option>
                    ))}
                  </select>
                </div>

                {/* 2nd Dropdown: Product Name */}
                <div className="flex flex-col gap-1.5 text-xs">
                  <label className="text-earth-700 font-bold flex items-center gap-1.5">
                    <span className="w-1.5 h-1.5 rounded-full bg-sage-500"></span>
                    2nd Product Name
                  </label>
                  <select
                    value={selectedProductName}
                    onChange={(e) => setSelectedProductName(e.target.value)}
                    className="bg-white border border-earth-300 rounded-lg px-3 py-2 text-xs text-earth-900 font-semibold outline-none focus:border-sage-500 focus:ring-1 focus:ring-sage-500/10 w-full shadow-3xs cursor-pointer"
                    disabled={availableProductNames.length === 0}
                  >
                    {availableProductNames.map((name) => (
                      <option key={name} value={name}>
                        {name}
                      </option>
                    ))}
                  </select>
                </div>

                {/* 3rd Dropdown: SKU to selected */}
                <div className="flex flex-col gap-1.5 text-xs">
                  <label className="text-earth-700 font-bold flex items-center gap-1.5">
                    <span className="w-1.5 h-1.5 rounded-full bg-sage-500"></span>
                    3rd Selected SKU
                  </label>
                  <select
                    value={selectedSkuId}
                    onChange={(e) => setSelectedSkuId(e.target.value)}
                    className="bg-white border border-earth-300 rounded-lg px-3 py-2 text-xs text-earth-900 font-medium outline-none focus:border-sage-500 focus:ring-1 focus:ring-sage-500/10 w-full shadow-3xs cursor-pointer font-mono"
                    disabled={availableSkus.length === 0}
                  >
                    {availableSkus.map((sku) => (
                      <option key={sku.id} value={sku.id}>
                        {sku.sku} (₹{sku.dealerPrice.toLocaleString('en-IN')})
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              {/* Action and Quantity Area */}
              {selectedSkuId && (() => {
                const activeSku = products.find(p => p.id === selectedSkuId);
                if (!activeSku) return null;
                const isInBin = activeBinProductIds.includes(selectedSkuId);
                
                return (
                  <div className="border-t border-earth-100 pt-3.5 flex flex-col md:flex-row items-stretch md:items-center justify-between gap-3.5">
                    {/* Rate and Specification display helper */}
                    <div className="flex items-center gap-3 text-xs text-earth-600 bg-white border border-earth-200/50 px-3 py-1.5 rounded-lg shrink-0 shadow-3xs">
                      <span>Dealer Price: <strong className="text-earth-950 font-mono text-xs sm:text-sm">₹{activeSku.dealerPrice.toLocaleString('en-IN')}</strong></span>
                      <span className="text-earth-200">|</span>
                      <span>Weight/Size: <strong className="text-earth-850">{activeSku.skuWeight} {activeSku.skuUnit}</strong></span>
                    </div>

                    <div className="flex flex-wrap items-center gap-3 justify-end">
                      {/* Quantity Selector */}
                      <div className="flex items-center gap-2 text-xs">
                        <span className="text-earth-700 font-bold select-none">Quantity (Units):</span>
                        <div className="flex items-center gap-1 bg-white border border-earth-250 p-0.5 rounded-md shadow-3xs">
                          <button
                            type="button"
                            onClick={() => {
                              setInputQuantity(q => Math.max(1, q - 1));
                            }}
                            className="bg-earth-100 hover:bg-earth-200 p-1 rounded transition-colors text-earth-700 cursor-pointer active:scale-95"
                            title="Decrease"
                          >
                            <Minus className="w-2.5 h-2.5" />
                          </button>
                          <input
                            type="number"
                            min="1"
                            value={inputQuantity}
                            onChange={(e) => {
                              const val = parseInt(e.target.value, 10);
                              setInputQuantity(isNaN(val) ? 1 : Math.max(1, val));
                            }}
                            className="w-10 text-center font-bold font-mono text-xs bg-transparent outline-none text-earth-900"
                          />
                          <button
                            type="button"
                            onClick={() => {
                              setInputQuantity(q => q + 1);
                            }}
                            className="bg-earth-100 hover:bg-earth-200 p-1 rounded transition-colors text-earth-700 cursor-pointer active:scale-95"
                            title="Increase"
                          >
                            <Plus className="w-2.5 h-2.5" />
                          </button>
                        </div>
                      </div>

                      {/* Add Button */}
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => {
                            updateQuantity(selectedSkuId, inputQuantity);
                            if (!activeBinProductIds.includes(selectedSkuId)) {
                              setBinProductIds(prev => [...prev, selectedSkuId]);
                            }
                          }}
                          className={`px-4 py-1.5 text-xs font-bold rounded-lg transition-all flex items-center gap-1.5 cursor-pointer active:scale-95 shadow-3xs ${
                            isInBin
                              ? 'bg-sage-700 hover:bg-sage-800 text-white border border-sage-700'
                              : 'bg-sage-500 hover:bg-sage-600 text-white border border-sage-500'
                          }`}
                        >
                          {isInBin ? <Check className="w-3.5 h-3.5" /> : <Plus className="w-3.5 h-3.5" />}
                          {isInBin ? 'Update Bin' : 'Add to Bin'}
                        </button>

                        {/* Optional Remove Option from Bin */}
                        {isInBin && (
                          <button
                            type="button"
                            onClick={() => {
                              updateQuantity(selectedSkuId, 0);
                              handleRemoveFromBin(selectedSkuId);
                            }}
                            className="p-1.5 text-rose-500 hover:text-rose-700 hover:bg-rose-50 border border-rose-200/50 rounded-lg transition-colors cursor-pointer"
                            title="Remove from Simulation Bin"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })()}
            </div>
          </section>

          {/* STEP 2: INTERACTIVE SIMULATION BIN */}
          <section className="flex flex-col gap-4">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-earth-200 pb-3 mt-2 pr-1">
              <div>
                <h2 className="text-sm font-bold text-earth-900 flex items-center gap-2 font-serif uppercase tracking-wider">
                  <Calculator className="w-4 h-4 text-sage-500" />
                  Step 2: Interactive Simulation Workspace Bin
                </h2>
                <p className="text-xs text-earth-500 mt-1">
                  Adjust quantities, configure custom selling rates, examine volume tier margins, and dynamic math formulas.
                </p>
              </div>

              <div className="flex items-center gap-2.5 flex-wrap shrink-0">
                {/* Active items filter checkbox inside Bin */}
                <label className="flex items-center gap-2 cursor-pointer select-none text-xs text-earth-800 font-medium bg-white border border-earth-200 px-2.5 py-1.5 rounded-lg hover:border-earth-300 transition-all shadow-3xs">
                  <input
                    type="checkbox"
                    checked={showActiveOnly}
                    onChange={(e) => setShowActiveOnly(e.target.checked)}
                    className="rounded border-earth-300 text-sage-550 focus:ring-sage-500 w-3.5 h-3.5 accent-sage-500 cursor-pointer"
                  />
                  <span>Only Active ({summary.activeLinesCount})</span>
                </label>

                <span className="text-[10px] font-bold bg-sage-500 text-white px-2.5 py-1.5 rounded-full font-mono shrink-0">
                  {activeBinProductIds.filter(id => (quantities[id] || 0) > 0).length} / {activeBinProductIds.length} Simulated Items
                </span>
              </div>
            </div>

            <div className="grid grid-cols-1 gap-4">
              <AnimatePresence mode="popLayout">
                {filteredBinProductIds.length > 0 ? (
                  filteredBinProductIds.map((productId) => {
                    const product = products.find(p => p.id === productId);
                    if (!product) return null;

                    const qty = quantities[product.id] || 0;
                    const customPrice = customSellingPrices[product.id];
                    const groupVolumeDiscountPercent = product.volumeDiscountRule ? getGroupVolumeDiscountPercent(product, groupVolumes) : 0;
                    const calcResult = calculateProfitSingle(product, qty, settings, customPrice, groupVolumeDiscountPercent, productAdPercents[product.id]);
                    const isExplanationOpen = showExplanationId === product.id;

                    // Get Slab recommendations
                    const nextSlabAdvice = getNextSlabSuggestion(product, qty, customPrice, calcResult.totalProfit);

                    return (
                      <motion.div
                        layout
                        key={product.id}
                        initial={{ opacity: 0, y: 15 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, scale: 0.98 }}
                        transition={{ duration: 0.2 }}
                        className={`bg-white rounded-xl border transition-all ${
                          qty > 0 
                            ? 'border-sage-500 ring-2 ring-sage-500/10 shadow-sm' 
                            : 'border-earth-250 hover:border-earth-300 shadow-2xs'
                        }`}
                      >
                        <div className="p-4 sm:p-5 flex flex-col md:flex-row md:items-center justify-between gap-4">
                          
                          {/* Title, Category & Weight Indicators */}
                          <div className="flex-1">
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className="text-[10px] font-bold text-earth-500 bg-earth-100 border border-earth-200 px-2 py-0.5 rounded-md uppercase font-display">
                                {product.category}
                              </span>
                              <span className="bg-earth-100 border border-earth-200/40 px-2 py-0.5 rounded text-[10px] font-bold text-earth-600 font-mono">
                                SKU: {product.sku}
                              </span>
                            </div>
                            <h3 className="text-sm font-bold font-serif text-earth-900 tracking-tight mt-2 flex items-center justify-between gap-2">
                              <span>{product.name}</span>
                              {/* DELETE BUTTON FROM BIN */}
                              <button
                                type="button"
                                onClick={() => handleRemoveFromBin(product.id)}
                                className="p-1 px-2.5 rounded-lg bg-rose-50 hover:bg-rose-100 hover:text-rose-700 border border-rose-200 text-rose-600 transition-all flex items-center gap-1 cursor-pointer shadow-3xs shrink-0"
                                title="Remove SKU selection from active simulation bin"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                                <span className="text-[9px] font-bold uppercase tracking-wider">Delete</span>
                              </button>
                            </h3>
                            
                            {/* Details Row */}
                            <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 mt-2.5 text-xs text-earth-500 border-t border-earth-100/50 pt-2">
                              <span className="flex items-center gap-1">
                                Dealer Unit Price: <strong className="text-earth-950 font-mono">₹{product.dealerPrice.toLocaleString('en-IN')}</strong>
                              </span>
                              {customSellingPrices[product.id] !== undefined && (
                                <span className="bg-amber-55 text-amber-850 border border-amber-200 text-[9px] px-2 py-0.5 rounded font-bold uppercase tracking-wider">
                                  Custom Rate Active
                                </span>
                              )}
                            </div>

                            {/* Custom Selling Price Input Override */}
                            <div className="mt-3.5 flex flex-wrap items-center gap-x-2 gap-y-1.5 text-xs">
                              <span className="text-earth-700 font-semibold select-none">Selling Rate:</span>
                              <div className="relative flex items-center">
                                <span className="absolute left-2.5 text-earth-400 font-mono">₹</span>
                                <input
                                  type="number"
                                  min="0"
                                  value={customSellingPrices[product.id] !== undefined ? customSellingPrices[product.id] : ''}
                                  onChange={(e) => updateCustomSellingPrice(product.id, e.target.value)}
                                  placeholder={product.dealerPrice.toString()}
                                  className="pl-6 pr-2 py-1 w-24 bg-white border border-earth-300 focus:border-sage-500 focus:ring-2 focus:ring-sage-500/10 rounded-lg text-earth-900 font-mono font-bold outline-none transition-all placeholder:text-earth-400 text-xs shadow-3xs"
                                  title="Manually specify custom price. Clear or leave empty to default to company standards."
                                />
                              </div>
                              <span className="text-[10px] text-earth-400 italic shrink-0">
                                {customSellingPrices[product.id] !== undefined ? 'Custom price offset' : 'Using dealer price'}
                              </span>
                              {customSellingPrices[product.id] !== undefined && (
                                <button
                                  type="button"
                                  onClick={() => updateCustomSellingPrice(product.id, '')}
                                  className="text-[10px] text-rose-600 hover:text-rose-700 hover:underline cursor-pointer font-bold ml-1.5"
                                >
                                  Revert to Default
                                </button>
                              )}
                            </div>

                            {/* Product-Specific Annual Discount Input Override */}
                            <div className="mt-2.5 flex flex-wrap items-center gap-x-2 gap-y-1.5 text-xs">
                              <span className="text-earth-700 font-semibold select-none font-serif">Annual Discount (AD) Override:</span>
                              <div className="relative flex items-center">
                                <input
                                  type="number"
                                  min="0"
                                  max="100"
                                  step="0.5"
                                  value={productAdPercents[product.id] !== undefined ? productAdPercents[product.id] : ''}
                                  onChange={(e) => updateProductAdPercent(product.id, e.target.value)}
                                  placeholder={settings.adPercent.toString()}
                                  className="pl-2 pr-6 py-1 w-20 bg-white border border-earth-300 focus:border-sage-500 focus:ring-2 focus:ring-sage-500/10 rounded-lg text-earth-900 font-mono font-bold outline-none transition-all text-xs shadow-3xs"
                                  title="Manually specify custom AD percentage. Clear or leave empty to default to global standard."
                                />
                                <span className="absolute right-2 text-earth-400 font-mono">%</span>
                              </div>
                              <span className="text-[10.5px] text-earth-400 italic shrink-0">
                                {productAdPercents[product.id] !== undefined ? 'Custom AD active' : `Using global default (${settings.adPercent}%)`}
                              </span>
                              {productAdPercents[product.id] !== undefined && (
                                <button
                                  type="button"
                                  onClick={() => updateProductAdPercent(product.id, '')}
                                  className="text-[10px] text-rose-600 hover:text-rose-700 hover:underline cursor-pointer font-bold ml-1.5"
                                >
                                  Revert to Default
                                </button>
                              )}
                            </div>
                          </div>

                          {/* Quantity Counter */}
                          <div className="flex items-center gap-3 shrink-0 self-start md:self-auto bg-earth-100 border border-earth-200 p-1.5 rounded-lg">
                            <button
                              type="button"
                              onClick={() => updateQuantity(product.id, qty - 1)}
                              className="bg-white hover:bg-earth-50 border border-earth-200 p-1.5 rounded-md transition-colors text-earth-750 cursor-pointer active:scale-95"
                            >
                              <Minus className="w-3.5 h-3.5" />
                            </button>
                            
                            <div className="flex flex-col items-center">
                              <input
                                type="number"
                                min="0"
                                value={qty || ''}
                                onChange={(e) => updateQuantity(product.id, parseInt(e.target.value, 10))}
                                placeholder="0"
                                className="text-center font-bold text-sm w-12 bg-transparent outline-none border-b border-transparent focus:border-earth-300 text-earth-900 font-mono"
                              />
                              <span className="text-[9px] text-earth-500 font-semibold">{product.sku.includes('Bag') ? 'Bags' : (product.sku.includes('Can') ? 'Cans' : 'Packs')}</span>
                            </div>

                            <button
                              type="button"
                              onClick={() => updateQuantity(product.id, qty + 1)}
                              className="bg-white hover:bg-earth-50 border border-earth-200 p-1.5 rounded-md transition-colors text-earth-755 cursor-pointer active:scale-95"
                            >
                              <Plus className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        </div>

                        {/* EXTRAS PANEL (IF QTY > 0) */}
                        {qty > 0 && (
                          <div className="border-t border-earth-200 bg-earth-50/40 p-4 rounded-b-xl flex flex-col gap-3">
                            
                            {/* Cumulative volume calculations & indicators */}
                            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
                              <div className="bg-white p-2.5 rounded-md border border-earth-200 shadow-2xs">
                                <span className="text-earth-400 block text-[10px] uppercase font-bold tracking-wider">Volume Order</span>
                                <span className="font-semibold text-earth-700 font-mono mt-0.5 block font-extrabold">
                                  {calcResult.totalWeightUnit}
                                </span>
                              </div>
                              <div className="bg-white p-2.5 rounded-md border border-earth-200 shadow-2xs">
                                <span className="text-earth-400 block text-[10px] uppercase font-bold tracking-wider">Vol Discount</span>
                                <span className="font-bold text-sage-600 mt-0.5 block flex items-center gap-1">
                                  {calcResult.volumeDiscountPercent}% 
                                  <span className="text-[10px] text-earth-400 font-normal">
                                    (-₹{calcResult.volumeDiscountAmount.toFixed(1)}/u)
                                  </span>
                                </span>
                              </div>
                              <div className="bg-white p-2.5 rounded-md border border-earth-200 shadow-2xs">
                                <span className="text-earth-400 block text-[10px] uppercase font-bold tracking-wider">Net Unit Buy</span>
                                <span className="font-extrabold text-earth-900 font-mono mt-0.5 block">
                                  ₹{calcResult.purchaseUnitPrice.toLocaleString('en-IN', { maximumFractionDigits: 1 })}
                                </span>
                              </div>
                              <div className="bg-white p-2.5 rounded-md border border-earth-200 shadow-2xs">
                                <span className="text-earth-400 block text-[10px] uppercase font-bold tracking-wider">Total Margin</span>
                                <span className="font-extrabold text-sage-600 font-mono mt-0.5 block">
                                  +₹{calcResult.totalProfit.toLocaleString('en-IN', { maximumFractionDigits: 0 })}
                                </span>
                              </div>
                            </div>

                            {/* NEXT SLAB TARGET ADVICE & PROFIT OPTIMIZATION WITH COVETED BRACKET SUGGESTIONS */}
                            {qty > 0 && nextSlabAdvice && (
                              <div className="bg-sage-50 border border-sage-200 rounded-lg p-3 text-xs text-sage-800 shadow-3xs flex items-start gap-2">
                                <TrendingUp className="w-4 h-4 text-sage-600 shrink-0 mt-0.5 animate-pulse" />
                                <div className="flex-1 leading-relaxed">
                                  Add <strong>{nextSlabAdvice.additionalUnits} more</strong> packaging units of this SKU to reach the next volume discount bracket of <strong>{nextSlabAdvice.nextPercent}%</strong> 
                                  <span className="font-extrabold text-sage-900 block sm:inline sm:ml-1 text-[11px] bg-sage-100 border border-sage-200 px-1.5 py-0.5 rounded">
                                    (Projected Monthly Profit: ₹{Math.round(nextSlabAdvice.projectedProfit).toLocaleString('en-IN')})
                                  </span>
                                </div>
                              </div>
                            )}

                            {qty > 0 && !nextSlabAdvice && product.volumeDiscountRule && (
                              <div className="bg-sage-50 border border-sage-200 text-sage-850 rounded-lg p-2.5 text-xs shadow-3xs flex items-center gap-2">
                                <CheckCircle2 className="w-4 h-4 text-sage-600 shrink-0" />
                                <span className="font-bold text-[11px] text-sage-700">🚀 Maximum volume discount tier achieved for this SKU variant!</span>
                              </div>
                            )}

                            {/* Margin Breakdowns Link toggle */}
                            <div className="flex justify-between items-center mt-1">
                              <button
                                onClick={() => setShowExplanationId(isExplanationOpen ? null : product.id)}
                                className="text-xs text-earth-500 hover:text-sage-500 font-medium flex items-center gap-1 cursor-pointer"
                              >
                                <Info className="w-3.5 h-3.5 text-sage-500" />
                                {isExplanationOpen ? 'Hide dynamic math calculation' : 'Show discount formula breakdown'}
                              </button>
                              <span className="text-earth-400 text-[11px] font-mono">
                                Margin: <strong className="text-sage-600">{calcResult.profitMarginPercent.toFixed(1)}%</strong>
                              </span>
                            </div>

                            {/* EXPLANATORY ACCORDION CONTAINER */}
                            <AnimatePresence>
                                {isExplanationOpen && (
                                  <motion.div
                                    initial={{ opacity: 0, height: 0 }}
                                    animate={{ opacity: 1, height: 'auto' }}
                                    exit={{ opacity: 0, height: 0 }}
                                    transition={{ duration: 0.15 }}
                                    className="bg-earth-100 border border-earth-200 text-earth-800 p-3.5 rounded-lg text-xs font-mono flex flex-col gap-1.5 leading-relaxed overflow-hidden shrink-0 mt-1"
                                  >
                                    <span className="text-sage-600 font-bold uppercase mb-1 flex items-center gap-1 text-[10px]">
                                      <Sliders className="w-3 h-3 text-sage-500" /> Formula Arithmetic
                                    </span>
                                    <div>
                                      Base Dealer Price: <span className="text-earth-950 font-bold">₹{product.dealerPrice}</span>
                                    </div>
                                    <div className="text-earth-400 line-through">
                                      MRP: Omitted per request
                                    </div>
                                    <div>
                                      [-] Vol Disc: -{calcResult.volumeDiscountPercent}% Amount = <span className="text-earth-950 font-bold">₹{calcResult.volumeDiscountAmount.toFixed(1)}</span>
                                      {calcResult.usedFixedPrice && product.fixedVolumePrices && product.fixedVolumePrices[calcResult.volumeDiscountPercent] !== undefined && (
                                        <span className="text-amber-700 block text-[10px] font-sans mt-0.5 font-semibold">
                                          *Uses rounded company table price directly: ₹{product.fixedVolumePrices[calcResult.volumeDiscountPercent]}
                                        </span>
                                      )}
                                    </div>
                                    <div>
                                      [-] Annual Disc (AD): -{calcResult.adPercent}% Amount = <span className="text-earth-950 font-bold">₹{calcResult.adAmount.toFixed(1)}</span>
                                    </div>
                                    <div>
                                      [-] Cash Disc (CD): -{calcResult.cdPercent}% Amount = <span className="text-earth-950 font-bold">₹{calcResult.cdAmount.toFixed(1)}</span>
                                    </div>
                                    <div>
                                      [-] Quarterly Growth Disc: -{calcResult.growthPercent}% Amount = <span className="text-earth-950 font-bold">₹{calcResult.growthAmount.toFixed(1)}</span>
                                    </div>
                                    <div className="border-t border-earth-200 pt-1.5 mt-1 font-bold text-earth-900 flex justify-between">
                                      <span>Final Unit Buy Cost:</span>
                                      <span className="text-sage-600 font-bold font-mono">₹{calcResult.purchaseUnitPrice.toFixed(1)}</span>
                                    </div>
                                    <div className="font-bold text-earth-900 flex justify-between">
                                      <span>Selling Price {calcResult.customSellingPrice !== undefined ? '(Custom)' : '(Dealer rate)'}:</span>
                                      <span>₹{calcResult.sellingPrice}</span>
                                    </div>
                                    <div className="font-semibold text-sage-605 flex justify-between border-t border-sage-200 pt-1.5 text-xs">
                                      <span>Monthly Profit Margin:</span>
                                      <span>₹{calcResult.profitPerUnit.toFixed(1)} per unit ({calcResult.profitMarginPercent.toFixed(1)}%)</span>
                                    </div>
                                  </motion.div>
                                )}
                            </AnimatePresence>
                          </div>
                        )}
                      </motion.div>
                    );
                  })
                ) : (
                  <div className="bg-white border-2 border-earth-200 border-dashed rounded-xl px-4 py-12 flex flex-col items-center justify-center text-center">
                    <ShoppingBag className="w-10 h-10 text-earth-405 stroke-[1.5]" />
                    <h4 className="text-sm font-semibold text-earth-800 mt-3">Active simulation bin is empty</h4>
                    <p className="text-xs text-earth-500 max-w-sm mt-1">
                      Choose products from the SKU Catalog above and click "Add to Bin" to start building your simulated dealer request totals.
                    </p>
                    <button
                      onClick={handleLoadSample}
                      className="mt-3.5 text-xs bg-sage-500 hover:bg-sage-600 transition-all font-bold text-white px-3.5 py-1.5 rounded-lg flex items-center gap-1 shadow-3xs cursor-pointer"
                    >
                      <RefreshCw className="w-3.5 h-3.5" />
                      Load Default Sample Sheet
                    </button>
                  </div>
                )}
              </AnimatePresence>
            </div>
          </section>

          {/* FUTURE USE: Excel import export
          {/* EXCEL IMPORT SYNCRONIZATION BOARD * /}
          <section className="bg-white border border-earth-200 rounded-xl p-4 sm:p-5 shadow-2xs flex flex-col md:flex-row items-start md:items-center justify-between gap-4 print:hidden">
            <div className="flex-1">
              <h3 className="text-sm font-bold font-serif text-earth-900 flex items-center gap-1.5">
                <FileText className="w-4 h-4 text-sage-500" />
                Sync Sheets via Excel
              </h3>
              <p className="text-xs text-earth-500 mt-1 leading-relaxed">
                Upload sales quantity quotas and customized selling rates directly. Matched elements instantly correct simulated net profit margins.
              </p>
            </div>
            
            <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2 w-full md:w-auto shrink-0">
              <button
                type="button"
                onClick={downloadTemplate}
                className="px-3.5 py-2 text-xs font-semibold bg-white hover:bg-earth-50 text-earth-800 rounded-lg border border-earth-200 transition-all flex items-center justify-center gap-1.5 cursor-pointer shadow-3xs hover:border-earth-300"
                title="Download pre-populated spreadsheet for Excel mapping"
              >
                <FileText className="w-3.5 h-3.5 text-sage-500" />
                Download Template
              </button>
              
              <label className="px-4 py-2 text-xs font-semibold bg-sage-500 hover:bg-sage-600 text-white rounded-lg transition-all flex items-center justify-center gap-1.5 cursor-pointer shadow-xs relative">
                <RefreshCw className="w-3.5 h-3.5 shrink-0" />
                <span>Upload Excel</span>
                <input
                  type="file"
                  accept=".xlsx, .xls"
                  onChange={handleFileUpload}
                  className="hidden"
                />
              </label>
            </div>
          </section>

          {/* IMPORT STATUS ALERT BOX * /}
          {importStatus.type && (
            <div className={`text-xs p-4 rounded-xl border flex items-start gap-3 justify-between shadow-2xs print:hidden ${
              importStatus.type === 'success' 
                ? 'bg-sage-50 border-sage-200 text-sage-900' 
                : 'bg-rose-50 border-rose-200 text-rose-900'
            }`}>
              <div className="flex items-start gap-2.5">
                {importStatus.type === 'success' ? (
                  <CheckCircle2 className="w-4 h-4 text-sage-600 shrink-0 mt-0.5" />
                ) : (
                  <AlertCircle className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />
                )}
                <span className="leading-relaxed">{importStatus.message}</span>
              </div>
              <button 
                type="button"
                onClick={() => setImportStatus({ type: null, message: '' })}
                className="text-[10px] font-bold uppercase tracking-wider text-earth-500 hover:text-earth-950 underline cursor-pointer shrink-0 ml-2"
              >
                Dismiss
              </button>
            </div>
          )}
          END FUTURE USE: Excel import export */}

          {/* ACTIVE SUMMARY HIGHLIGHT BOARD */}
          <div className="bg-sage-50 border border-sage-200 text-sage-800 rounded-xl px-4 py-3 text-xs flex flex-wrap items-center justify-between gap-3 shadow-2xs">
            <div className="flex items-center gap-2 font-medium">
              <Info className="w-4 h-4 text-sage-600 shrink-0" />
              <span>
                Simulated rates default to <strong>Dealer Prices</strong>. Enter custom selling prices on any product card below to modify profit margins and sales returns dynamically.
              </span>
            </div>
            <div className="text-[11px] bg-sage-200/50 text-sage-800 px-2.5 py-0.5 rounded-full font-bold uppercase tracking-wider">
              MRP Omitted
            </div>
          </div>
        </div>

        {/* RIGHT COLUMN: SIMULATORS & SUMMARY DASHBOARD */}
        <div className="w-full lg:w-96 shrink-0 flex flex-col gap-6">

          {/* SIMULATOR GLOBAL SETTINGS */}
          <section className="bg-white p-5 rounded-xl border border-earth-200 shadow-2xs flex flex-col gap-4 print:hidden">
            <h2 className="text-sm font-bold text-earth-900 flex items-center gap-2 font-serif uppercase tracking-wider">
              <Sliders className="w-4 h-4 text-sage-500" />
              Global Incentive Settings
            </h2>
            <p className="text-xs text-earth-500 -mt-2">
              Apply constant terms to simulate purchase margins dynamically
            </p>

            <div className="space-y-4 pt-2">
              {/* AD slider */}
              <div>
                <div className="flex justify-between items-center text-xs">
                  <span className="font-semibold text-earth-700">Global Annual Discount (AD)</span>
                  <span className="font-bold text-sage-600 p-1 bg-sage-50 rounded-md font-mono">{settings.adPercent}%</span>
                </div>
                <input
                  type="range"
                  min="0"
                  max="10"
                  step="0.5"
                  value={settings.adPercent}
                  onChange={(e) => setSettings({ ...settings, adPercent: parseFloat(e.target.value) })}
                  className="w-full mt-2 accent-sage-500 h-1 bg-earth-200 rounded-lg appearance-none cursor-pointer"
                />
              </div>

              {/* Cash Discount Button select */}
              <div>
                <span className="font-semibold text-earth-700 text-xs block mb-1.5">Cash Discount terms (CD)</span>
                <div className="grid grid-cols-4 gap-1">
                  {(['0-7', '8-15', '16-30', 'none'] as const).map((period) => (
                    <button
                      key={period}
                      type="button"
                      onClick={() => setSettings({ ...settings, cdPeriod: period })}
                      className={`py-1.5 rounded-lg text-[10px] font-bold uppercase transition-all cursor-pointer ${
                        settings.cdPeriod === period
                          ? 'bg-sage-500 text-white shadow-2xs'
                          : 'bg-white border border-earth-200 hover:bg-earth-50 text-earth-800'
                      }`}
                    >
                      {period === 'none' ? '0%' : (period === '0-7' ? '3% (0-7d)' : (period === '8-15' ? '2% (8d)' : '1% (16d)'))}
                    </button>
                  ))}
                </div>
              </div>

              {/* Quarterly Targets */}
              <div>
                <span className="font-semibold text-earth-700 text-xs block mb-1.5">Quarterly Sales Growth incentive</span>
                <div className="grid grid-cols-4 gap-1">
                  {(['low', 'medium', 'high', 'none'] as const).map((rate) => (
                    <button
                      key={rate}
                      type="button"
                      onClick={() => setSettings({ ...settings, growthRate: rate })}
                      className={`py-1.5 rounded-lg text-[10px] font-bold uppercase transition-all cursor-pointer ${
                        settings.growthRate === rate
                          ? 'bg-sage-500 text-white shadow-2xs'
                          : 'bg-white border border-earth-200 hover:bg-earth-50 text-earth-800'
                      }`}
                    >
                      {rate === 'none' ? '0%' : (rate === 'low' ? '3% (5%+)' : (rate === 'medium' ? '5% (10%+)' : '7% (20%+)'))}
                    </button>
                  ))}
                </div>
                <span className="text-[10px] text-earth-405 mt-2 block leading-normal italic text-earth-500">
                  *Terms based on quarterly growth metrics over historical dealer averages.
                </span>
              </div>
            </div>
          </section>

          {/* DYNAMIC SUM BOARD PANEL */}
          <section className="bg-sage-500 text-white rounded-xl p-5 shadow-md flex flex-col gap-4 relative overflow-hidden">
            <div className="absolute right-0 top-0 w-32 h-32 bg-white/10 rounded-full blur-2xl -mr-12 -mt-12" />
            
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 z-10 pb-1 border-b border-white/10">
              <h2 className="text-sm font-bold text-sage-50 uppercase tracking-widest font-serif">
                Order Commercial Summary
              </h2>
              <button
                type="button"
                onClick={handleShareScreenshot}
                className="self-start sm:self-auto px-3 py-1.5 text-xs font-semibold bg-white text-sage-700 hover:bg-sage-50 active:bg-sage-100 rounded-lg shadow-sm transition-all flex items-center gap-1.5 cursor-pointer leading-none"
                title="Capture progress and share the screenshot"
              >
                <Camera className="w-3.5 h-3.5 text-sage-600" />
                <span>Share the screenshot</span>
              </button>
            </div>

            {/* Total Sales */}
            <div>
              <span className="text-[10px] uppercase font-semibold text-sage-100 block tracking-wider">
                Dealer's Monthly Turnover
              </span>
              <div className="text-2xl sm:text-3xl font-bold text-white mt-1 font-serif tracking-tight leading-none">
                ₹{summary.totalRevenue.toLocaleString('en-IN', { maximumFractionDigits: 0 })}
              </div>
            </div>

            {/* Total Cost & Profit Inline split */}
            <div className="grid grid-cols-2 gap-4 border-t border-white/15 pt-4 mt-1">
              <div>
                <span className="text-[10px] uppercase font-semibold text-sage-100 block tracking-wider">
                  Net Supplier Cost
                </span>
                <div className="text-lg font-bold text-sage-50 mt-1 font-mono">
                  ₹{summary.totalCost.toLocaleString('en-IN', { maximumFractionDigits: 0 })}
                </div>
              </div>
              <div>
                <span className="text-[10px] uppercase font-semibold text-sage-100 block tracking-wider">
                  Retained Profit Margin
                </span>
                <div className="text-lg font-black text-white mt-1 font-mono">
                  ₹{summary.totalProfit.toLocaleString('en-IN', { maximumFractionDigits: 0 })}
                </div>
              </div>
            </div>

            {/* Weighted average efficiency circle indicator */}
            <div className="border-t border-white/15 pt-4 flex items-center justify-between gap-3">
              <div>
                <span className="text-[10px] uppercase font-semibold text-sage-100 block tracking-wider">
                  Profit Percentage
                </span>
                <div className="text-sm font-medium text-sage-50 mt-1">
                  Weighted Total Percentage
                </div>
              </div>

              {/* Mini donut chart or visual margin output */}
              <div className="relative flex items-center justify-center shrink-0 w-16 h-16 bg-sage-600 rounded-full border border-white/10">
                <svg className="absolute w-full h-full -rotate-90">
                  <circle
                    cx="32"
                    cy="32"
                    r="26"
                    className="stroke-sage-700 fill-none"
                    strokeWidth="4"
                  />
                  <circle
                    cx="32"
                    cy="32"
                    r="26"
                    className="stroke-white fill-none transition-all duration-500"
                    strokeWidth="4"
                    strokeDasharray={2 * Math.PI * 26}
                    strokeDashoffset={2 * Math.PI * 26 * (1 - Math.min(100, summary.averageMarginPercent) / 100)}
                  />
                </svg>
                <div className="text-xs font-black font-mono text-white">
                  {summary.averageMarginPercent.toFixed(1)}%
                </div>
              </div>
            </div>
          </section>

          {/* PROFIT DISTRIBUTION ANALYTICAL MINI-CHART */}
          {summary.totalProfit > 0 && (
            <section className="bg-white p-5 rounded-xl border border-earth-200 shadow-2xs flex flex-col gap-4 print:hidden">
              <h3 className="text-xs font-bold text-earth-900 uppercase tracking-widest font-serif">
                Retained Margin by Category
              </h3>
              
              <div className="space-y-2.5">
                {Object.entries(summary.categoryProfitMap).map(([category, profit]) => {
                  const profitVal = profit as number;
                  const percentage = (profitVal / summary.totalProfit) * 100;
                  return (
                    <div key={category} className="text-xs text-earth-850">
                      <div className="flex justify-between text-earth-700 mb-1">
                        <span className="truncate max-w-[200px] font-medium">{category}</span>
                        <span className="font-bold text-earth-900 font-mono">
                          ₹{profitVal.toLocaleString('en-IN', { maximumFractionDigits: 0 })} ({percentage.toFixed(0)}%)
                        </span>
                      </div>
                      <div className="w-full bg-earth-100 h-2 rounded-full overflow-hidden border border-earth-200/40">
                        <div 
                          className="bg-sage-500 h-full rounded-full transition-all duration-300"
                          style={{ width: `${percentage}%` }}
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
            </section>
          )}

          {/* PRINT-ONLY COMMERICAL BILL SUMMARY */}
          {/* Hidden on UI, active only during printing commands */}
          <div className="hidden print:block p-10 mt-6 bg-white rounded-xl border border-earth-300 font-sans leading-relaxed text-sm">
            <div className="text-center pb-6 border-b border-earth-200 mb-6">
              <h1 className="text-2xl font-bold font-serif text-earth-900">Commercial Monthly Buy Proposal Statement</h1>
              <p className="text-xs text-earth-500 mt-2">
                Calculated on real-time terms. Report exported on <strong>{new Date().toLocaleDateString('en-IN')}</strong>
              </p>
            </div>

            <div className="grid grid-cols-2 gap-4 mb-6 text-earth-800">
              <div>
                <h4 className="text-[10px] font-bold uppercase text-earth-400">Partner Details</h4>
                <p className="text-sm font-bold text-earth-900">Hardworker Authorized Dealer Portal</p>
                <p className="text-xs text-earth-500">Contractual Account Sheet</p>
              </div>
              <div className="text-right">
                <h4 className="text-[10px] font-bold uppercase text-earth-400">Global Applied Terms</h4>
                <p className="text-xs font-semibold">Global Annual Discount (AD): {settings.adPercent}% (Overridable per SKU)</p>
                <p className="text-xs font-semibold">Cash terms (CD) period: {settings.cdPeriod} days (3% max)</p>
                <p className="text-xs font-semibold">Growth targeted tier: {settings.growthRate} rate (7% max)</p>
              </div>
            </div>

            <table className="w-full text-xs text-left border-collapse border border-earth-200 mb-6">
              <thead className="bg-earth-50 border-b border-earth-200 font-bold text-earth-850">
                <tr>
                  <th className="p-2 border border-earth-200 font-serif">Product Brand & SKU</th>
                  <th className="p-2 text-center border border-earth-200">Quantity Entered</th>
                  <th className="p-2 text-right border border-earth-200">Selling Price</th>
                  <th className="p-2 text-center border border-earth-200">Vol Disc %</th>
                  <th className="p-2 text-right border border-earth-200">Net Buy Price</th>
                  <th className="p-2 text-right border border-earth-200">Monthly Profit</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-earth-200 text-earth-800">
                {activeCalculations.filter(c => c.quantity > 0).map((calc) => (
                  <tr key={calc.product.id}>
                    <td className="p-2 border border-earth-200 font-medium font-serif">
                       {calc.product.name} ({calc.product.sku})
                    </td>
                    <td className="p-2 text-center border border-earth-200 font-semibold">{calc.quantity} units</td>
                    <td className="p-2 text-right border border-earth-200 font-mono">
                      ₹{calc.sellingPrice.toLocaleString('en-IN', { maximumFractionDigits: 1 })}
                      {calc.customSellingPrice !== undefined && ' (Custom)'}
                    </td>
                    <td className="p-2 text-center border border-earth-200 font-semibold">{calc.volumeDiscountPercent}%</td>
                    <td className="p-2 text-right border border-earth-200 font-mono">₹{calc.purchaseUnitPrice.toLocaleString('en-IN', { maximumFractionDigits: 1 })}</td>
                    <td className="p-2 text-right border border-earth-200 font-bold text-sage-700 font-mono">₹{calc.totalProfit.toLocaleString('en-IN', { maximumFractionDigits: 1 })}</td>
                  </tr>
                ))}
              </tbody>
            </table>

            <div className="flex justify-end pt-4 border-t border-earth-200 text-xs gap-6 text-earth-800">
              <div>
                <span className="text-[10px] uppercase font-bold text-earth-400 block">Total Monthly Turnover</span>
                <strong className="text-sm font-extrabold text-earth-900 font-mono">₹{summary.totalRevenue.toLocaleString('en-IN')}</strong>
              </div>
              <div>
                <span className="text-[10px] uppercase font-bold text-earth-400 block">Weighted Effective Margin</span>
                <strong className="text-sm font-extrabold text-sage-600 font-mono">{summary.averageMarginPercent.toFixed(1)}%</strong>
              </div>
              <div>
                <span className="text-[10px] uppercase font-bold text-earth-400 block">Gross Monthly Retained Profit</span>
                <strong className="text-sm font-extrabold text-sage-700 font-mono">₹{summary.totalProfit.toLocaleString('en-IN')}</strong>
              </div>
            </div>

            <div className="text-[10px] text-center text-earth-400 mt-12 border-t border-earth-150 pt-3 italic">
              This statement presents automated projections calculated from default commercial sheets. All transaction orders must be verified against actual vendor contracts.
            </div>
          </div>

        </div>

      </main>
      ) : !isBackendUnlocked ? (
        <main className="flex-1 max-w-7xl w-full mx-auto p-4 sm:p-6 lg:p-8 flex items-center justify-center min-h-[60vh] print:hidden">
          <motion.div 
            initial={{ opacity: 0, y: 15 }}
            animate={{ opacity: 1, y: 0 }}
            className="w-full max-w-md bg-white border border-earth-200 rounded-2xl p-6 sm:p-8 shadow-md"
          >
            <div className="flex flex-col items-center text-center">
              <div className="w-12 h-12 rounded-full bg-amber-50 border border-amber-200 flex items-center justify-center text-amber-500 mb-4 shadow-3xs animate-pulse">
                <Lock className="w-5 h-5" />
              </div>
              <h2 className="text-xl font-bold font-serif text-earth-900 leading-tight">
                Backend Sheet Protected
              </h2>
              <p className="text-xs text-earth-500 mt-2 max-w-xs leading-relaxed">
                The Backend Master Pricing & Volume Slabs Manager contains sensitive commercial definitions. Please enter the master password to gain edit access.
              </p>
            </div>

            <form 
              onSubmit={(e) => {
                e.preventDefault();
                if (enteredPassword === 'Hardworker@123') {
                  setIsBackendUnlocked(true);
                  setPasswordError('');
                  setEnteredPassword('');
                } else {
                  setPasswordError('Incorrect password. Please try again.');
                }
              }} 
              className="mt-6 space-y-4"
            >
              <div>
                <label className="block text-[11px] font-bold text-earth-700 uppercase tracking-wider font-mono mb-1.5">
                  Master Password
                </label>
                <div className="relative">
                  <input
                    type="password"
                    required
                    value={enteredPassword}
                    onChange={(e) => {
                      setEnteredPassword(e.target.value);
                      if (passwordError) setPasswordError('');
                    }}
                    placeholder="••••••••••••"
                    className="w-full px-3.5 py-2 text-sm bg-earth-50/50 hover:bg-earth-50 border border-earth-200 focus:border-sage-500 focus:bg-white rounded-lg transition-all shadow-3xs text-earth-900 placeholder-earth-400 focus:outline-none"
                  />
                  <div className="absolute right-3 top-2.5 text-earth-400">
                    <Key className="w-4 h-4" />
                  </div>
                </div>
                {passwordError && (
                  <motion.p 
                    initial={{ opacity: 0, x: -4 }}
                    animate={{ opacity: 1, x: 0 }}
                    className="text-xs text-rose-600 mt-1.5 flex items-center gap-1 font-medium animate-bounce"
                  >
                    <AlertCircle className="w-3.5 h-3.5 shrink-0" />
                    {passwordError}
                  </motion.p>
                )}
              </div>

              <div className="flex gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => {
                    setActiveTab('calculator');
                    setEnteredPassword('');
                    setPasswordError('');
                  }}
                  className="flex-1 py-2 text-xs font-semibold bg-white hover:bg-earth-50 text-earth-800 rounded-lg border border-earth-200 transition-all cursor-pointer shadow-3xs text-center"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="flex-1 py-2 text-xs font-semibold bg-sage-500 hover:bg-sage-600 active:bg-sage-700 text-white rounded-lg shadow-xs transition-all cursor-pointer"
                >
                  Unlock Access
                </button>
              </div>
            </form>
          </motion.div>
        </main>
      ) : (
        <main className="flex-1 max-w-7xl w-full mx-auto p-4 sm:p-6 lg:p-8 flex flex-col gap-6 fade-in print:hidden">
          {/* BACKEND SHEET STYLING */}
          {/* HEADER SUMMARY CARD */}
          <div className="bg-white p-6 rounded-xl border border-earth-200 shadow-xs flex flex-col md:flex-row md:items-center justify-between gap-5 animate-fade-in">
            <div>
              <h2 className="text-lg font-bold text-earth-900 font-serif leading-none flex items-center gap-2">
                <Sliders className="w-5 h-5 text-sage-500" />
                Backend Master Pricing & Volume Slabs Manager
              </h2>
              <p className="text-xs text-earth-500 mt-1.5 leading-relaxed">
                Directly adjust dealer prices or configure multi-tier progressive slab brackets. All changes apply globally and dynamically calculate retained profits in-simulator.
              </p>
            </div>
            <button
              type="button"
              onClick={() => {
                setIsBackendUnlocked(false);
                setActiveTab('calculator');
              }}
              className="px-4 py-2 text-xs font-semibold bg-rose-50 border border-rose-200 text-rose-700 hover:bg-rose-100/60 rounded-lg transition-all flex items-center gap-1.5 shadow-3xs cursor-pointer select-none"
            >
              <Lock className="w-3.5 h-3.5 text-rose-500" />
              <span>Lock Sheet</span>
            </button>
          </div>

          {/* TEMPLATE DOCK CONTROL ROW */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
            {/* Download card */}
            <div className="bg-white rounded-xl border border-earth-200 p-5 shadow-3xs hover:shadow-2xs transition-all flex flex-col justify-between">
              <div>
                <h3 className="text-xs font-bold text-earth-700 uppercase tracking-wider font-mono">
                  1. Download Master Template
                </h3>
                <p className="text-xs text-earth-500 mt-1.5 leading-normal">
                  Export the entire database of products, standard costs, and existing slab ranges as a formatted Excel table (.xlsx).
                </p>
              </div>
              <button
                type="button"
                onClick={downloadPricingMasterTemplate}
                className="mt-4 w-full py-2 px-4 bg-white border border-earth-300 hover:border-sage-500 hover:bg-sage-50/20 text-earth-800 text-xs font-bold rounded-lg transition-all flex items-center justify-center gap-2 shadow-3xs cursor-pointer"
              >
                📥 Download Pricing Excel Template
              </button>
            </div>

            {/* Upload card */}
            <div className="bg-white rounded-xl border border-earth-200 p-5 shadow-3xs hover:shadow-2xs transition-all flex flex-col justify-between">
              <div>
                <h3 className="text-xs font-bold text-earth-700 uppercase tracking-wider font-mono">
                  2. Upload Pricing Spreadsheet
                </h3>
                <p className="text-xs text-earth-500 mt-1.5 leading-normal">
                  Upload your modified Excel sheet. We match records using <strong>Product ID</strong>. Brackets will compile automatically.
                </p>
              </div>
              <div className="mt-4 relative">
                <label className="w-full py-2 px-4 bg-sage-500 hover:bg-sage-600 text-white text-xs font-bold rounded-lg transition-all flex items-center justify-center gap-2 shadow-sm cursor-pointer hover:shadow-md">
                  📤 Upload Excel Sheet
                  <input
                    type="file"
                    accept=".xlsx, .xls, .csv"
                    onChange={handlePricingFileUpload}
                    className="hidden"
                  />
                </label>
              </div>
            </div>

            {/* Restore defaults card */}
            <div className="bg-white rounded-xl border border-earth-200 p-5 shadow-3xs hover:shadow-2xs transition-all flex flex-col justify-between">
              <div>
                <h3 className="text-xs font-bold text-earth-700 uppercase tracking-wider font-mono">
                  3. Restore Master Database
                </h3>
                <p className="text-xs text-earth-500 mt-1.5 leading-normal">
                  Revert all dynamic price and volume bracket adjustments back to default factory-coded standard rules. This cannot be undone.
                </p>
              </div>
              <button
                type="button"
                onClick={handleResetToDefaultPricing}
                className="mt-4 w-full py-2 px-4 bg-rose-50 border border-rose-200 hover:bg-rose-100/60 text-rose-700 text-xs font-bold rounded-lg transition-all flex items-center justify-center gap-2 shadow-3xs cursor-pointer"
              >
                ⚠️ Restore Standard Defaults
              </button>
            </div>
          </div>

          {/* APP OVERRIDE SUCCESS/FAILURE MESSAGES */}
          {pricingImportStatus.type && (
            <div
              className={`p-4 rounded-lg border flex items-start gap-3 shadow-3xs transition-all ${
                pricingImportStatus.type === 'success'
                  ? 'border-emerald-200 bg-emerald-50/50 text-emerald-800'
                  : 'border-rose-200 bg-rose-50/50 text-rose-800'
              }`}
            >
              <div className="mt-0.5">
                {pricingImportStatus.type === 'success' ? (
                  <CheckCircle2 className="w-4 h-4 text-emerald-500" />
                ) : (
                  <AlertCircle className="w-4 h-4 text-rose-500" />
                )}
              </div>
              <div>
                <strong className="text-xs font-bold block mb-0.5">
                  {pricingImportStatus.type === 'success' ? 'Database sync completed' : 'Spreadsheet processing error'}
                </strong>
                <p className="text-xs leading-relaxed">{pricingImportStatus.message}</p>
              </div>
            </div>
          )}

          {/* SEARCH & FILTERS SPECIFIC FOR PRICING */}
          <div className="bg-earth-100 p-4 rounded-xl border border-earth-200 flex flex-col md:flex-row items-center justify-between gap-4">
            <div className="relative flex-1 w-full max-w-md">
              <Search className="absolute left-3 top-2.5 w-4 h-4 text-earth-400" />
              <input
                type="text"
                placeholder="Search master database by index name or ID code..."
                value={pricingSearchQuery}
                onChange={(e) => setPricingSearchQuery(e.target.value)}
                className="w-full pl-9 pr-4 py-2 text-sm bg-white border border-earth-300 focus:border-sage-500 focus:ring-2 focus:ring-sage-500/10 rounded-lg outline-none transition-all placeholder:text-earth-400 text-earth-800"
              />
            </div>

            <div className="flex items-center gap-2.5 w-full md:w-auto shrink-0 flex-wrap">
              <span className="text-xs font-bold text-earth-600 hidden sm:inline">Category:</span>
              <select
                value={pricingActiveCategory}
                onChange={(e) => setPricingActiveCategory(e.target.value as any)}
                className="bg-white border border-earth-300 text-earth-800 text-xs px-3 py-2 rounded-lg outline-none cursor-pointer focus:border-sage-500 focus:ring-1 focus:ring-sage-500 shadow-3xs w-full sm:w-auto font-medium"
              >
                {CATEGORIES.map((cat) => (
                  <option key={cat} value={cat}>
                    {cat}
                  </option>
                ))}
              </select>
              <button
                type="button"
                onClick={() => setAddProductModalOpen(true)}
                className="px-4 py-2 text-xs font-bold bg-sage-500 hover:bg-sage-600 active:bg-sage-700 text-white rounded-lg shadow-sm hover:shadow-md transition-all flex items-center justify-center gap-1.5 cursor-pointer w-full sm:w-auto uppercase tracking-wide"
              >
                <Plus className="w-4 h-4" />
                Add Custom Product
              </button>
            </div>
          </div>

          {/* SHEET DATA GRID */}
          <div className="bg-white rounded-xl border border-earth-200 shadow-3xs overflow-hidden hidden md:block">
            <div className="overflow-x-auto font-sans">
              <table className="w-full text-left text-xs border-collapse">
                <thead>
                  <tr className="bg-earth-100/80 text-earth-700 font-bold border-b border-earth-200 uppercase tracking-wider text-[10px]">
                    <th className="p-4 w-[30%]">Product Information</th>
                    <th className="p-4 w-[20%]">Category</th>
                    <th className="p-4 w-[15%]">Dealer Price (INR)</th>
                    <th className="p-4 w-[15%]">Discount Unit</th>
                    <th className="p-4 w-[20%] text-center">Active Slab Ranges (Min Thresholds)</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-earth-150 text-earth-800">
                  {filteredPricingProducts.length > 0 ? (
                    filteredPricingProducts.map((p) => (
                      <tr key={p.id} className="hover:bg-earth-50/40 transition-colors">
                        <td className="p-4">
                          {editingProductId === p.id ? (
                            <div className="flex flex-col gap-2.5 bg-earth-50/50 p-2.5 rounded-lg border border-earth-200">
                              <div>
                                <label className="text-[9px] uppercase font-bold text-earth-500 block mb-0.5">Product Name</label>
                                <input
                                  type="text"
                                  id={`edit-name-${p.id}`}
                                  value={editName}
                                  onChange={(e) => setEditName(e.target.value)}
                                  className="w-full bg-white border border-earth-300 rounded px-2 py-1 text-xs font-serif uppercase focus:border-sage-500 focus:ring-1 focus:ring-sage-500 text-earth-900"
                                />
                              </div>
                              <div>
                                <label className="text-[9px] uppercase font-bold text-earth-500 block mb-0.5">SKU Description</label>
                                <input
                                  type="text"
                                  id={`edit-sku-${p.id}`}
                                  value={editSku}
                                  onChange={(e) => setEditSku(e.target.value)}
                                  className="w-full bg-white border border-earth-300 rounded px-2 py-1 text-xs focus:border-sage-500 focus:ring-1 focus:ring-sage-500 text-earth-900"
                                />
                              </div>
                              <div className="flex items-center gap-2">
                                <div className="flex-1">
                                  <label className="text-[9px] uppercase font-bold text-earth-500 block mb-0.5">Size Value</label>
                                  <input
                                    type="number"
                                    id={`edit-weight-${p.id}`}
                                    step="any"
                                    min="0.1"
                                    value={editSkuWeight}
                                    onChange={(e) => setEditSkuWeight(parseFloat(e.target.value) || 0)}
                                    className="w-full bg-white border border-earth-300 rounded px-2 py-1 text-xs font-mono focus:border-sage-500 focus:ring-1 focus:ring-sage-500 text-earth-900"
                                  />
                                </div>
                                <div className="w-20">
                                  <label className="text-[9px] uppercase font-bold text-earth-500 block mb-0.5">Unit</label>
                                  <select
                                    id={`edit-unit-${p.id}`}
                                    value={editSkuUnit}
                                    onChange={(e) => setEditSkuUnit(e.target.value as UnitType)}
                                    className="w-full bg-white border border-earth-300 rounded px-2 py-1 text-xs focus:border-sage-500 focus:ring-1 focus:ring-sage-500 cursor-pointer text-earth-900"
                                  >
                                    <option value="kg">kg</option>
                                    <option value="L">L</option>
                                  </select>
                                </div>
                              </div>
                              <div className="flex items-center gap-2 mt-1">
                                <button
                                  type="button"
                                  id={`save-btn-${p.id}`}
                                  onClick={() => {
                                    if (!editName.trim()) return;
                                    const updated = products.map((item) =>
                                      item.id === p.id ? { 
                                        ...item, 
                                        name: editName.trim(), 
                                        sku: editSku.trim() || `${editSkuWeight} ${editSkuUnit}`, 
                                        skuWeight: editSkuWeight, 
                                        skuUnit: editSkuUnit 
                                      } : item
                                    );
                                    updateProductsAndPersist(updated);
                                    setEditingProductId(null);
                                  }}
                                  className="px-2.5 py-1 text-[10px] font-bold bg-sage-500 text-white rounded hover:bg-sage-600 transition-colors flex items-center gap-1 cursor-pointer"
                                >
                                  <Check className="w-3 h-3" /> Save
                                </button>
                                <button
                                  type="button"
                                  id={`cancel-btn-${p.id}`}
                                  onClick={() => setEditingProductId(null)}
                                  className="px-2.5 py-1 text-[10px] font-bold bg-earth-200 text-earth-700 rounded hover:bg-earth-300 transition-colors flex items-center gap-1 cursor-pointer"
                                >
                                  <X className="w-3 h-3" /> Cancel
                                </button>
                              </div>
                            </div>
                          ) : (
                            <div className="group flex items-start justify-between gap-2.5">
                              <div>
                                <div className="font-bold text-earth-900 text-sm leading-tight font-serif uppercase">{p.name}</div>
                                <div className="flex items-center gap-1.5 mt-1">
                                  <span className="bg-earth-100 text-earth-500 font-mono text-[9px] px-1.5 py-0.5 rounded border border-earth-200/50">
                                    {p.id}
                                  </span>
                                  <span className="text-earth-500 text-[11px] font-medium leading-none">
                                    {p.sku} ({p.skuWeight} {p.skuUnit})
                                  </span>
                                </div>
                              </div>
                              <button
                                type="button"
                                id={`edit-btn-${p.id}`}
                                onClick={() => {
                                  setEditingProductId(p.id);
                                  setEditName(p.name);
                                  setEditSku(p.sku);
                                  setEditSkuWeight(p.skuWeight);
                                  setEditSkuUnit(p.skuUnit);
                                }}
                                className="p-1 rounded bg-earth-100 text-earth-600 hover:bg-sage-100 hover:text-sage-700 opacity-80 md:opacity-0 md:group-hover:opacity-100 focus:opacity-100 transition-all cursor-pointer"
                                title="Edit product name or packing details"
                              >
                                <Edit2 className="w-3.5 h-3.5" />
                              </button>
                            </div>
                          )}
                        </td>
                        <td className="p-4">
                          <span className="text-xs font-semibold text-earth-600 bg-earth-100/50 px-2 py-1 rounded-md border border-earth-200/20">
                            {p.category}
                          </span>
                        </td>
                        <td className="p-4">
                          <div className="flex items-center gap-1.5 max-w-[120px]">
                            <span className="text-earth-500 font-bold">₹</span>
                            <input
                              type="number"
                              min="0"
                              value={p.dealerPrice}
                              onChange={(e) => {
                                const newPrice = parseFloat(e.target.value) || 0;
                                const updated = products.map((item) =>
                                  item.id === p.id ? { ...item, dealerPrice: newPrice } : item
                                );
                                updateProductsAndPersist(updated);
                              }}
                              className="w-full bg-white border border-earth-250 py-1 px-2 text-xs font-mono font-bold rounded-lg outline-none text-earth-900 focus:border-sage-500 focus:ring-1 focus:ring-sage-500"
                            />
                          </div>
                        </td>
                        <td className="p-4">
                          <select
                            value={p.volumeDiscountRule ? p.volumeDiscountRule.unit : 'none'}
                            onChange={(e) => {
                              const val = e.target.value;
                              const updated = products.map((item) => {
                                if (item.id === p.id) {
                                  if (val === 'none') {
                                    return { ...item, volumeDiscountRule: null };
                                  } else {
                                    return {
                                      ...item,
                                      volumeDiscountRule: {
                                        unit: val as 'MT' | 'kg' | 'L',
                                        brackets: item.volumeDiscountRule?.brackets || []
                                      }
                                    };
                                  }
                                }
                                return item;
                              });
                              updateProductsAndPersist(updated);
                            }}
                            className="bg-white border border-earth-250 text-xs px-2 py-1 rounded-lg outline-none text-earth-900 font-medium cursor-pointer"
                          >
                            <option value="none">No Discount</option>
                            <option value="MT">MT (Metric Ton)</option>
                            <option value="kg">kg (Kilogram)</option>
                            <option value="L">L (Liter)</option>
                          </select>
                        </td>
                        <td className="p-4 text-center">
                          {p.volumeDiscountRule ? (
                            <div className="flex flex-col items-center gap-1.5">
                              <div className="flex flex-wrap gap-1 items-center justify-center max-w-sm">
                                {p.volumeDiscountRule.brackets.map((b, idx) => (
                                  <span
                                    key={idx}
                                    className="bg-sage-50 border border-sage-200 text-sage-800 rounded px-1.5 py-0.5 text-[9px] font-bold font-mono"
                                    title={`${b.min} to ${b.max === Infinity ? 'Infinity' : b.max} ${p.volumeDiscountRule?.unit}`}
                                  >
                                    {b.min}+ {p.volumeDiscountRule?.unit} → {b.discountPercent}%
                                  </span>
                                ))}
                              </div>
                              <button
                                type="button"
                                onClick={() => openSlabEditor(p)}
                                className="px-2.5 py-1 text-[10px] font-bold text-sage-600 bg-white hover:bg-sage-100 border border-sage-300 rounded hover:border-sage-500 transition-all cursor-pointer inline-flex items-center gap-1"
                              >
                                Configure Brackets ({p.volumeDiscountRule.brackets.length})
                              </button>
                            </div>
                          ) : (
                            <div className="flex flex-col items-center gap-1 text-earth-450 italic leading-none">
                              <span>No automatic volume discount rule active.</span>
                              <button
                                type="button"
                                onClick={() => {
                                  const baseRule = {
                                    unit: p.skuUnit === 'kg' ? 'kg' as const : 'L' as const,
                                    brackets: [{ min: p.skuUnit === 'kg' ? 100 : 50, max: Infinity, discountPercent: 5 }]
                                  };
                                  const updated = products.map((item) =>
                                    item.id === p.id ? { ...item, volumeDiscountRule: baseRule } : item
                                  );
                                  updateProductsAndPersist(updated);
                                }}
                                className="not-italic text-[10px] font-bold text-sage-600 hover:underline mt-1 bg-transparent border-0 cursor-pointer"
                              >
                                ＋ Initialize Slab Discounts
                              </button>
                            </div>
                          )}
                        </td>
                      </tr>
                    ))
                  ) : (
                    <tr>
                      <td colSpan={5} className="p-8 text-center text-earth-500 italic font-mono scale-xs">
                        No product matches search terms. Try clearing search filters or importing the template list.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>

          {/* MOBILE CARD VIEW (Fixed view, no horizontal scrolling) */}
          <div className="block md:hidden space-y-4">
            {filteredPricingProducts.length > 0 ? (
              filteredPricingProducts.map((p) => (
                <div key={p.id} className="bg-white rounded-xl border border-earth-200 shadow-2xs p-4 flex flex-col gap-3.5">
                  {/* Card Header: Product Name & Category & Edit Action */}
                  <div className="border-b border-earth-150 pb-3">
                    {editingProductId === p.id ? (
                      <div className="flex flex-col gap-2.5 bg-earth-50/50 p-2.5 rounded-lg border border-earth-200">
                        <div>
                          <label className="text-[9px] uppercase font-bold text-earth-500 block mb-0.5">Product Name</label>
                          <input
                            type="text"
                            id={`edit-name-mob-${p.id}`}
                            value={editName}
                            onChange={(e) => setEditName(e.target.value)}
                            className="w-full bg-white border border-earth-300 rounded px-2 py-1 text-xs font-serif uppercase focus:border-sage-500 focus:ring-1 focus:ring-sage-500 text-earth-900"
                          />
                        </div>
                        <div>
                          <label className="text-[9px] uppercase font-bold text-earth-500 block mb-0.5">SKU Description</label>
                          <input
                            type="text"
                            id={`edit-sku-mob-${p.id}`}
                            value={editSku}
                            onChange={(e) => setEditSku(e.target.value)}
                            className="w-full bg-white border border-earth-300 rounded px-2 py-1 text-xs focus:border-sage-500 focus:ring-1 focus:ring-sage-500 text-earth-900"
                          />
                        </div>
                        <div className="flex items-center gap-2">
                          <div className="flex-1">
                            <label className="text-[9px] uppercase font-bold text-earth-500 block mb-0.5">Size Value</label>
                            <input
                              type="number"
                              id={`edit-weight-mob-${p.id}`}
                              step="any"
                              min="0.1"
                              value={editSkuWeight}
                              onChange={(e) => setEditSkuWeight(parseFloat(e.target.value) || 0)}
                              className="w-full bg-white border border-earth-300 rounded px-2 py-1 text-xs font-mono focus:border-sage-500 focus:ring-1 focus:ring-sage-500 text-earth-900"
                            />
                          </div>
                          <div className="w-20">
                            <label className="text-[9px] uppercase font-bold text-earth-500 block mb-0.5">Unit</label>
                            <select
                              id={`edit-unit-mob-${p.id}`}
                              value={editSkuUnit}
                              onChange={(e) => setEditSkuUnit(e.target.value as UnitType)}
                              className="w-full bg-white border border-earth-300 rounded px-2 py-1 text-xs focus:border-sage-500 focus:ring-1 focus:ring-sage-500 cursor-pointer text-earth-900"
                            >
                              <option value="kg">kg</option>
                              <option value="L">L</option>
                            </select>
                          </div>
                        </div>
                        <div className="flex items-center gap-2 mt-1">
                          <button
                            type="button"
                            id={`save-btn-mob-${p.id}`}
                            onClick={() => {
                              if (!editName.trim()) return;
                              const updated = products.map((item) =>
                                item.id === p.id ? { 
                                  ...item, 
                                  name: editName.trim(), 
                                  sku: editSku.trim() || `${editSkuWeight} ${editSkuUnit}`, 
                                  skuWeight: editSkuWeight, 
                                  skuUnit: editSkuUnit 
                                } : item
                              );
                              updateProductsAndPersist(updated);
                              setEditingProductId(null);
                            }}
                            className="px-2.5 py-1 text-[10px] font-bold bg-sage-500 text-white rounded hover:bg-sage-600 transition-colors flex items-center gap-1 cursor-pointer"
                          >
                            <Check className="w-3 h-3" /> Save
                          </button>
                          <button
                            type="button"
                            id={`cancel-btn-mob-${p.id}`}
                            onClick={() => setEditingProductId(null)}
                            className="px-2.5 py-1 text-[10px] font-bold bg-earth-200 text-earth-700 rounded hover:bg-earth-300 transition-colors flex items-center gap-1 cursor-pointer"
                          >
                            <X className="w-3 h-3" /> Cancel
                          </button>
                        </div>
                      </div>
                    ) : (
                      <div className="flex items-start justify-between gap-3">
                        <div className="flex-1 min-w-0">
                          <div className="font-bold text-earth-900 text-sm leading-tight font-serif uppercase break-words">{p.name}</div>
                          <div className="flex flex-wrap items-center gap-1.5 mt-1.5">
                            <span className="bg-earth-100 text-earth-500 font-mono text-[9px] px-1.5 py-0.5 rounded border border-earth-200/50">
                              {p.id}
                            </span>
                            <span className="text-earth-500 text-[11px] font-medium leading-none">
                              {p.sku} ({p.skuWeight} {p.skuUnit})
                            </span>
                          </div>
                        </div>
                        <button
                          type="button"
                          id={`edit-btn-mob-trigger-${p.id}`}
                          onClick={() => {
                            setEditingProductId(p.id);
                            setEditName(p.name);
                            setEditSku(p.sku);
                            setEditSkuWeight(p.skuWeight);
                            setEditSkuUnit(p.skuUnit);
                          }}
                          className="p-2 rounded bg-earth-100 text-earth-600 active:bg-sage-100 active:text-sage-700 transition-all cursor-pointer flex items-center gap-1 border border-earth-200 shrink-0"
                          title="Edit product name or packing details"
                        >
                          <Edit2 className="w-3.5 h-3.5" />
                          <span className="text-[11px] font-bold">Edit</span>
                        </button>
                      </div>
                    )}
                  </div>

                  {/* Card Body: Interactive Inputs */}
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-xs text-earth-700">
                    <div>
                      <span className="text-[10px] uppercase font-bold text-earth-450 block mb-1">Category</span>
                      <span className="inline-block font-semibold text-earth-600 bg-earth-100/50 px-2.5 py-1 rounded border border-earth-200/20">
                        {p.category}
                      </span>
                    </div>

                    <div>
                      <span className="text-[10px] uppercase font-bold text-earth-450 block mb-1">Dealer Price (INR)</span>
                      <div className="flex items-center gap-1.5 max-w-[150px]">
                        <span className="text-earth-500 font-bold">₹</span>
                        <input
                          type="number"
                          min="0"
                          value={p.dealerPrice}
                          onChange={(e) => {
                            const newPrice = parseFloat(e.target.value) || 0;
                            const updated = products.map((item) =>
                              item.id === p.id ? { ...item, dealerPrice: newPrice } : item
                            );
                            updateProductsAndPersist(updated);
                          }}
                          className="w-full bg-white border border-earth-250 py-1 px-2.5 text-xs font-mono font-bold rounded-lg outline-none text-earth-900 focus:border-sage-500 focus:ring-1 focus:ring-sage-500"
                        />
                      </div>
                    </div>

                    <div className="border-t border-earth-100 pt-3">
                      <span className="text-[10px] uppercase font-bold text-earth-450 block mb-1">Discount Unit</span>
                      <select
                        value={p.volumeDiscountRule ? p.volumeDiscountRule.unit : 'none'}
                        onChange={(e) => {
                          const val = e.target.value;
                          const updated = products.map((item) => {
                            if (item.id === p.id) {
                              if (val === 'none') {
                                return { ...item, volumeDiscountRule: null };
                              } else {
                                return {
                                  ...item,
                                  volumeDiscountRule: {
                                    unit: val as 'MT' | 'kg' | 'L',
                                    brackets: item.volumeDiscountRule?.brackets || []
                                  }
                                };
                              }
                            }
                            return item;
                          });
                          updateProductsAndPersist(updated);
                        }}
                        className="w-full max-w-[150px] bg-white border border-earth-250 text-xs px-2 py-1.5 rounded-lg outline-none text-earth-900 font-medium cursor-pointer"
                      >
                        <option value="none">No Discount</option>
                        <option value="MT">MT (Metric Ton)</option>
                        <option value="kg">kg (Kilogram)</option>
                        <option value="L">L (Liter)</option>
                      </select>
                    </div>

                    <div className="border-t border-earth-100 pt-3 sm:col-span-1">
                      <span className="text-[10px] uppercase font-bold text-earth-450 block mb-1.5">Active Slab Ranges</span>
                      {p.volumeDiscountRule ? (
                        <div className="flex flex-col gap-2">
                          <div className="flex flex-wrap gap-1 items-center">
                            {p.volumeDiscountRule.brackets.map((b, idx) => (
                              <span
                                key={idx}
                                className="bg-sage-50 border border-sage-200 text-sage-800 rounded px-1.5 py-0.5 text-[9px] font-bold font-mono"
                              >
                                {b.min}+ {p.volumeDiscountRule?.unit} → {b.discountPercent}%
                              </span>
                            ))}
                          </div>
                          <button
                            type="button"
                            onClick={() => openSlabEditor(p)}
                            className="w-full sm:w-auto px-3 py-1.5 text-center text-xs font-bold text-sage-600 bg-white hover:bg-sage-100 border border-sage-300 rounded hover:border-sage-500 transition-all cursor-pointer flex items-center justify-center gap-1"
                          >
                            Configure Brackets ({p.volumeDiscountRule.brackets.length})
                          </button>
                        </div>
                      ) : (
                        <div className="flex flex-col gap-1.5 text-earth-450 italic leading-normal">
                          <span>No automatic volume discount rule active.</span>
                          <button
                            type="button"
                            onClick={() => {
                              const baseRule = {
                                unit: p.skuUnit === 'kg' ? 'kg' as const : 'L' as const,
                                brackets: [{ min: p.skuUnit === 'kg' ? 100 : 50, max: Infinity, discountPercent: 5 }]
                              };
                              const updated = products.map((item) =>
                                item.id === p.id ? { ...item, volumeDiscountRule: baseRule } : item
                              );
                              updateProductsAndPersist(updated);
                            }}
                            className="w-full sm:w-auto text-center not-italic px-3 py-1.5 text-xs font-bold text-sage-600 border border-dashed border-earth-250 rounded-lg bg-transparent cursor-pointer hover:bg-earth-100/50"
                          >
                            ＋ Initialize Slab Discounts
                          </button>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              ))
            ) : (
              <div className="p-8 text-center text-earth-500 italic font-mono bg-white rounded-xl border border-earth-200">
                No product matches search terms. Try clearing search filters or importing the template list.
              </div>
            )}
          </div>
        </main>
      )}

      {/* SLAB TIERS EDITOR MODAL */}
      <AnimatePresence>
        {editingProductSlabs && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/50 backdrop-blur-xs flex items-center justify-center p-4 z-50 print:hidden"
          >
            <motion.div
              initial={{ scale: 0.95, y: 15 }}
              animate={{ scale: 1, y: 0 }}
              exit={{ scale: 0.95, y: 15 }}
              className="bg-white rounded-xl shadow-xl max-w-lg w-full overflow-hidden border border-earth-200 flex flex-col max-h-[85vh]"
            >
              <div className="bg-earth-100 p-4 border-b border-earth-250 flex items-center justify-between">
                <div>
                  <h3 className="text-sm font-bold text-earth-900 uppercase font-serif">
                    Configure Discount Brackets
                  </h3>
                  <p className="text-[10px] text-earth-500 mt-0.5 max-w-sm truncate leading-none">
                    {editingProductSlabs.name} ({editingProductSlabs.sku})
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setEditingProductSlabs(null)}
                  className="p-1 rounded-lg hover:bg-earth-200 text-earth-400 hover:text-earth-600 transition-colors cursor-pointer"
                >
                  <Minus className="w-4 h-4" />
                </button>
              </div>

              <div className="p-5 overflow-y-auto flex-1 flex flex-col gap-4">
                {/* Unit selector */}
                <div className="flex items-center justify-between bg-earth-50 p-3 rounded-lg border border-earth-150">
                  <span className="text-xs font-bold text-earth-700">Slab Weight / Volume Unit:</span>
                  <select
                    value={tempUnit}
                    onChange={(e) => setTempUnit(e.target.value as any)}
                    className="p-1.5 border border-earth-300 rounded bg-white text-xs text-earth-800 font-semibold cursor-pointer outline-none focus:border-sage-500"
                  >
                    <option value="MT">MT (Metric Tons)</option>
                    <option value="kg">kg (Kilograms)</option>
                    <option value="L">L (Liters)</option>
                  </select>
                </div>

                {/* Slabs instructions */}
                <div className="text-[11px] leading-relaxed text-earth-500 bg-sage-50/30 p-3 rounded-lg border border-sage-100 flex items-start gap-2">
                  <Info className="w-3.5 h-3.5 text-sage-500 shrink-0 mt-0.5" />
                  <div>
                    Enter the minimum volume threshold and the discount rate. Brackets are progressive: the maximum limit for each slab will be computed automatically according to the next minimum threshold.
                  </div>
                </div>

                {/* Slabs inputs table */}
                <div className="flex flex-col gap-2">
                  <div className="grid grid-cols-12 gap-2 text-[10px] font-bold text-earth-450 uppercase tracking-wider px-2">
                    <div className="col-span-5">Min Volume ({tempUnit})</div>
                    <div className="col-span-5">Discount %</div>
                    <div className="col-span-2 text-center">Action</div>
                  </div>

                  <div className="flex flex-col gap-2 max-h-[30vh] overflow-y-auto pr-1">
                    {tempSlabs.map((slab, idx) => (
                      <div key={idx} className="grid grid-cols-12 gap-2 items-center bg-earth-50/40 p-1.5 rounded-lg border border-earth-150/40">
                        <div className="col-span-5 relative flex items-center">
                          <input
                            type="number"
                            step="any"
                            min="0"
                            placeholder="e.g. 5.00"
                            value={slab.min}
                            onChange={(e) => handleTempSlabChange(idx, 'min', parseFloat(e.target.value) || 0)}
                            className="w-full bg-white border border-earth-250 py-1 px-2 text-xs font-mono rounded outline-none focus:border-sage-500 text-earth-900"
                          />
                        </div>
                        <div className="col-span-5 relative flex items-center">
                          <input
                            type="number"
                            min="0"
                            max="100"
                            placeholder="e.g. 10"
                            value={slab.discountPercent}
                            onChange={(e) => handleTempSlabChange(idx, 'discountPercent', parseFloat(e.target.value) || 0)}
                            className="w-full bg-white border border-earth-250 py-1 px-2 text-xs font-mono rounded outline-none focus:border-sage-500 text-earth-900 focus:ring-1 focus:ring-sage-500"
                          />
                          <span className="absolute right-2 text-earth-450 font-bold font-mono text-[11px] leading-none">%</span>
                        </div>
                        <div className="col-span-2 flex justify-center">
                          <button
                            type="button"
                            onClick={() => handleRemoveTempSlab(idx)}
                            className="p-1 text-rose-500 hover:text-rose-700 hover:bg-rose-50 rounded transition-colors cursor-pointer"
                            title="Delete this bracket"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>

                  {tempSlabs.length === 0 && (
                    <div className="text-center py-4 text-xs italic text-earth-400 border border-dashed border-earth-200 rounded-lg">
                      No discount brackets defined. Add a bracket below.
                    </div>
                  )}

                  <button
                    type="button"
                    onClick={handleAddTempSlab}
                    className="mt-1 py-1.5 w-full bg-white hover:bg-earth-50 border border-dashed border-earth-300 hover:border-earth-400 text-earth-700 text-xs font-bold rounded-lg transition-all flex items-center justify-center gap-1 shadow-3xs cursor-pointer"
                  >
                    <Plus className="w-3.5 h-3.5 text-sage-500" />
                    Add Volume slab bracket
                  </button>
                </div>
              </div>

              {/* Modal actions */}
              <div className="bg-earth-100 p-4 border-t border-earth-250 flex justify-end gap-2.5">
                <button
                  type="button"
                  onClick={() => setEditingProductSlabs(null)}
                  className="px-4 py-1.5 text-xs text-earth-700 font-semibold bg-white border border-earth-300 hover:bg-earth-50 rounded-lg transition-colors cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={handleSaveTempSlabs}
                  className="px-4 py-1.5 text-xs text-white bg-sage-500 hover:bg-sage-600 active:bg-sage-700 font-bold rounded-lg shadow-sm hover:shadow-md transition-all flex items-center gap-1.5 cursor-pointer"
                >
                  <Check className="w-3.5 h-3.5" />
                  Save & Compile Slabs
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}

        {addProductModalOpen && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/50 backdrop-blur-xs flex items-center justify-center p-4 z-50 print:hidden"
          >
            <motion.div
              initial={{ scale: 0.95, y: 15 }}
              animate={{ scale: 1, y: 0 }}
              exit={{ scale: 0.95, y: 15 }}
              className="bg-white rounded-xl shadow-xl max-w-xl w-full overflow-hidden border border-earth-200 flex flex-col max-h-[90vh]"
            >
              {/* Header */}
              <div className="bg-earth-100 p-4 border-b border-earth-250 flex items-center justify-between">
                <div>
                  <h3 className="text-sm font-bold text-earth-900 uppercase font-serif flex items-center gap-1.5">
                    <Plus className="w-4 h-4 text-sage-500" />
                    Create Custom Product
                  </h3>
                  <p className="text-[10px] text-earth-500 mt-0.5 leading-none">
                    Register a new product in the system database with custom pricing & volume slabs.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    setAddProductModalOpen(false);
                    setNewProdError('');
                  }}
                  className="p-1 rounded-lg hover:bg-earth-200 text-earth-400 hover:text-earth-600 transition-colors cursor-pointer"
                >
                  <Minus className="w-4 h-4" />
                </button>
              </div>

              {/* Body */}
              <div className="p-5 overflow-y-auto flex-1 flex flex-col gap-4">
                {newProdError && (
                  <div className="p-3 bg-rose-50 border border-rose-200 text-rose-800 rounded-lg text-xs flex items-center gap-2">
                    <AlertCircle className="w-4 h-4 shrink-0 text-rose-500" />
                    <span>{newProdError}</span>
                  </div>
                )}

                {/* 1st Product Group (Category) */}
                <div className="flex flex-col gap-1.5">
                  <label className="text-xs font-bold text-earth-700 flex items-center gap-1.5">
                    <span className="w-1.5 h-1.5 rounded-full bg-sage-500"></span>
                    1st Product Group (Category) *
                  </label>
                  <select
                    value={newProdCategory}
                    onChange={(e) => setNewProdCategory(e.target.value as ProductCategory)}
                    className="w-full bg-white border border-earth-300 py-2 px-3 text-xs rounded-lg outline-none text-earth-900 font-semibold cursor-pointer focus:border-sage-500 focus:ring-1 focus:ring-sage-500 shadow-3xs"
                  >
                    {CATEGORIES.filter(cat => cat !== 'All').map((cat) => (
                      <option key={cat} value={cat}>
                        {cat}
                      </option>
                    ))}
                  </select>
                </div>

                {/* 2nd Product Name & Product ID */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div className="flex flex-col gap-1.5">
                    <label className="text-xs font-bold text-earth-700 flex items-center gap-1.5">
                      <span className="w-1.5 h-1.5 rounded-full bg-sage-500"></span>
                      2nd Product Name *
                    </label>
                    <input
                      type="text"
                      required
                      placeholder="e.g. ULTRA GLIDE EPOXY"
                      value={newProdName}
                      onChange={(e) => handleNewProductNameChange(e.target.value)}
                      className="w-full bg-white border border-earth-300 py-2 px-3 text-xs rounded-lg outline-none text-earth-900 focus:border-sage-500 focus:ring-1 focus:ring-sage-500 uppercase tracking-wide font-serif shadow-3xs"
                    />
                  </div>

                  <div className="flex flex-col gap-1.5">
                    <label className="text-xs font-bold text-earth-700 flex items-center gap-1">
                      Product ID (Unique Key) *
                      <span className="text-[10px] font-normal text-earth-550 italic">(suggestions auto)</span>
                    </label>
                    <input
                      type="text"
                      required
                      placeholder="e.g. ultra-glide-epoxy-12"
                      value={newProdId}
                      onChange={(e) => setNewProdId(e.target.value)}
                      className="w-full bg-white border border-earth-300 py-2 px-3 text-xs font-mono rounded-lg outline-none text-earth-900 focus:border-sage-500 focus:ring-1 focus:ring-sage-500 shadow-3xs"
                    />
                  </div>
                </div>

                {/* 3rd SKU Packaging Details */}
                <div className="grid grid-cols-1 sm:grid-cols-4 gap-3 bg-earth-50/50 p-3.5 rounded-xl border border-earth-150">
                  <div className="sm:col-span-2 flex flex-col gap-1">
                    <label className="text-[10px] font-bold text-earth-600 uppercase tracking-wide flex items-center gap-1">
                      <span className="w-1 h-1 rounded-full bg-sage-500"></span>
                      3rd SKU Description *
                    </label>
                    <input
                      type="text"
                      placeholder="e.g. 20 kg Bag"
                      value={newProdSku}
                      onChange={(e) => setNewProdSku(e.target.value)}
                      className="w-full bg-white border border-earth-350 py-1.5 px-2 text-xs rounded-lg outline-none text-earth-900 focus:border-sage-500 shadow-3xs"
                    />
                  </div>

                  <div className="flex flex-col gap-1">
                    <label className="text-[10px] font-bold text-earth-600 uppercase tracking-wide">Size Value *</label>
                    <input
                      type="number"
                      step="any"
                      min="0.1"
                      placeholder="20"
                      value={newProdSkuWeight}
                      onChange={(e) => {
                        const val = parseFloat(e.target.value) || 0;
                        setNewProdSkuWeight(val);
                        // Update default suggestion ID suffix
                        const baseId = newProdId.replace(/-[0-9\.]+$/, '');
                        setNewProdId(baseId ? `${baseId}-${val}` : '');
                      }}
                      className="w-full bg-white border border-earth-350 py-1.5 px-2 text-xs font-mono rounded-lg outline-none text-earth-900 focus:border-sage-500 shadow-3xs"
                    />
                  </div>

                  <div className="flex flex-col gap-1">
                    <label className="text-[10px] font-bold text-earth-600 uppercase tracking-wide">Unit</label>
                    <select
                      value={newProdSkuUnit}
                      onChange={(e) => setNewProdSkuUnit(e.target.value as 'kg' | 'L')}
                      className="w-full bg-white border border-earth-350 py-1.5 px-2 text-xs rounded-lg outline-none text-earth-900 font-semibold cursor-pointer focus:border-sage-500 shadow-3xs"
                    >
                      <option value="kg">kg (Kilogram)</option>
                      <option value="L">L (Liter)</option>
                    </select>
                  </div>
                </div>

                {/* 4th Dealer Price & 5th Volume Discount Unit */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div className="flex flex-col gap-1.5">
                    <label className="text-xs font-bold text-earth-700 flex items-center gap-1.5">
                      <span className="w-1.5 h-1.5 rounded-full bg-sage-500"></span>
                      4th Dealer Price (INR) *
                    </label>
                    <div className="relative flex items-center">
                      <span className="absolute left-3 text-earth-450 font-bold">₹</span>
                      <input
                        type="number"
                        min="0"
                        placeholder="e.g. 500"
                        value={newProdDealerPrice}
                        onChange={(e) => setNewProdDealerPrice(parseFloat(e.target.value) || 0)}
                        className="w-full bg-white border border-earth-300 py-2 pl-7 pr-3 text-sm font-semibold rounded-lg outline-none text-earth-900 focus:border-sage-500 focus:ring-1 focus:ring-sage-500 shadow-3xs"
                      />
                    </div>
                  </div>

                  <div className="flex flex-col gap-1.5">
                    <label className="text-xs font-bold text-earth-700 flex items-center gap-1.5">
                      <span className="w-1.5 h-1.5 rounded-full bg-sage-500"></span>
                      5th Volume Discount Unit
                    </label>
                    <select
                      value={newProdDiscountUnit}
                      onChange={(e) => setNewProdDiscountUnit(e.target.value as any)}
                      className="w-full bg-white border border-earth-300 py-2 px-2 text-xs rounded-lg outline-none text-earth-900 font-semibold cursor-pointer focus:border-sage-500 focus:ring-1 focus:ring-sage-500 shadow-3xs"
                    >
                      <option value="none">No Volume Discount</option>
                      <option value="MT">MT (Metric Tons)</option>
                      <option value="kg">kg (Kilograms)</option>
                      <option value="L">L (Liters)</option>
                    </select>
                  </div>
                </div>

                {/* Slabs Section (conditional) */}
                {newProdDiscountUnit !== 'none' && (
                  <div className="flex flex-col gap-2.5 p-4 bg-sage-50/20 border border-sage-200/50 rounded-xl">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-bold text-earth-800 flex items-center gap-1.5">
                        <span className="w-1.5 h-1.5 rounded-full bg-sage-500"></span>
                        6th Volume Discount Slabs (Unit: {newProdDiscountUnit})
                      </span>
                      <button
                        type="button"
                        onClick={handleAddFormSlab}
                        className="text-[11px] font-bold text-sage-600 hover:text-sage-700 bg-white border border-sage-200 rounded px-2.5 py-1 flex items-center gap-1 shadow-3xs cursor-pointer hover:border-sage-400"
                      >
                        <Plus className="w-3 h-3 text-sage-500" />
                        Add Slab Row
                      </button>
                    </div>

                    <p className="text-[10px] text-earth-500 leading-normal">
                      Specify the minimum volume required to activate the discount percentage. Next min thresholds automatically cap the maximum thresholds.
                    </p>

                    <div className="flex flex-col gap-2">
                      <div className="grid grid-cols-12 gap-2 text-[9px] font-extrabold text-earth-550 uppercase tracking-wider px-1">
                        <div className="col-span-5">Min Volume ({newProdDiscountUnit})</div>
                        <div className="col-span-5">Discount Percent %</div>
                        <div className="col-span-2 text-center">Delete</div>
                      </div>

                      <div className="flex flex-col gap-2 max-h-[160px] overflow-y-auto pr-1">
                        {newProdSlabs.map((slab, idx) => (
                          <div key={idx} className="grid grid-cols-12 gap-2 items-center">
                            <div className="col-span-5 relative flex items-center">
                              <input
                                type="number"
                                step="any"
                                min="0"
                                placeholder="e.g. 5.0"
                                value={slab.min}
                                onChange={(e) => handleFormSlabChange(idx, 'min', parseFloat(e.target.value) || 0)}
                                className="w-full bg-white border border-earth-250 py-1 px-2 text-xs font-mono rounded outline-none focus:border-sage-500 text-earth-900"
                              />
                            </div>
                            <div className="col-span-5 relative flex items-center">
                              <input
                                type="number"
                                min="0"
                                max="100"
                                placeholder="10"
                                value={slab.discountPercent}
                                onChange={(e) => handleFormSlabChange(idx, 'discountPercent', parseFloat(e.target.value) || 0)}
                                className="w-full bg-white border border-earth-250 py-1 pl-2 pr-6 text-xs font-mono rounded outline-none focus:border-sage-500 text-earth-900 focus:ring-1 focus:ring-sage-500"
                              />
                              <span className="absolute right-2 text-earth-450 font-bold font-mono text-[11px]">%</span>
                            </div>
                            <div className="col-span-2 flex justify-center">
                              <button
                                type="button"
                                onClick={() => handleRemoveFormSlab(idx)}
                                className="p-1 text-rose-500 hover:text-rose-700 hover:bg-rose-50 rounded transition-colors cursor-pointer"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            </div>
                          </div>
                        ))}
                      </div>

                      {newProdSlabs.length === 0 && (
                        <div className="text-center py-4 bg-white rounded-lg border border-dashed border-earth-200 text-xs italic text-earth-450">
                          No initial slabs defined. Click "Add Slab Row" or adjust directly from grid later.
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </div>

              {/* Actions footer */}
              <div className="bg-earth-100 p-4 border-t border-earth-250 flex justify-end gap-2.5">
                <button
                  type="button"
                  onClick={() => {
                    setAddProductModalOpen(false);
                    setNewProdError('');
                  }}
                  className="px-4 py-1.5 text-xs text-earth-700 font-semibold bg-white border border-earth-300 hover:bg-earth-50 rounded-lg transition-colors cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={handleSaveNewProduct}
                  className="px-4 py-1.5 text-xs text-white bg-sage-500 hover:bg-sage-600 active:bg-sage-700 font-bold rounded-lg shadow-sm hover:shadow-md transition-all flex items-center gap-1.5 cursor-pointer uppercase tracking-wider"
                >
                  <Check className="w-3.5 h-3.5" />
                  Save & Add Product
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}

        {isShareModalOpen && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4 z-50 print:hidden"
          >
            <motion.div
              initial={{ scale: 0.95, y: 15 }}
              animate={{ scale: 1, y: 0 }}
              exit={{ scale: 0.95, y: 15 }}
              className="bg-white rounded-2xl shadow-xl max-w-2xl w-full overflow-hidden border border-earth-200 flex flex-col max-h-[90vh]"
            >
              {/* Header */}
              <div className="bg-earth-100 p-4 border-b border-earth-250 flex items-center justify-between">
                <div>
                  <h3 className="text-sm font-bold text-earth-900 uppercase font-serif flex items-center gap-1.5">
                    <Camera className="w-4 h-4 text-sage-500" />
                    Share Profit Estimation Screenshot
                  </h3>
                  <p className="text-[10px] text-earth-500 mt-0.5 leading-none">
                    Image version of the commercial estimation sheet is generated. You can download or share it below.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setIsShareModalOpen(false)}
                  className="p-1 rounded-lg hover:bg-earth-200 text-earth-400 hover:text-earth-600 transition-colors cursor-pointer"
                >
                  <Minus className="w-4 h-4" />
                </button>
              </div>

              {/* Body */}
              <div className="p-6 overflow-y-auto flex-1 flex flex-col gap-5 items-center justify-center bg-earth-50/30">
                {isCapturing ? (
                  <div className="flex flex-col items-center justify-center py-12 gap-3">
                    <div className="w-10 h-10 border-4 border-sage-500/20 border-t-sage-500 rounded-full animate-spin" />
                    <p className="text-xs font-semibold text-earth-600 font-mono animate-pulse">Generating high-fidelity screenshot...</p>
                  </div>
                ) : screenshotDataUrl ? (
                  <div className="flex flex-col gap-4 items-center w-full">
                    {/* Visual Preview */}
                    <div className="border border-earth-200 rounded-xl overflow-hidden shadow-md max-h-[50vh] overflow-y-auto w-full bg-white select-none">
                      <img 
                        src={screenshotDataUrl} 
                        alt="Hardwork Profit estimation" 
                        referrerPolicy="no-referrer"
                        className="w-full h-auto object-contain"
                      />
                    </div>

                    <p className="text-[10.5px] text-earth-500 font-medium text-center max-w-md">
                      The estimation document heading has been set to <strong className="text-earth-800">Hardwork Profit estimation</strong>. If Web Share is unsupported by your browser or sandbox configuration, please use the clipboard copy or download buttons.
                    </p>
                  </div>
                ) : (
                  <div className="text-center py-8 text-xs text-rose-500">
                    Failed to generate image. Please try again.
                  </div>
                )}
              </div>

              {/* Actions footer */}
              <div className="bg-earth-100 p-4 border-t border-earth-250 flex flex-wrap gap-2 justify-end">
                <button
                  type="button"
                  onClick={() => setIsShareModalOpen(false)}
                  className="px-4 py-1.5 text-xs text-earth-700 font-semibold bg-white border border-earth-300 hover:bg-earth-50 rounded-lg transition-colors cursor-pointer"
                >
                  Close
                </button>

                {screenshotDataUrl && (
                  <>
                    <button
                      type="button"
                      onClick={async () => {
                        try {
                          const response = await fetch(screenshotDataUrl);
                          const blob = await response.blob();
                          const item = new ClipboardItem({ [blob.type]: blob });
                          await navigator.clipboard.write([item]);
                          alert("📋 Image successfully copied to clipboard! You can paste/send it anywhere.");
                        } catch (err) {
                          console.error("Clipboard write blocked:", err);
                          alert("Clipboard copy is blocked by browser restrictions. Please click 'Download Image' instead.");
                        }
                      }}
                      className="px-4 py-1.5 text-xs text-earth-800 font-bold bg-white border border-earth-300 hover:bg-earth-50 rounded-lg shadow-2xs transition-all flex items-center gap-1.5 cursor-pointer"
                    >
                      <Copy className="w-3.5 h-3.5" />
                      Copy to Clipboard
                    </button>

                    <button
                      type="button"
                      onClick={() => {
                        const link = document.createElement('a');
                        link.href = screenshotDataUrl;
                        link.download = `Hardwork_Profit_Estimation_${new Date().toISOString().substring(0, 10)}.png`;
                        document.body.appendChild(link);
                        link.click();
                        document.body.removeChild(link);
                      }}
                      className="px-4 py-1.5 text-xs text-white bg-earth-700 hover:bg-earth-800 font-bold rounded-lg shadow-xs transition-all flex items-center gap-1.5 cursor-pointer"
                    >
                      <Download className="w-3.5 h-3.5" />
                      Download Image
                    </button>

                    <button
                      type="button"
                      onClick={async () => {
                        try {
                          const response = await fetch(screenshotDataUrl);
                          const blob = await response.blob();
                          const file = new File([blob], `Hardwork_Profit_Estimation_${new Date().toISOString().substring(0, 10)}.png`, { type: blob.type });
                          if (navigator.canShare && navigator.canShare({ files: [file] })) {
                            await navigator.share({
                              files: [file],
                              title: 'Hardwork Profit estimation',
                              text: 'Please review our commercial profit estimation statement.'
                            });
                          } else {
                            alert("Sharing of files is not natively supported in this browser environment. Please use 'Download' or 'Copy' instead.");
                          }
                        } catch (err) {
                          console.warn("Share API error:", err);
                          alert("Web Sharing API is disabled or blocked in this workspace preview. Please use 'Download Image' or 'Copy to Clipboard'.");
                        }
                      }}
                      className="px-4 py-1.5 text-xs text-white bg-sage-500 hover:bg-sage-600 active:bg-sage-700 font-bold rounded-lg shadow-xs transition-all flex items-center gap-1.5 cursor-pointer uppercase tracking-wider"
                    >
                      <Share2 className="w-3.5 h-3.5" />
                      Share Screenshot
                    </button>
                  </>
                )}
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Hidden Screenshot Document Container for html2canvas */}
      <div className="absolute left-[-9999px] top-[-9999px] print:hidden">
        <div 
          id="hardwork-profit-estimation-document" 
          className="w-[800px] p-8 font-sans flex flex-col gap-6"
          style={{ backgroundColor: '#ffffff', color: '#4a443f' }}
        >
          {/* Header Block */}
          <div 
            className="rounded-xl p-6 flex flex-col gap-4 shadow-sm border"
            style={{ backgroundColor: '#7a816c', color: '#ffffff', borderColor: '#676d5b' }}
          >
            <div className="flex justify-between items-start">
              <div>
                <h1 className="text-2xl font-bold tracking-tight font-serif" style={{ color: '#ffffff' }}>Hardwork Profit estimation</h1>
                <p className="text-[11px] font-mono mt-1 opacity-90 uppercase tracking-wider" style={{ color: '#ebede7' }}>
                  Order Commercial Proposal Statement
                </p>
              </div>
              <div className="text-right">
                <p className="text-xs font-mono" style={{ color: '#ebede7' }}>
                  Date: {new Date().toLocaleDateString('en-IN')}
                </p>
                <p className="text-[10px] font-mono mt-0.5" style={{ color: 'rgba(235, 237, 231, 0.8)' }}>
                  Time: {new Date().toLocaleTimeString('en-IN')}
                </p>
              </div>
            </div>
            <div 
              className="border-t pt-3 flex flex-wrap gap-x-6 gap-y-1 text-xs font-medium"
              style={{ borderColor: 'rgba(255, 255, 255, 0.1)', color: 'rgba(235, 237, 231, 0.9)' }}
            >
              <span>CD Period: <strong className="font-mono" style={{ color: '#ffffff' }}>{settings.cdPeriod} days</strong></span>
              <span>Quarterly Growth Goal: <strong className="font-mono" style={{ color: '#ffffff' }}>{settings.growthRate}</strong></span>
              <span>Global Annual Discount: <strong className="font-mono" style={{ color: '#ffffff' }}>{settings.adPercent}%</strong></span>
            </div>
          </div>

          {/* Metrics Summary Index Grid */}
          <div>
            <h3 className="text-xs font-bold font-mono uppercase tracking-wider mb-2.5" style={{ color: '#8c847c' }}>
              Commercial Summary Index
            </h3>
            <div className="grid grid-cols-4 gap-3">
              <div 
                className="rounded-lg p-3.5 flex flex-col gap-1 border"
                style={{ backgroundColor: 'rgba(253, 252, 251, 0.6)', borderColor: '#f5f2ed' }}
              >
                <span className="text-[9px] uppercase font-bold tracking-wider" style={{ color: '#8c847c' }}>Dealer's Monthly Turnover</span>
                <span className="text-base font-bold font-mono" style={{ color: '#2d2a26' }}>
                  ₹{summary.totalRevenue.toLocaleString('en-IN', { maximumFractionDigits: 0 })}
                </span>
              </div>
              <div 
                className="rounded-lg p-3.5 flex flex-col gap-1 border"
                style={{ backgroundColor: 'rgba(253, 252, 251, 0.6)', borderColor: '#f5f2ed' }}
              >
                <span className="text-[9px] uppercase font-bold tracking-wider" style={{ color: '#8c847c' }}>Net Procurement Cost</span>
                <span className="text-base font-bold font-mono" style={{ color: '#2d2a26' }}>
                  ₹{summary.totalCost.toLocaleString('en-IN', { maximumFractionDigits: 0 })}
                </span>
              </div>
              <div 
                className="rounded-lg p-3.5 flex flex-col gap-1 border"
                style={{ backgroundColor: 'rgba(246, 247, 244, 0.7)', borderColor: '#ebede7' }}
              >
                <span className="text-[9px] uppercase font-bold tracking-wider" style={{ color: '#7a816c' }}>Retained Profit Margin</span>
                <span className="text-base font-bold font-mono" style={{ color: '#676d5b' }}>
                  ₹{summary.totalProfit.toLocaleString('en-IN', { maximumFractionDigits: 0 })}
                </span>
              </div>
              <div 
                className="rounded-lg p-3.5 flex flex-col gap-1 border"
                style={{ backgroundColor: 'rgba(246, 247, 244, 0.7)', borderColor: '#ebede7' }}
              >
                <span className="text-[9px] uppercase font-bold tracking-wider" style={{ color: '#7a816c' }}>Profit Percentage</span>
                <span className="text-base font-bold font-mono" style={{ color: '#676d5b' }}>
                  {summary.averageMarginPercent.toFixed(2)}%
                </span>
              </div>
            </div>
          </div>

          {/* Product Wise Analysis Table */}
          <div>
            <h3 className="text-xs font-bold font-mono uppercase tracking-wider mb-2.5" style={{ color: '#8c847c' }}>
              Product-wise Analysis Table
            </h3>
            <div className="rounded-xl overflow-hidden border shadow-2xs" style={{ borderColor: '#e5e0d8' }}>
              <table className="w-full text-left text-xs border-collapse">
                <thead>
                  <tr className="font-bold border-b" style={{ backgroundColor: 'rgba(245, 242, 237, 0.6)', borderColor: '#e5e0d8', color: '#4a443f' }}>
                    <th className="py-2.5 px-3">Product Profile / SKU</th>
                    <th className="py-2.5 px-3 text-center">Bags</th>
                    <th className="py-2.5 px-3 text-right">Dealer Price</th>
                    <th className="py-2.5 px-3 text-right">Selling Rate</th>
                    <th className="py-2.5 px-3 text-right">Total Gross</th>
                    <th className="py-2.5 px-3 text-right">Post-Disc NP</th>
                    <th className="py-2.5 px-3 text-right">Net Cost</th>
                    <th className="py-2.5 px-3 text-right">Net Profit</th>
                    <th className="py-2.5 px-3 text-right">Profit %</th>
                  </tr>
                </thead>
                <tbody style={{ color: '#4a443f' }}>
                  {activeCalculations.filter(calc => calc.quantity > 0).map((calc, idx) => {
                    const grossAmount = calc.quantity * calc.dealerPrice;
                    return (
                      <tr 
                        key={calc.product.id || idx} 
                        className="font-medium border-b last:border-b-0"
                        style={{ borderColor: '#f5f2ed' }}
                      >
                        <td className="py-2.5 px-3">
                          <div className="font-bold" style={{ color: '#2d2a26' }}>{calc.product.name}</div>
                          <div className="text-[10px] font-mono mt-0.5" style={{ color: '#8c847c' }}>{calc.product.sku}</div>
                        </td>
                        <td className="py-2.5 px-3 text-center font-bold font-mono" style={{ color: '#2d2a26' }}>{calc.quantity}</td>
                        <td className="py-2.5 px-3 text-right font-mono" style={{ color: '#706961' }}>
                          ₹{calc.dealerPrice.toLocaleString('en-IN', { maximumFractionDigits: 0 })}
                        </td>
                        <td className="py-2.5 px-3 text-right font-mono font-bold" style={{ color: '#7a816c' }}>
                          ₹{calc.sellingPrice.toLocaleString('en-IN', { maximumFractionDigits: 0 })}
                        </td>
                        <td className="py-2.5 px-3 text-right font-mono" style={{ color: '#706961' }}>
                          ₹{grossAmount.toLocaleString('en-IN', { maximumFractionDigits: 0 })}
                        </td>
                        <td className="py-2.5 px-3 text-right font-mono" style={{ color: '#706961' }}>
                          ₹{calc.purchaseUnitPrice.toLocaleString('en-IN', { maximumFractionDigits: 0 })}
                        </td>
                        <td className="py-2.5 px-3 text-right font-mono font-semibold" style={{ color: '#2d2a26' }}>
                          ₹{calc.totalCost.toLocaleString('en-IN', { maximumFractionDigits: 0 })}
                        </td>
                        <td className="py-2.5 px-3 text-right font-mono font-bold" style={{ color: calc.totalProfit >= 0 ? '#047857' : '#be123c' }}>
                          ₹{calc.totalProfit.toLocaleString('en-IN', { maximumFractionDigits: 0 })}
                        </td>
                        <td 
                          className="py-2.5 px-3 text-right font-mono font-bold" 
                          style={{ color: calc.profitMarginPercent >= 0 ? '#047857' : '#be123c' }}
                        >
                          {calc.profitMarginPercent.toFixed(1)}%
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>

          {/* Footer Stamp / Notice */}
          <div 
            className="mt-4 border-t pt-4 flex justify-between items-center text-[10px] font-mono"
            style={{ borderColor: '#e5e0d8', color: '#a8a29a' }}
          >
            <span>Hardworker Commercial Profit Simulator • Private & Confidential</span>
            <span>Generated on {new Date().toLocaleDateString('en-IN')}</span>
          </div>
        </div>
      </div>

      {/* FOOTER */}
      <footer className="bg-white border-t border-earth-200 text-center py-5 text-xs text-earth-500 mt-auto shrink-0 print:hidden">
        <p>© {new Date().getFullYear()} Hardworker Dealer Dashboard • Naturally Crafted Margin Sheet. All advisor metrics calculated instantly.</p>
      </footer>
    </div>
  );
}
