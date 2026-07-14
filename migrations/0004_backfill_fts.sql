INSERT OR REPLACE INTO businesses_fts(rowid, name, city, category)
SELECT id, name, city, category
FROM businesses;
