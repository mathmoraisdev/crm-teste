-- Cache global de código de barras (EAN → nome/marca). Ver model EanCache.
CREATE TABLE IF NOT EXISTS "EanCache" (
    "gtin"      TEXT NOT NULL,
    "found"     BOOLEAN NOT NULL,
    "name"      TEXT,
    "brand"     TEXT,
    "ncm"       TEXT,
    "source"    TEXT,
    "fetchedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "EanCache_pkey" PRIMARY KEY ("gtin")
);
CREATE INDEX IF NOT EXISTS "EanCache_fetchedAt_idx" ON "EanCache"("fetchedAt");
