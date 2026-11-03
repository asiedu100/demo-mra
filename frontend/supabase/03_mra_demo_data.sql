-- MRA Systems demo seed data.
-- Run this in the demo Supabase project's SQL Editor only.
-- Safe to run more than once: existing demo rows are updated or reused.

begin;

insert into public.business_profile (
  business_name,
  business_type,
  currency_code,
  phone,
  email,
  address,
  brand_color
)
select
  'MRA Systems Demo',
  'Retail and General Trading',
  'GHS',
  '0200000000',
  'demo@mrasystems.local',
  'Kumasi, Ghana',
  '#5C2D0A'
where not exists (select 1 from public.business_profile);

update public.business_profile
set
  business_name = 'MRA Systems Demo',
  business_type = 'Retail and General Trading',
  currency_code = 'GHS',
  phone = '0200000000',
  email = 'demo@mrasystems.local',
  address = 'Kumasi, Ghana'
where id = (select id from public.business_profile order by created_at limit 1);

insert into public.branches (branch_name, branch_code, address, phone)
values
  ('Kumasi Central', 'KSI-001', 'Kumasi, Ghana', '0200000001'),
  ('Accra Branch', 'ACC-001', 'Accra, Ghana', '0200000002')
on conflict (branch_code) do update set
  branch_name = excluded.branch_name,
  address = excluded.address,
  phone = excluded.phone,
  is_active = true;

insert into public.product_categories (category_name, description)
values
  ('Electronics', 'Electronic devices and accessories'),
  ('Groceries', 'Food items and household consumables'),
  ('Home and Living', 'Household and home improvement products'),
  ('Fashion', 'Clothing, footwear and accessories'),
  ('Office Supplies', 'Stationery and office equipment')
on conflict (category_name) do update set
  description = excluded.description,
  is_active = true;

insert into public.products (
  product_name, sku, barcode, category_id, description,
  cost_price, selling_price, reorder_level, unit_name
)
values
  ('Wireless Bluetooth Speaker', 'ELEC-001', '100000000001',
   (select id from public.product_categories where category_name = 'Electronics'),
   'Portable wireless speaker', 180, 250, 5, 'piece'),
  ('USB Flash Drive 32GB', 'ELEC-002', '100000000002',
   (select id from public.product_categories where category_name = 'Electronics'),
   '32GB USB storage device', 45, 70, 10, 'piece'),
  ('Rechargeable LED Lamp', 'ELEC-003', '100000000003',
   (select id from public.product_categories where category_name = 'Electronics'),
   'Rechargeable emergency lamp', 85, 120, 8, 'piece'),
  ('Phone Charger', 'ELEC-004', '100000000004',
   (select id from public.product_categories where category_name = 'Electronics'),
   'Universal phone charger', 35, 55, 10, 'piece'),
  ('Cooking Oil 1L', 'GROC-001', '100000000006',
   (select id from public.product_categories where category_name = 'Groceries'),
   'One litre cooking oil', 28, 35, 20, 'bottle'),
  ('Rice 5kg', 'GROC-002', '100000000007',
   (select id from public.product_categories where category_name = 'Groceries'),
   'Five kilogram bag of rice', 95, 115, 10, 'bag'),
  ('Laundry Detergent', 'HOME-001', '100000000010',
   (select id from public.product_categories where category_name = 'Home and Living'),
   'Household laundry detergent', 25, 35, 10, 'pack'),
  ('Men T-Shirt', 'FASH-001', '100000000012',
   (select id from public.product_categories where category_name = 'Fashion'),
   'Casual cotton T-shirt', 40, 65, 10, 'piece'),
  ('A4 Paper Ream', 'OFF-001', '100000000014',
   (select id from public.product_categories where category_name = 'Office Supplies'),
   'A4 printing paper', 55, 75, 10, 'ream')
on conflict (sku) do update set
  product_name = excluded.product_name,
  barcode = excluded.barcode,
  category_id = excluded.category_id,
  description = excluded.description,
  cost_price = excluded.cost_price,
  selling_price = excluded.selling_price,
  reorder_level = excluded.reorder_level,
  unit_name = excluded.unit_name,
  is_active = true;

insert into public.customers (customer_name, phone, email, address, notes)
select *
from (values
  ('Kwame Mensah', '0240000001', 'kwame@example.com', 'Kumasi', 'Regular customer'),
  ('Ama Serwaa', '0240000002', 'ama@example.com', 'Accra', 'Retail customer'),
  ('Daniel Owusu', '0240000003', 'daniel@example.com', 'Kumasi', 'Wholesale customer'),
  ('Grace Asante', '0240000004', 'grace@example.com', 'Ejisu', 'Regular customer'),
  ('Michael Boateng', '0240000005', 'michael@example.com', 'Accra', 'Business customer')
) as demo(customer_name, phone, email, address, notes)
where not exists (
  select 1 from public.customers c where c.phone = demo.phone
);

with stock_data(branch_code, sku, quantity) as (
  values
    ('KSI-001', 'ELEC-001', 15::numeric), ('KSI-001', 'ELEC-002', 30),
    ('KSI-001', 'ELEC-003', 12), ('KSI-001', 'ELEC-004', 25),
    ('KSI-001', 'GROC-001', 40), ('KSI-001', 'GROC-002', 20),
    ('KSI-001', 'HOME-001', 18), ('KSI-001', 'FASH-001', 25),
    ('KSI-001', 'OFF-001', 30),
    ('ACC-001', 'ELEC-001', 10), ('ACC-001', 'ELEC-002', 20),
    ('ACC-001', 'ELEC-003', 8), ('ACC-001', 'ELEC-004', 15),
    ('ACC-001', 'GROC-001', 25), ('ACC-001', 'GROC-002', 15),
    ('ACC-001', 'HOME-001', 12), ('ACC-001', 'FASH-001', 18),
    ('ACC-001', 'OFF-001', 20)
),
resolved as (
  select b.id branch_id, p.id product_id, s.quantity
  from stock_data s
  join public.branches b on b.branch_code = s.branch_code
  join public.products p on p.sku = s.sku
),
inserted as (
  insert into public.branch_inventory (branch_id, product_id, quantity)
  select branch_id, product_id, quantity from resolved
  on conflict (branch_id, product_id) do nothing
  returning id, branch_id, product_id, quantity
)
insert into public.stock_history (
  branch_id, product_id, movement_type, quantity_change,
  quantity_before, quantity_after, reason
)
select branch_id, product_id, 'opening_stock', quantity, 0, quantity,
       'Initial MRA demo stock'
from inserted;

commit;
