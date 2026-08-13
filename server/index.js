const express = require("express");
const cors = require("cors");
const path = require("path");
const { indexOnChainData } = require("./indexer");
const apiRouter = require("./routes/api");
const supplierRouter = require("./routes/supplier");
const manufacturerRouter = require("./routes/manufacturer");
const inspectorRouter = require("./routes/inspector");
const logisticsRouter = require("./routes/logistics");
const distributorRouter = require("./routes/distributor");
const agentRouter = require("./routes/agent");

const app = express();
const PORT = process.env.PORT || 5000;

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, "..", "public")));

// API 라우터 등록
app.use("/api", apiRouter);
app.use("/api/supplier", supplierRouter);
app.use("/api/manufacturer", manufacturerRouter);
app.use("/api/inspector", inspectorRouter);
app.use("/api/logistics", logisticsRouter);
app.use("/api/distributor", distributorRouter);
app.use("/api/agent", agentRouter);

// 기본 헬스 체크
app.get("/", (req, res) => {
  res.json({
    project: "ChainTrace API Server",
    database: "DuckDB (Columnar OLAP Storage Engine)",
    status: "running",
    version: "1.0.0"
  });
});

async function startServer() {
  try {
    console.log("==========================================================================");
    console.log(" 🚀 ChainTrace DuckDB 백엔드 인덱서 및 Express API 서버 시작");
    console.log("==========================================================================\n");

    // 서버 시작 시 DuckDB 고속 인덱싱 수행
    await indexOnChainData();

    app.listen(PORT, () => {
      console.log(`==========================================================================`);
      console.log(` 🟢 Express REST API 서버가 시작되었습니다! (포트: ${PORT})`);
      console.log(` 🔗 헬스체크 주소  : http://localhost:${PORT}/`);
      console.log(` 🔗 공급망 통계 API: http://localhost:${PORT}/api/stats`);
      console.log(` 🔗 AI 에이전트 대화: http://localhost:${PORT}/agent_portal.html`);
      console.log(` 🔗 AI 포탈 채팅 API: http://localhost:${PORT}/api/agent/chat`);
      console.log(` 🔗 리콜 계보 추적 : http://localhost:${PORT}/api/trace/genealogy/RAW-SUP02-D03`);
      console.log(`==========================================================================\n`);
    });
  } catch (err) {
    console.error("❌ 서버 시작 중 오류 발생:", err);
    process.exit(1);
  }
}

if (require.main === module) {
  startServer();
}

module.exports = { app, startServer };
