-- Manually set the logo URL for the user's business
-- Run in SQL Editor

UPDATE businesses
SET logo_url = 'https://ddrlnwwuzehatjfachgu.supabase.co/storage/v1/object/public/business-logos/acf71faa-d769-4881-b707-d1d03fa89101-1776971312031.svg'
WHERE id = 'acf71faa-d769-4881-b707-d1d03fa89101';
