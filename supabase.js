/**
 * MOND — Supabase client and storage sync layer
 */

const SUPABASE_CONFIG_KEY = 'mond_supabase_config_v1';
const LOCAL_PRODUCTS_KEY = 'mond_products_v1';
const LOCAL_ORDERS_KEY = 'mond_orders_v1';
const LOCAL_CUSTOMERS_KEY = 'mond_customers_v1';

// Credentials
const SUPABASE_URL = 'https://ocqinkvoghqgjbzrvkje.supabase.co';
const SUPABASE_KEY = 'sb_publishable_vpGVeaT0V5QlnZQ5g5Bkjg_hnTUfEPU';

const DEFAULT_SUPABASE_CONFIG = {
  url: SUPABASE_URL,
  anonKey: SUPABASE_KEY
};

function normalizeSupabaseUrl(rawUrl) {
  if (!rawUrl) return SUPABASE_URL;
  let clean = rawUrl.trim();
  clean = clean.replace(/\/rest\/v1\/?$/, '');
  clean = clean.replace(/\/+$/, '');
  return clean || SUPABASE_URL;
}

function getSupabaseConfig() {
  try {
    const saved = localStorage.getItem(SUPABASE_CONFIG_KEY);
    if (saved) {
      const parsed = JSON.parse(saved);
      if (parsed.url && parsed.url.includes('supabase.co') && !parsed.url.includes('xyzcompany')) {
        return {
          url: normalizeSupabaseUrl(parsed.url),
          anonKey: parsed.anonKey || DEFAULT_SUPABASE_CONFIG.anonKey
        };
      }
    }
  } catch (e) {}
  return DEFAULT_SUPABASE_CONFIG;
}

function isSupabaseConfigured() {
  const cfg = getSupabaseConfig();
  return Boolean(cfg.url && cfg.anonKey && cfg.url.startsWith('https://'));
}

// Client instance
let _supabaseClient = null;

function getSupabaseClient() {
  if (_supabaseClient) return _supabaseClient;
  const config = getSupabaseConfig();
  const sbLib = (typeof window !== 'undefined' && window.supabase) || (typeof supabase !== 'undefined' ? supabase : null);
  
  if (sbLib && sbLib.createClient && isSupabaseConfigured()) {
    try {
      _supabaseClient = sbLib.createClient(config.url, config.anonKey, {
        auth: { persistSession: false },
        realtime: { params: { eventsPerSecond: 10 } }
      });
      return _supabaseClient;
    } catch (err) {
      console.warn('Supabase client initialization notice:', err);
    }
  }
  return null;
}

function setSupabaseConfig(url, anonKey) {
  const cleanUrl = normalizeSupabaseUrl(url);
  const config = { url: cleanUrl, anonKey: anonKey.trim() };
  localStorage.setItem(SUPABASE_CONFIG_KEY, JSON.stringify(config));
  _supabaseClient = null;
  return getSupabaseClient();
}

// Products

const LEGACY_IMG_MAP = {
  'items/1.png': 'items/adee3ca2-7e4d-4b58-b088-80c84a62d729.JPG',
  'items/2.png': 'items/d755243f-03e3-4c35-851c-ac3dd978e7d4.JPG',
  'items/3.png': 'items/dc40686c-4a98-45fc-a82b-0dad0c78b08d.JPG',
  'items/4.png': 'items/da39d9fc-b0aa-42b3-a808-1d5923b35ebd.JPG'
};
const DEFAULT_FALLBACK_IMG = 'items/adee3ca2-7e4d-4b58-b088-80c84a62d729.JPG';

function mapFromDbProduct(row) {
  const p50 = Number(row.price_50) || 150;
  const p100 = Number(row.price_100) || 220;
  const rawImg = row.img || DEFAULT_FALLBACK_IMG;
  const resolvedImg = LEGACY_IMG_MAP[rawImg] || rawImg;
  const rawTag = row.tag || 'Signature';
  const categories = Array.isArray(row.categories)
    ? row.categories
    : rawTag.split(',').map(s => s.trim()).filter(Boolean);

  return {
    id: row.id,
    name: row.name,
    concentration: row.concentration || 'Extrait de Parfum',
    tag: rawTag,
    categories: categories,
    price50: p50,
    price100: p100,
    prices: { 50: p50, 100: p100 },
    inStock: row.in_stock !== false,
    img: resolvedImg,
    fallback: DEFAULT_FALLBACK_IMG,
    pyramid: {
      top: row.top_notes || '',
      heart: row.heart_notes || '',
      base: row.base_notes || ''
    },
    description: row.description || '',
    desc: row.description || '',
    updatedAt: row.updated_at
  };
}

function mapToDbProduct(item) {
  const p50 = item.prices?.[50] ?? item.price_50 ?? item.price50 ?? 150;
  const p100 = item.prices?.[100] ?? item.price_100 ?? item.price100 ?? 220;
  const rawImg = item.img || DEFAULT_FALLBACK_IMG;
  const tagVal = item.tag || (Array.isArray(item.categories) ? item.categories.join(', ') : 'Signature');

  return {
    id: item.id,
    name: item.name,
    concentration: item.concentration || 'Extrait de Parfum',
    tag: tagVal,
    price_50: Number(p50),
    price_100: Number(p100),
    in_stock: item.inStock !== false,
    img: LEGACY_IMG_MAP[rawImg] || rawImg,
    top_notes: item.pyramid?.top || '',
    heart_notes: item.pyramid?.heart || '',
    base_notes: item.pyramid?.base || '',
    description: item.description || item.desc || '',
    updated_at: new Date().toISOString()
  };
}

async function mondFetchProducts() {
  const cfg = getSupabaseConfig();
  // Direct REST fetch
  try {
    const res = await fetch(`${cfg.url}/rest/v1/products?select=*&order=created_at.asc`, {
      method: 'GET',
      headers: {
        'apikey': cfg.anonKey,
        'Authorization': `Bearer ${cfg.anonKey}`,
        'Content-Type': 'application/json'
      }
    });
    if (res.ok) {
      const rows = await res.json();
      if (Array.isArray(rows) && rows.length > 0) {
        const mapped = rows.map(mapFromDbProduct);
        localStorage.setItem(LOCAL_PRODUCTS_KEY, JSON.stringify(mapped));
        return mapped;
      }
    }
  } catch (e) {
    console.warn('REST products fetch failed, using local fallback:', e);
  }

  // Fallback to local cache
  try {
    const raw = localStorage.getItem(LOCAL_PRODUCTS_KEY);
    if (raw) return JSON.parse(raw);
  } catch (e) {}

  return null;
}

async function mondSaveProduct(product) {
  const cfg = getSupabaseConfig();
  const dbPayload = mapToDbProduct(product);

  // Local write
  try {
    let local = JSON.parse(localStorage.getItem(LOCAL_PRODUCTS_KEY) || '[]');
    const idx = local.findIndex(p => p.id === product.id);
    if (idx >= 0) local[idx] = product;
    else local.push(product);
    localStorage.setItem(LOCAL_PRODUCTS_KEY, JSON.stringify(local));
    localStorage.setItem('mond_products_updated', Date.now().toString());
    window.dispatchEvent(new Event('storage'));
  } catch (e) {}

  // Cloud write (Upsert)
  try {
    const res = await fetch(`${cfg.url}/rest/v1/products`, {
      method: 'POST',
      headers: {
        'apikey': cfg.anonKey,
        'Authorization': `Bearer ${cfg.anonKey}`,
        'Content-Type': 'application/json',
        'Prefer': 'resolution=merge-duplicates,return=representation'
      },
      body: JSON.stringify(dbPayload)
    });
    if (res.ok) {
      const data = await res.json();
      return { success: true, data };
    }
  } catch (err) {
    console.error('Supabase product save error:', err);
  }

  return { success: true, locallySaved: true };
}

async function mondSyncCatalog(productsArray) {
  if (!Array.isArray(productsArray)) return { success: false };
  const cfg = getSupabaseConfig();

  // Save to local cache
  try {
    localStorage.setItem(LOCAL_PRODUCTS_KEY, JSON.stringify(productsArray));
    localStorage.setItem('mond_products_updated', Date.now().toString());
    window.dispatchEvent(new Event('storage'));
  } catch (e) {}

  // Sync catalog to remote
  try {
    // Fetch existing cloud IDs to detect deletions
    const existingRes = await fetch(`${cfg.url}/rest/v1/products?select=id`, {
      method: 'GET',
      headers: {
        'apikey': cfg.anonKey,
        'Authorization': `Bearer ${cfg.anonKey}`
      }
    });
    if (existingRes.ok) {
      const existingRows = await existingRes.json();
      const newIds = new Set(productsArray.map(p => p.id));
      const toDelete = existingRows.filter(r => !newIds.has(r.id)).map(r => r.id);
      for (const delId of toDelete) {
        await fetch(`${cfg.url}/rest/v1/products?id=eq.${encodeURIComponent(delId)}`, {
          method: 'DELETE',
          headers: {
            'apikey': cfg.anonKey,
            'Authorization': `Bearer ${cfg.anonKey}`
          }
        });
      }
    }

    if (productsArray.length > 0) {
      const dbPayloads = productsArray.map(mapToDbProduct);
      const res = await fetch(`${cfg.url}/rest/v1/products`, {
        method: 'POST',
        headers: {
          'apikey': cfg.anonKey,
          'Authorization': `Bearer ${cfg.anonKey}`,
          'Content-Type': 'application/json',
          'Prefer': 'resolution=merge-duplicates,return=representation'
        },
        body: JSON.stringify(dbPayloads)
      });
      if (res.ok) {
        return { success: true };
      }
    }
    return { success: true };
  } catch (err) {
    console.error('Supabase catalog sync error:', err);
    return { success: false, locallySaved: true };
  }
}

async function mondDeleteProduct(productId) {
  const cfg = getSupabaseConfig();

  try {
    let local = JSON.parse(localStorage.getItem(LOCAL_PRODUCTS_KEY) || '[]');
    local = local.filter(p => p.id !== productId);
    localStorage.setItem(LOCAL_PRODUCTS_KEY, JSON.stringify(local));
    localStorage.setItem('mond_products_updated', Date.now().toString());
    window.dispatchEvent(new Event('storage'));
  } catch (e) {}

  try {
    await fetch(`${cfg.url}/rest/v1/products?id=eq.${encodeURIComponent(productId)}`, {
      method: 'DELETE',
      headers: {
        'apikey': cfg.anonKey,
        'Authorization': `Bearer ${cfg.anonKey}`
      }
    });
    return { success: true };
  } catch (err) {
    return { success: false, error: err };
  }
}

function mondSubscribeProducts(onInsertOrUpdate, onDelete) {
  const client = getSupabaseClient();
  if (!client) return null;
  try {
    return client
      .channel('products-realtime')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'products' }, (payload) => {
        if (payload.eventType === 'DELETE') {
          const delId = payload.old?.id;
          if (delId) {
            try {
              let local = JSON.parse(localStorage.getItem(LOCAL_PRODUCTS_KEY) || '[]');
              local = local.filter(p => p.id !== delId);
              localStorage.setItem(LOCAL_PRODUCTS_KEY, JSON.stringify(local));
            } catch (e) {}
          }
          if (onDelete) onDelete(delId);
        } else if (payload.new) {
          const mapped = mapFromDbProduct(payload.new);
          try {
            let local = JSON.parse(localStorage.getItem(LOCAL_PRODUCTS_KEY) || '[]');
            const idx = local.findIndex(p => p.id === mapped.id);
            if (idx >= 0) local[idx] = mapped;
            else local.push(mapped);
            localStorage.setItem(LOCAL_PRODUCTS_KEY, JSON.stringify(local));
          } catch (e) {}
          if (onInsertOrUpdate) onInsertOrUpdate(mapped, payload.eventType);
        }
      })
      .subscribe();
  } catch (e) {
    return null;
  }
}

// Orders & Customers

async function mondCreateOrder(orderData) {
  const cfg = getSupabaseConfig();

  // Normalize all field aliases (both camelCase, snake_case, and nested client)
  const clientName = (
    orderData.full_name ||
    orderData.fullName ||
    orderData.client_name ||
    orderData.client?.name ||
    orderData.name ||
    'Patron'
  ).trim();

  const clientEmail = (
    orderData.email ||
    orderData.client_email ||
    orderData.client?.email ||
    'patron@mond.com'
  ).trim();

  const clientPhone = (
    orderData.phone_number ||
    orderData.phone ||
    orderData.phoneNumber ||
    orderData.client_phone ||
    orderData.client?.phone ||
    '+20 100 000 0000'
  ).trim();

  const street = orderData.street || orderData.address || orderData.client?.address || '';
  const city = (orderData.city || orderData.client?.city || 'Cairo').trim();
  const postalCode = (orderData.postalCode || orderData.postal_code || orderData.client?.postalCode || '11835').trim();

  let shippingAddr = (orderData.shipping_address || orderData.client?.shipping_address || '').trim();
  if (!shippingAddr) {
    shippingAddr = [street, city, postalCode].filter(Boolean).join(', ') || 'Bespoke Dispatch Sanctuary';
  }

  const ref = orderData.order_ref || orderData.ref || ('MND-' + Math.floor(10000 + Math.random() * 90000));
  let itemsArr = orderData.items || [];
  if (typeof itemsArr === 'string') {
    try { itemsArr = JSON.parse(itemsArr); } catch(e) { itemsArr = []; }
  }
  if (!Array.isArray(itemsArr) || itemsArr.length === 0) {
    try {
      const storedCart = JSON.parse(localStorage.getItem('mond_cart_v1') || localStorage.getItem('mond_cart') || '[]');
      if (Array.isArray(storedCart) && storedCart.length > 0) {
        itemsArr = storedCart;
      }
    } catch (e) {}
  }

  // Ensure each item has clean numeric qty, size, and price
  itemsArr = (Array.isArray(itemsArr) ? itemsArr : []).map(item => ({
    id: item.id || 'fragrance',
    name: item.name || 'Signature Flacon',
    size: Number(item.size) || 100,
    price: Number(item.price) || 0,
    qty: Number(item.qty) || 1,
    img: item.img || 'items/1.png'
  }));

  const calculatedTotal = itemsArr.reduce((sum, item) => sum + (item.price * item.qty), 0);
  const totalVal = calculatedTotal > 0
    ? calculatedTotal
    : (Number(String(orderData.total || orderData.total_amount || 0).replace(/[^0-9.]/g, '')) || 0);

  const dbOrder = {
    order_ref: ref,
    client_name: clientName,
    full_name: clientName,
    client_email: clientEmail,
    email: clientEmail,
    client_phone: clientPhone,
    phone_number: clientPhone,
    shipping_address: shippingAddr,
    city: city,
    postal_code: postalCode,
    notes: orderData.notes || orderData.client?.notes || 'Nocturnal Bespoke Courier',
    payment_method: orderData.payment_method || orderData.paymentMethod || orderData.client?.payment || 'cod',
    status: 'pending',
    total_amount: totalVal,
    items: itemsArr
  };

  // Save to local storage
  try {
    const local = JSON.parse(localStorage.getItem(LOCAL_ORDERS_KEY) || '[]');
    // Prepend new order if not already present
    const existingIdx = local.findIndex(o => o.order_ref === ref || o.ref === ref);
    const orderRecord = {
      ...dbOrder,
      id: ref,
      date: new Date().toISOString(),
      created_at: new Date().toISOString()
    };
    if (existingIdx >= 0) {
      local[existingIdx] = orderRecord;
    } else {
      local.unshift(orderRecord);
    }
    localStorage.setItem(LOCAL_ORDERS_KEY, JSON.stringify(local));
    localStorage.setItem('mond_orders_updated', Date.now().toString());
    window.dispatchEvent(new Event('storage'));
  } catch (e) {
    console.warn('Local storage write notice:', e);
  }

  // Remote POST
  try {
    const res = await fetch(`${cfg.url}/rest/v1/orders`, {
      method: 'POST',
      headers: {
        'apikey': cfg.anonKey,
        'Authorization': `Bearer ${cfg.anonKey}`,
        'Content-Type': 'application/json',
        'Prefer': 'return=representation'
      },
      body: JSON.stringify(dbOrder)
    });

    if (res.ok) {
      const data = await res.json();
      console.log('✓ Order committed to Supabase Cloud:', data);
      return { success: true, data: data[0] };
    } else {
      const errBody = await res.text();
      console.error('Supabase HTTP Error:', res.status, errBody);
      return { success: false, error: errBody, locallySaved: true };
    }
  } catch (fetchErr) {
    console.error('Network dispatch exception:', fetchErr);
    return { success: false, error: fetchErr, locallySaved: true };
  }
}

async function mondFetchOrders() {
  const cfg = getSupabaseConfig();

  // Direct REST fetch
  try {
    const res = await fetch(`${cfg.url}/rest/v1/orders?select=*&order=created_at.desc`, {
      method: 'GET',
      headers: {
        'apikey': cfg.anonKey,
        'Authorization': `Bearer ${cfg.anonKey}`,
        'Content-Type': 'application/json'
      }
    });

    if (res.ok) {
      const cloudOrders = await res.json();
      if (Array.isArray(cloudOrders)) {
        localStorage.setItem(LOCAL_ORDERS_KEY, JSON.stringify(cloudOrders));
        return cloudOrders;
      }
    }
  } catch (err) {
    console.warn('REST orders fetch error:', err);
  }

  // Fallback to local cache
  try {
    const local = JSON.parse(localStorage.getItem(LOCAL_ORDERS_KEY) || '[]');
    return local;
  } catch (e) {
    return [];
  }
}

async function mondUpdateOrderStatus(orderIdOrRef, newStatus) {
  const cfg = getSupabaseConfig();

  // Update local storage
  try {
    let local = JSON.parse(localStorage.getItem(LOCAL_ORDERS_KEY) || '[]');
    local = local.map(o => {
      if (o.id === orderIdOrRef || o.order_ref === orderIdOrRef || o.ref === orderIdOrRef) {
        return { ...o, status: newStatus };
      }
      return o;
    });
    localStorage.setItem(LOCAL_ORDERS_KEY, JSON.stringify(local));
    localStorage.setItem('mond_orders_updated', Date.now().toString());
    window.dispatchEvent(new Event('storage'));
  } catch (e) {}

  // Update cloud
  try {
    await fetch(`${cfg.url}/rest/v1/orders?order_ref=eq.${encodeURIComponent(orderIdOrRef)}`, {
      method: 'PATCH',
      headers: {
        'apikey': cfg.anonKey,
        'Authorization': `Bearer ${cfg.anonKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ status: newStatus, updated_at: new Date().toISOString() })
    });
    return { success: true };
  } catch (err) {
    return { success: false, error: err };
  }
}

function mondSubscribeOrders(onNewOrder, onUpdateOrder) {
  const client = getSupabaseClient();
  if (!client) return null;
  try {
    return client
      .channel('orders-realtime')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'orders' }, (payload) => {
        if (payload.eventType === 'INSERT') {
          if (onNewOrder) onNewOrder(payload.new);
        } else if (payload.eventType === 'UPDATE') {
          if (onUpdateOrder) onUpdateOrder(payload.new);
        }
      })
      .subscribe();
  } catch (err) {
    return null;
  }
}

async function mondFetchCustomers() {
  const cfg = getSupabaseConfig();
  try {
    const res = await fetch(`${cfg.url}/rest/v1/customers?select=*&order=last_order_at.desc`, {
      method: 'GET',
      headers: {
        'apikey': cfg.anonKey,
        'Authorization': `Bearer ${cfg.anonKey}`,
        'Content-Type': 'application/json'
      }
    });
    if (res.ok) {
      const data = await res.json();
      if (Array.isArray(data) && data.length > 0) {
        localStorage.setItem(LOCAL_CUSTOMERS_KEY, JSON.stringify(data));
        return data;
      }
    }
  } catch (e) {}

  try {
    return JSON.parse(localStorage.getItem(LOCAL_CUSTOMERS_KEY) || '[]');
  } catch (e) {
    return [];
  }
}

// Global API
window.MondDB = {
  isConfigured: isSupabaseConfigured,
  getConfig: getSupabaseConfig,
  setConfig: setSupabaseConfig,
  getClient: getSupabaseClient,
  // Products
  fetchProducts: mondFetchProducts,
  saveProduct: mondSaveProduct,
  syncCatalog: mondSyncCatalog,
  deleteProduct: mondDeleteProduct,
  subscribeProducts: mondSubscribeProducts,
  // Orders
  createOrder: mondCreateOrder,
  fetchOrders: mondFetchOrders,
  updateOrderStatus: mondUpdateOrderStatus,
  subscribeOrders: mondSubscribeOrders,
  // Customers
  fetchCustomers: mondFetchCustomers
};
