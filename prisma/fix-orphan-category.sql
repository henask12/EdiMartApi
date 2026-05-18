INSERT INTO "Category" (id, name, "createdAt")
VALUES ('cat-general', 'General', NOW())
ON CONFLICT (name) DO NOTHING;

UPDATE "Product"
SET "categoryId" = (SELECT id FROM "Category" WHERE name = 'General' LIMIT 1)
WHERE "categoryId" IS NULL;
