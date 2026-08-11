const duckdb = require("duckdb");
const path = require("path");
const fs = require("fs");

const dataDir = path.join(__dirname, "..", "data");
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

const dbPath = path.join(dataDir, "chaintrace.duckdb");
let db;
try {
  db = new duckdb.Database(dbPath);
} catch (e) {
  console.log("⚠️ DuckDB 파일 세션 대체: 인메모리 모드로 초기화합니다.");
  db = new duckdb.Database(":memory:");
}

function runQuery(sql, params = []) {
  return new Promise((resolve, reject) => {
    if (!params || params.length === 0) {
      db.all(sql, (err, rows) => {
        if (err) return reject(err);
        resolve(rows);
      });
    } else {
      db.all(sql, ...params, (err, rows) => {
        if (err) return reject(err);
        resolve(rows);
      });
    }
  });
}

function execSql(sql) {
  return new Promise((resolve, reject) => {
    db.exec(sql, (err) => {
      if (err) return reject(err);
      resolve();
    });
  });
}

// DuckDB 스키마 초기화
async function initSchema() {
  console.log("🦆 DuckDB 데이터베이스 스키마 초기화 중... (`data/chaintrace.duckdb`)");

  await execSql(`
    CREATE TABLE IF NOT EXISTS participants (
      address VARCHAR PRIMARY KEY,
      role VARCHAR,
      company_name VARCHAR,
      is_registered BOOLEAN,
      registered_at TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS batches (
      batch_id VARCHAR PRIMARY KEY,
      batch_type VARCHAR,
      creator VARCHAR,
      product_name VARCHAR,
      quantity DOUBLE,
      unit VARCHAR,
      created_at TIMESTAMP,
      metadata_hash VARCHAR
    );

    CREATE TABLE IF NOT EXISTS genealogy (
      parent_batch_id VARCHAR,
      child_batch_id VARCHAR
    );

    CREATE TABLE IF NOT EXISTS inspections (
      batch_id VARCHAR,
      inspector VARCHAR,
      is_passed BOOLEAN,
      certHash VARCHAR,
      test_details VARCHAR,
      timestamp TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS transfers (
      batch_id VARCHAR,
      from_address VARCHAR,
      to_address VARCHAR,
      location VARCHAR,
      notes VARCHAR,
      timestamp TIMESTAMP,
      is_pending BOOLEAN,
      is_completed BOOLEAN
    );

    CREATE TABLE IF NOT EXISTS recalls (
      batch_id VARCHAR PRIMARY KEY,
      triggered_by VARCHAR,
      reason VARCHAR,
      timestamp TIMESTAMP
    );
  `);

  console.log("✅ DuckDB 테이블 스키마 생성 완료!\n");
}

module.exports = {
  db,
  runQuery,
  execSql,
  initSchema
};
