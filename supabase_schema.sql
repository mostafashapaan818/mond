-- ==============================================================================
-- MOONED / MOND HAUTE PARFUMERIE — SUPABASE DATABASE SCHEMA
-- ==============================================================================
-- Run this complete script in your Supabase SQL Editor (Dashboard > SQL Editor > New Query)
-- It creates the Products, Customers, and Orders tables, configures automated triggers,
-- enables Row Level Security (RLS) with permissive anon policies, seeds the catalog,
-- and activates Supabase Realtime for instant front-end synchronization.

-- 1. CLEANUP (OPTIONAL - SAFE IF TABLES DO NOT EXIST)
-- DROP TABLE IF EXISTS public.orders CASCADE;
-- DROP TABLE IF EXISTS public.customers CASCADE;
-- DROP TABLE IF EXISTS public.products CASCADE;

-- 2. PRODUCTS CATALOG TABLE
CREATE TABLE IF NOT EXISTS public.products (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  brand TEXT DEFAULT 'MOND Atelier',
  main_category TEXT DEFAULT 'Unisex',
  collection TEXT DEFAULT 'Signature',
  concentration TEXT DEFAULT 'Extrait de Parfum',
  tag TEXT DEFAULT 'Signature',
  price_50 NUMERIC NOT NULL,
  price_100 NUMERIC NOT NULL,
  in_stock BOOLEAN DEFAULT true,
  img TEXT,
  top_notes TEXT,
  heart_notes TEXT,
  base_notes TEXT,
  description TEXT,
  created_at TIMESTAMPTZ DEFAULT TIMEZONE('utc'::text, NOW()) NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT TIMEZONE('utc'::text, NOW()) NOT NULL
);

-- 3. CUSTOMERS TABLE
CREATE TABLE IF NOT EXISTS public.customers (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  full_name TEXT NOT NULL,
  email TEXT UNIQUE NOT NULL,
  phone TEXT,
  address TEXT,
  city TEXT,
  postal_code TEXT,
  total_orders INTEGER DEFAULT 1,
  total_spent NUMERIC DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT TIMEZONE('utc'::text, NOW()) NOT NULL,
  last_order_at TIMESTAMPTZ DEFAULT TIMEZONE('utc'::text, NOW()) NOT NULL
);

-- 4. ORDERS TABLE
CREATE TABLE IF NOT EXISTS public.orders (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  order_ref TEXT UNIQUE NOT NULL DEFAULT ('MND-' || FLOOR(10000 + RANDOM() * 90000)::TEXT),
  customer_id UUID REFERENCES public.customers(id) ON DELETE SET NULL,
  -- Dual-naming compatibility for front-end payloads
  client_name TEXT,
  full_name TEXT,
  client_email TEXT,
  email TEXT,
  client_phone TEXT,
  phone_number TEXT,
  shipping_address TEXT NOT NULL DEFAULT 'Standard Courier Dispatch',
  city TEXT,
  postal_code TEXT,
  notes TEXT,
  payment_method TEXT DEFAULT 'cod',
  status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'dispatched', 'delivered', 'cancelled')),
  total_amount NUMERIC NOT NULL DEFAULT 0,
  items JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at TIMESTAMPTZ DEFAULT TIMEZONE('utc'::text, NOW()) NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT TIMEZONE('utc'::text, NOW()) NOT NULL
);

-- Ensure defaults and alter if table already exists
ALTER TABLE public.orders ALTER COLUMN order_ref SET DEFAULT ('MND-' || FLOOR(10000 + RANDOM() * 90000)::TEXT);
ALTER TABLE public.orders ALTER COLUMN shipping_address SET DEFAULT 'Standard Courier Dispatch';
ALTER TABLE public.orders ALTER COLUMN total_amount SET DEFAULT 0;
ALTER TABLE public.orders ALTER COLUMN items SET DEFAULT '[]'::jsonb;
ALTER TABLE public.orders ALTER COLUMN payment_method SET DEFAULT 'cod';
ALTER TABLE public.orders ALTER COLUMN status SET DEFAULT 'pending';

-- 5. AUTOMATED CUSTOMER SYNC TRIGGER ON NEW ORDER
CREATE OR REPLACE FUNCTION public.handle_new_order_customer()
RETURNS TRIGGER AS $$
DECLARE
  v_cust_id UUID;
  v_name TEXT;
  v_email TEXT;
  v_phone TEXT;
BEGIN
  -- Auto-generate order_ref if missing or empty
  IF NEW.order_ref IS NULL OR TRIM(NEW.order_ref) = '' THEN
    NEW.order_ref := 'MND-' || FLOOR(10000 + RANDOM() * 90000)::TEXT;
  END IF;

  -- Default shipping address if missing or empty
  IF NEW.shipping_address IS NULL OR TRIM(NEW.shipping_address) = '' THEN
    NEW.shipping_address := 'Standard Courier Dispatch';
  END IF;

  -- Normalize names across both payload conventions
  v_name := COALESCE(NULLIF(TRIM(NEW.full_name), ''), NULLIF(TRIM(NEW.client_name), ''), 'Patron');
  v_email := LOWER(COALESCE(NULLIF(TRIM(NEW.email), ''), NULLIF(TRIM(NEW.client_email), ''), ''));
  v_phone := COALESCE(NULLIF(TRIM(NEW.phone_number), ''), NULLIF(TRIM(NEW.client_phone), ''), '');

  -- Mirror values into both columns so either can be queried
  NEW.full_name := v_name;
  NEW.client_name := v_name;
  NEW.email := v_email;
  NEW.client_email := v_email;
  NEW.phone_number := v_phone;
  NEW.client_phone := v_phone;

  IF v_email <> '' THEN
    SELECT id INTO v_cust_id FROM public.customers WHERE LOWER(email) = v_email;

    IF v_cust_id IS NOT NULL THEN
      UPDATE public.customers
      SET
        full_name = v_name,
        phone = COALESCE(v_phone, phone),
        address = COALESCE(NEW.shipping_address, address),
        city = COALESCE(NEW.city, city),
        postal_code = COALESCE(NEW.postal_code, postal_code),
        total_orders = total_orders + 1,
        total_spent = total_spent + NEW.total_amount,
        last_order_at = TIMEZONE('utc'::text, NOW())
      WHERE id = v_cust_id;
    ELSE
      INSERT INTO public.customers (
        full_name, email, phone, address, city, postal_code, total_orders, total_spent, last_order_at
      ) VALUES (
        v_name,
        v_email,
        v_phone,
        NEW.shipping_address,
        NEW.city,
        NEW.postal_code,
        1,
        NEW.total_amount,
        TIMEZONE('utc'::text, NOW())
      ) RETURNING id INTO v_cust_id;
    END IF;
  END IF;

  NEW.customer_id = v_cust_id;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS trigger_new_order_customer ON public.orders;
CREATE TRIGGER trigger_new_order_customer
  BEFORE INSERT ON public.orders
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_new_order_customer();

-- 6. GRANT PRIVILEGES TO ANON AND AUTHENTICATED ROLES
GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
GRANT ALL ON TABLE public.products TO anon, authenticated, service_role;
GRANT ALL ON TABLE public.customers TO anon, authenticated, service_role;
GRANT ALL ON TABLE public.orders TO anon, authenticated, service_role;
GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO anon, authenticated, service_role;
GRANT ALL ON ALL ROUTINES IN SCHEMA public TO anon, authenticated, service_role;

-- 7. ENABLE ROW LEVEL SECURITY (RLS)
ALTER TABLE public.products ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.customers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.orders ENABLE ROW LEVEL SECURITY;

-- 7. RLS POLICIES FOR FRONT-END INTEGRATION
-- Products: Anyone can read, anyone with public anon key can insert/update/delete (or restrict to service role)
DROP POLICY IF EXISTS "Public Read Products" ON public.products;
CREATE POLICY "Public Read Products" ON public.products FOR SELECT USING (true);

DROP POLICY IF EXISTS "Public Manage Products" ON public.products;
CREATE POLICY "Public Manage Products" ON public.products FOR ALL USING (true) WITH CHECK (true);

-- Orders: Anyone can insert orders (Checkout), Anyone can read/update (Admin Dashboard)
DROP POLICY IF EXISTS "Public Insert Orders" ON public.orders;
CREATE POLICY "Public Insert Orders" ON public.orders FOR INSERT WITH CHECK (true);

DROP POLICY IF EXISTS "Public Read Orders" ON public.orders;
CREATE POLICY "Public Read Orders" ON public.orders FOR SELECT USING (true);

DROP POLICY IF EXISTS "Public Update Orders" ON public.orders;
CREATE POLICY "Public Update Orders" ON public.orders FOR UPDATE USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Public Delete Orders" ON public.orders;
CREATE POLICY "Public Delete Orders" ON public.orders FOR DELETE USING (true);

-- Customers: Anyone can read/insert/update
DROP POLICY IF EXISTS "Public Read Customers" ON public.customers;
CREATE POLICY "Public Read Customers" ON public.customers FOR SELECT USING (true);

DROP POLICY IF EXISTS "Public Insert Customers" ON public.customers;
CREATE POLICY "Public Insert Customers" ON public.customers FOR INSERT WITH CHECK (true);

DROP POLICY IF EXISTS "Public Update Customers" ON public.customers;
CREATE POLICY "Public Update Customers" ON public.customers FOR UPDATE USING (true);

-- 8. ACTIVATE SUPABASE REALTIME REPLICATION FOR INSTANT FRONTEND SYNC
ALTER PUBLICATION supabase_realtime ADD TABLE public.products;
ALTER PUBLICATION supabase_realtime ADD TABLE public.orders;
ALTER PUBLICATION supabase_realtime ADD TABLE public.customers;

-- 9. SEED DEFAULT LUXURY PRODUCTS
INSERT INTO public.products (id, name, concentration, tag, price_50, price_100, in_stock, img, top_notes, heart_notes, base_notes, description)
VALUES
  (
    'eclipse-noir',
    'Eclipse Noir',
    'Extrait de Parfum',
    'Signature',
    170,
    240,
    true,
    'items/1.png',
    'Italian Bergamot, Smoked Cardamom, Pink Peppercorn',
    'Black Amber, Tuscan Iris, Dark Violet Leaf',
    'Wild Cambodian Oud, Birch Tar, Haitian Vetiver',
    'A nocturnal composition inspired by the shadows of the lunar eclipse. Smoked resinous woods draped over velvet violet petals and raw ancient oud.'
  ),
  (
    'silver-crater',
    'Silver Crater',
    'Extrait de Parfum',
    'Rare Reserve',
    195,
    275,
    true,
    'items/2.png',
    'Crisp Aldehydes, White Thyme, Frozen Juniper',
    'Metallic Orris, Crushed Rose Petals, Mineral Accord',
    'Grey Ambergris, Cashmeran, Clean White Musk',
    'Crystalline and pure. Captures the icy mineral glow of lunar crater rims basking in untouched moonlight with stark, luminescent elegance.'
  ),
  (
    'mare-tranquillitatis',
    'Mare Tranquillitatis',
    'Extrait de Parfum',
    'Astral Collection',
    160,
    225,
    true,
    'items/3.png',
    'Moonlit Frankincense, Sea Salt, Bitter Orange',
    'Night-Blooming Jasmine, Silver Lavender, Ozonic Mist',
    'Mysore Sandalwood, Deep Cedarwood, Tonka Bean',
    'Named after the Sea of Tranquility. A meditative sanctuary blending ethereal night blooms with oceanic minerals and warm Mysore sandalwood.'
  ),
  (
    'lunar-oud',
    'Lunar Oud',
    'Extrait de Parfum',
    'Privé',
    220,
    310,
    true,
    'items/4.png',
    'Saffron Threads, Elemi Resin, Black Pepper',
    'Taif Rose, Leather Accord, Smoky Incense',
    'Aged Assam Oud, Bourbon Vanilla, Smoked Birch',
    'An intense celestial alchemy of wild Assam oud and regal Taif rose, ignited by hot saffron and grounded in rich dark leather.'
  )
ON CONFLICT (id) DO UPDATE SET
  name = EXCLUDED.name,
  concentration = EXCLUDED.concentration,
  tag = EXCLUDED.tag,
  price_50 = EXCLUDED.price_50,
  price_100 = EXCLUDED.price_100,
  in_stock = EXCLUDED.in_stock,
  img = EXCLUDED.img,
  top_notes = EXCLUDED.top_notes,
  heart_notes = EXCLUDED.heart_notes,
  base_notes = EXCLUDED.base_notes,
  description = EXCLUDED.description,
  updated_at = NOW();

