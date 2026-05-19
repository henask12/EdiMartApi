-- AlterTable: Role.name from enum to text
ALTER TABLE "Role" ALTER COLUMN "name" TYPE TEXT USING "name"::TEXT;

-- DropEnum
DROP TYPE IF EXISTS "RoleName";
